import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, FoodCandidate } from '../src/domain';
import type { FoodId, FoodServingId, ISODateTime, SourceRecordId } from '../src/domain/shared/ids';
import {
  defaultPortionChoice,
  goalImpactsForDetail,
  gramsForChoice,
  hasAnyTarget,
  metricsForDetail,
  parseQuantity,
  portionChoicesFor,
  portionSummary,
} from '../src/ui/food-detail-model';

const now = '2026-08-31T12:00:00.000Z' as ISODateTime;

function chicken(): FoodCandidate {
  const id = 'usda-core:5062' as FoodId;
  const breast = 'usda-core:5062:breast' as FoodServingId;
  const cup = 'usda-core:5062:cup' as FoodServingId;
  const food: Food = {
    id,
    kind: 'generic',
    name: 'Chicken breast, roasted',
    nutrition: {
      basisGrams: 100,
      nutrients: [
        { nutrient: { code: 'protein-g', name: 'Protein', unit: 'g' }, state: 'known', value: 31 },
        { nutrient: { code: 'energy-kcal', name: 'Energy', unit: 'kcal' }, state: 'known', value: 165 },
        { nutrient: { code: 'fiber-g', name: 'Fiber', unit: 'g' }, state: 'unknown' },
      ],
    },
    servings: [
      { id: breast, foodId: id, label: '1 medium breast', quantity: 1, unit: 'serving', gramWeight: 140 },
      { id: cup, foodId: id, label: '1 cup, diced', quantity: 1, unit: 'serving', gramWeight: 135 },
    ],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ref: { sourceId: 'usda-core', recordId: '5062' as SourceRecordId },
    food,
    portions: [
      { id: breast, label: '1 medium breast', quantity: 1, unit: 'serving', gramWeight: 140, isDefault: true },
      { id: cup, label: '1 cup, diced', quantity: 1, unit: 'serving', gramWeight: 135 },
      // Providers synthesize weight-only portions; they must not be duplicated.
      { id: 'usda-core:5062:100g' as FoodServingId, label: '100 g', quantity: 1, unit: 'g', gramWeight: 100 },
    ],
    provenance: { provider: 'usda-core', recordId: '5062' as SourceRecordId },
  };
}

test('the default portion is the named serving the food prefers, not a bare 100 g', () => {
  const choice = defaultPortionChoice(chicken());
  assert.equal(choice.label, '1 medium breast');
  assert.equal(choice.gramWeight, 140);
  // The weight option carries no serving id, so identity cannot be the serving
  // id: "nothing chosen yet" would match it and quietly beat the food's own
  // preferred serving.
  assert.notEqual(choice.key, 'weight');
});

test('a weight option is always offered, and never duplicated', () => {
  const withHundred = portionChoicesFor(chicken());
  assert.equal(withHundred.filter((choice) => choice.label === '100 g').length, 1);

  // A food that defines no usable serving still gets somewhere to start.
  const bare = chicken();
  const stripped: FoodCandidate = { ...bare, portions: [] };
  assert.deepEqual(portionChoicesFor(stripped), [
    { key: 'weight', servingId: undefined, label: '100 g', gramWeight: 100 },
  ]);
});

test('quantity multiplies the chosen serving, which is the whole point of the sheet', () => {
  const choice = defaultPortionChoice(chicken());
  // "2 chicken breasts" was unreachable before this: every write site pinned
  // quantity to 1 and stored a bare weight (THI-308).
  assert.equal(gramsForChoice(choice, 2), 280);
  assert.equal(portionSummary(choice, 2), '2 × 1 medium breast · 280 g');
  assert.equal(portionSummary(choice, 1), '1 medium breast · 140 g');

  // A portion that is already just a weight is not restated in parentheses.
  const weight = { key: 'weight', servingId: undefined, label: '100 g', gramWeight: 100 };
  assert.equal(portionSummary(weight, 1.5), '150 g');
});

test('metrics scale with quantity and keep an unknown nutrient unknown', () => {
  const choice = defaultPortionChoice(chicken());
  const { metrics } = metricsForDetail(chicken().food, gramsForChoice(choice, 2));
  assert.deepEqual(
    metrics.map((metric) => `${metric.text} ${metric.label}`),
    ['86.8 P', '462 kcal', '— C', '— F', '— fiber'],
  );
  // Fibre is explicitly unknown on this record; two breasts of unknown fibre is
  // still unknown fibre, not zero.
  assert.equal(metrics.find((metric) => metric.code === 'fiber-g')?.known, false);
});

test('a quantity has to be a positive number before anything is added', () => {
  assert.equal(parseQuantity('2'), 2);
  assert.equal(parseQuantity('0.5'), 0.5);
  assert.equal(parseQuantity(' 3 '), 3);
  assert.equal(parseQuantity('0'), null);
  assert.equal(parseQuantity('-1'), null);
  assert.equal(parseQuantity(''), null);
  assert.equal(parseQuantity('two'), null);
});

test('every core nutrient gets a row, targeted or not', () => {
  const { facts } = metricsForDetail(chicken().food, 140);
  const impacts = goalImpactsForDetail(
    [
      { code: 'protein-g', current: 96, target: { mode: 'minimum', minimum: 180 } },
      { code: 'energy-kcal', current: 810, target: { mode: 'maximum', maximum: 1840 } },
      { code: 'fiber-g', current: 8, target: { mode: 'minimum', minimum: 30 } },
    ],
    facts,
  );

  // Rows never disappear: which nutrients have targets is the user's business,
  // and a block that changes shape per food is harder to read than one that does not.
  assert.deepEqual(impacts.map((impact) => impact.code), [
    'protein-g',
    'energy-kcal',
    'carbohydrate-g',
    'fat-g',
    'fiber-g',
  ]);
  assert.equal(impacts[0]?.delta, '+43.4 g');
  assert.equal(impacts[1]?.tone, 'good');
  // Carbs have no standing supplied at all, so there is nothing to claim.
  assert.equal(impacts[2]?.shape, 'untargeted');
  // Fibre has a target but this food's fibre is unknown, which is not zero.
  assert.equal(impacts[4]?.delta, '+? g');
  assert.equal(impacts[4]?.pendingFraction, 0);

  assert.equal(hasAnyTarget(impacts), true);
  assert.equal(
    hasAnyTarget(goalImpactsForDetail([{ code: 'protein-g', current: 10, target: null }], facts)),
    false,
  );
});
