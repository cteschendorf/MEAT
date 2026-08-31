import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food } from '../src/domain/index';
import type { FoodId, FoodServingId, ISODateTime } from '../src/domain/shared/ids';
import { gramsForFoodPortion } from '../src/services/nutrition/engine';
import {
  portionForSelection,
  portionWithGramWeight,
  portionWithQuantity,
  resolvableServing,
} from '../src/services/meals/portion-selection';

const breastServing = 'usda-core:1:portion:1' as FoodServingId;

const chicken: Food = {
  id: 'usda-core:1' as FoodId,
  kind: 'generic',
  name: 'Chicken breast, roasted',
  nutrition: { basisGrams: 100, nutrients: [] },
  servings: [
    {
      id: breastServing,
      foodId: 'usda-core:1' as FoodId,
      label: '1 medium breast',
      gramWeight: 174,
      quantity: 1,
      unit: 'serving',
      isDefault: true,
    },
  ],
  createdAt: '2026-08-31T12:00:00.000Z' as ISODateTime,
  updatedAt: '2026-08-31T12:00:00.000Z' as ISODateTime,
};

test('choosing a serving records the serving, not a flattened gram figure', () => {
  const portion = portionForSelection(chicken, breastServing, 1, 174);
  assert.deepEqual(portion, { servingId: breastServing, quantity: 1 });
  assert.equal(gramsForFoodPortion(chicken, portion), 174);
});

test('two of a serving is expressible and scales', () => {
  // The whole point of THI-308: this was impossible while quantity was pinned to 1.
  const portion = portionForSelection(chicken, breastServing, 2, 174);
  assert.deepEqual(portion, { servingId: breastServing, quantity: 2 });
  assert.equal(gramsForFoodPortion(chicken, portion), 348);
});

test('half a serving scales too', () => {
  assert.equal(gramsForFoodPortion(chicken, portionForSelection(chicken, breastServing, 0.5, 174)), 87);
});

test('an unresolvable serving falls back to an explicit weight', () => {
  // Providers synthesize a "100 g" portion with no matching serving on the food;
  // referencing it would leave the engine unable to resolve grams.
  const synthetic = 'usda-core:1:100g' as FoodServingId;
  assert.equal(resolvableServing(chicken, synthetic), undefined);

  const portion = portionForSelection(chicken, synthetic, 2, 100);
  assert.deepEqual(portion, { quantity: 1, gramWeight: 100 });
  assert.equal(gramsForFoodPortion(chicken, portion), 100);
});

test('typing a weight by hand drops the serving it no longer describes', () => {
  const chosen = portionForSelection(chicken, breastServing, 1, 174);
  const overridden = portionWithGramWeight(chosen, 300);

  assert.equal(overridden.servingId, undefined, 'a 300 g portion is not "1 medium breast"');
  assert.deepEqual(overridden, { quantity: 1, gramWeight: 300 });
  assert.equal(gramsForFoodPortion(chicken, overridden), 300);
});

test('changing quantity keeps the serving', () => {
  const chosen = portionForSelection(chicken, breastServing, 1, 174);
  assert.deepEqual(portionWithQuantity(chosen, 3), { servingId: breastServing, quantity: 3 });
});

test('quantity is inert on a weight-only portion, and says so by leaving it unchanged', () => {
  const byWeight = portionForSelection(chicken, undefined, 1, 250);
  assert.deepEqual(portionWithQuantity(byWeight, 3), byWeight);
});
