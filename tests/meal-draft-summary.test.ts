import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, NutrientValue } from '../src/domain/index';
import type { FoodId, FoodServingId, ISODateTime, MealId, MealItemId } from '../src/domain/shared/ids';
import type { MealDraft } from '../src/services/meals/meal-composer';
import { coreMetricLine } from '../src/ui/core-metrics';
import { summarizeDraft } from '../src/ui/meal-draft-summary';

const at = '2026-08-31T12:00:00.000Z' as ISODateTime;
const breastServing = 'usda-core:1:portion:1' as FoodServingId;

function value(code: string, name: string, unit: string, amount?: number): NutrientValue {
  const nutrient = { code, name, unit };
  return amount === undefined
    ? { nutrient, state: 'unknown' }
    : { nutrient, state: 'known', value: amount };
}

const chicken: Food = {
  id: 'usda-core:1' as FoodId,
  kind: 'generic',
  name: 'Chicken breast, roasted',
  nutrition: {
    basisGrams: 100,
    nutrients: [
      value('protein-g', 'Protein', 'g', 31),
      value('energy-kcal', 'Energy', 'kcal', 165),
      value('carbohydrate-g', 'Carbs', 'g', 0),
      value('fat-g', 'Fat', 'g', 3.6),
      value('fiber-g', 'Fiber', 'g', 0),
    ],
  },
  servings: [{
    id: breastServing,
    foodId: 'usda-core:1' as FoodId,
    label: '1 medium breast',
    gramWeight: 100,
    quantity: 1,
    unit: 'serving',
    isDefault: true,
  }],
  createdAt: at,
  updatedAt: at,
};

// Fiber is absent, as it commonly is on branded records.
const bar: Food = {
  ...chicken,
  id: 'open-food-facts:9' as FoodId,
  name: 'Protein bar',
  nutrition: {
    basisGrams: 100,
    nutrients: [
      value('protein-g', 'Protein', 'g', 20),
      value('energy-kcal', 'Energy', 'kcal', 200),
      value('carbohydrate-g', 'Carbs', 'g', 40),
      value('fat-g', 'Fat', 'g', 10),
      value('fiber-g', 'Fiber', 'g'),
    ],
  },
  servings: [],
};

function draft(items: MealDraft['items']): MealDraft {
  return { id: 'meal:d1' as MealId, createdAt: at, context: { occurredAt: at }, items };
}

test('a serving-based portion resolves its weight for display', () => {
  // The portion stores { servingId, quantity } and no grams, so reading
  // portion.gramWeight directly would show a fabricated 100 (THI-308).
  const summary = summarizeDraft(
    draft([{ id: 'i1' as MealItemId, foodId: chicken.id, portion: { servingId: breastServing, quantity: 2 } }]),
    new Map([[chicken.id, chicken]]),
  );

  assert.equal(summary.items[0]?.gramWeight, 200);
  assert.equal(coreMetricLine(summary.items[0]?.metrics ?? []), '62 P · 330 kcal · 0 C · 7.2 F · 0 fiber');
});

test('totals add up across the event, protein first', () => {
  const summary = summarizeDraft(
    draft([
      { id: 'i1' as MealItemId, foodId: chicken.id, portion: { quantity: 1, gramWeight: 100 } },
      { id: 'i2' as MealItemId, foodId: chicken.id, portion: { quantity: 1, gramWeight: 100 } },
    ]),
    new Map([[chicken.id, chicken]]),
  );

  assert.equal(summary.totals[0]?.code, 'protein-g');
  assert.equal(summary.totals[0]?.text, '62');
  assert.equal(summary.unavailableCount, 0);
});

test('one unknown nutrient blanks that nutrient only, never the whole total', () => {
  const summary = summarizeDraft(
    draft([
      { id: 'i1' as MealItemId, foodId: chicken.id, portion: { quantity: 1, gramWeight: 100 } },
      { id: 'i2' as MealItemId, foodId: bar.id, portion: { quantity: 1, gramWeight: 100 } },
    ]),
    new Map([[chicken.id, chicken], [bar.id, bar]]),
  );

  assert.equal(summary.totals.find((metric) => metric.code === 'protein-g')?.text, '51');
  const fiber = summary.totals.find((metric) => metric.code === 'fiber-g');
  assert.equal(fiber?.text, '—', 'an unknown contributor must not be summed as zero');
  assert.equal(fiber?.known, false);
});

test('an unresolvable item is counted, and the rest still total', () => {
  const summary = summarizeDraft(
    draft([
      { id: 'i1' as MealItemId, foodId: chicken.id, portion: { quantity: 1, gramWeight: 100 } },
      { id: 'i2' as MealItemId, foodId: 'usda-core:missing' as FoodId, portion: { quantity: 1, gramWeight: 50 } },
    ]),
    new Map([[chicken.id, chicken]]),
  );

  assert.equal(summary.unavailableCount, 1);
  assert.equal(summary.items[1]?.name, 'Unavailable food');
  assert.equal(summary.items[1]?.available, false);
  // Partial progress with a caveat beats hiding a real running total.
  assert.equal(summary.totals.find((metric) => metric.code === 'protein-g')?.text, '31');
});

test('an empty draft reports unknown rather than zero', () => {
  const summary = summarizeDraft(draft([]), new Map());
  assert.equal(summary.totals.every((metric) => metric.text === '—'), true);
});
