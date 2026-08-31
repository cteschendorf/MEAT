import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, FoodCandidate } from '../src/domain';
import type { FoodId, FoodServingId, ISODateTime, SourceRecordId } from '../src/domain/shared/ids';
import {
  defaultAmountForChoice,
  defaultPortionChoice,
  densityForCandidate,
  goalImpactsForDetail,
  gramsForChoice,
  hasAnyTarget,
  metricsForDetail,
  parseQuantity,
  portionChoicesFor,
  portionSummary,
  servingIdForChoice,
  unitChoicesFor,
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

test('the package serving is what the picker opens on, not a synthesized 100 g', () => {
  // This is the point of the change: a scanned product should open on the
  // serving printed on the package, which is what people actually eat.
  const choice = defaultPortionChoice(chicken());
  assert.equal(choice.kind, 'serving');
  assert.equal(choice.label, '1 medium breast');
  assert.equal(choice.gramWeight, 140);
  assert.equal(servingIdForChoice(choice), 'usda-core:5062:breast');
});

test('a food that names no serving falls through to the preferred unit', () => {
  const stripped: FoodCandidate = { ...chicken(), portions: [] };

  const metric = defaultPortionChoice(stripped);
  assert.equal(metric.kind, 'unit');
  assert.equal(metric.label, 'g');
  assert.equal(metric.gramWeight, 1);
  // Typing a weight is not a claim about a serving, so none is recorded.
  assert.equal(servingIdForChoice(metric), undefined);

  const imperial = defaultPortionChoice(stripped, 'oz');
  assert.equal(imperial.label, 'oz');
  assert.ok(Math.abs(imperial.gramWeight - 28.349523125) < 1e-9);
});

test('servings come before units, and the preferred unit leads its group', () => {
  const choices = portionChoicesFor(chicken(), 'oz');
  const servings = choices.filter((choice) => choice.kind === 'serving');
  const units = choices.filter((choice) => choice.kind === 'unit');

  assert.deepEqual(servings.map((choice) => choice.label), [
    '1 medium breast',
    '1 cup, diced',
    '100 g',
  ]);
  // A serving is what someone ate; a unit is how they measured it.
  assert.ok(choices.indexOf(servings[0]!) < choices.indexOf(units[0]!));
  assert.equal(units[0]?.label, 'oz');
  assert.equal(portionChoicesFor(chicken(), 'g').filter((c) => c.kind === 'unit')[0]?.label, 'g');
});

test('the amount multiplies whichever choice is selected', () => {
  const serving = defaultPortionChoice(chicken());
  // "2 chicken breasts" was unreachable before THI-308: every write site pinned
  // quantity to 1 and stored a bare weight.
  assert.equal(gramsForChoice(serving, 2), 280);
  assert.equal(portionSummary(serving, 2), '2 × 1 medium breast · 280 g');
  assert.equal(portionSummary(serving, 1), '1 medium breast · 140 g');

  // A unit reads as an amount of that unit rather than a multiplier.
  const ounces = unitChoicesFor(null, 'oz')[0]!;
  assert.ok(Math.abs(gramsForChoice(ounces, 6) - 170.0971) < 0.001);
  assert.equal(portionSummary(ounces, 6), '6 oz · 170.1 g');

  // Grams need no restatement: "150 g" is already the whole answer.
  const grams = unitChoicesFor(null, 'g')[0]!;
  assert.equal(portionSummary(grams, 150), '150 g');
});

test('volume units are offered only to a food whose own data gives a density', () => {
  // Chicken breast describes itself in cups, so its density is knowable and
  // fluid ounces are safe to offer.
  const density = densityForCandidate(chicken());
  assert.ok(density !== null && Math.abs(density - 135 / 236.5882365) < 1e-9);
  const labels = portionChoicesFor(chicken()).map((choice) => choice.label);
  assert.ok(labels.includes('fl oz'));
  assert.ok(labels.includes('cup'));

  // Strip the volumetric portion and the food can no longer be measured by
  // volume, because nothing here will assume a density for it.
  const solid: FoodCandidate = {
    ...chicken(),
    portions: chicken().portions.filter((portion) => !portion.label.includes('cup')),
  };
  assert.equal(densityForCandidate(solid), null);
  const solidLabels = portionChoicesFor(solid).map((choice) => choice.label);
  assert.ok(!solidLabels.includes('fl oz'));
  assert.ok(solidLabels.includes('oz'), 'mass units stay available to every food');
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

test('the amount field starts somewhere a person would recognise', () => {
  // One of a named serving is what "a serving" means.
  assert.equal(defaultAmountForChoice(defaultPortionChoice(chicken())), 1);

  // One gram is not a portion of anything. A bare unit starts at whatever is
  // closest to 100 g, the basis the nutrition is stated against.
  const [grams] = unitChoicesFor(null, 'g');
  const [ounces] = unitChoicesFor(null, 'oz');
  assert.equal(defaultAmountForChoice(grams!), 100);
  assert.equal(defaultAmountForChoice(ounces!), 3.5);

  // A food with no usable serving is the case that made this matter: it falls
  // through to a unit, and 1 g would have been the opening portion.
  const stripped: FoodCandidate = { ...chicken(), portions: [] };
  const opening = defaultPortionChoice(stripped);
  assert.equal(defaultAmountForChoice(opening), 100);
  assert.equal(gramsForChoice(opening, defaultAmountForChoice(opening)), 100);
});
