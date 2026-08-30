import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, NutrientDefinition, NutritionFacts, Recipe } from '../src/domain/index';
import type { FoodId, FoodServingId, ISODateTime, MealId, MealItemId, RecipeId } from '../src/domain/shared/ids';
import {
  aggregateNutritionFacts,
  gramsForFoodPortion,
  nutritionForMeal,
  nutritionPerRecipeServing,
  ouncesToGrams,
  roundNutritionForDisplay,
  scaleNutritionFacts,
} from '../src/services/nutrition/engine';

const protein: NutrientDefinition = { code: 'protein-g', name: 'Protein', unit: 'g' };
const energy: NutrientDefinition = { code: 'energy-kcal', name: 'Energy', unit: 'kcal' };
const fiber: NutrientDefinition = { code: 'fiber-g', name: 'Fiber', unit: 'g' };

const now = '2026-08-29T00:00:00.000Z' as ISODateTime;

function food(id: string, nutrition: NutritionFacts): Food {
  return {
    id: id as FoodId,
    kind: 'generic',
    name: id,
    nutrition,
    servings: [
      {
        id: `${id}-serving` as FoodServingId,
        foodId: id as FoodId,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 50,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

test('converts ounces to grams without premature rounding', () => {
  assert.ok(Math.abs(ouncesToGrams(1) - 28.349523125) < 1e-12);
});

test('scales per-100g facts and preserves explicit unknown values', () => {
  const scaled = scaleNutritionFacts(
    {
      basisGrams: 100,
      nutrients: [
        { nutrient: energy, state: 'known', value: 200 },
        { nutrient: protein, state: 'known', value: 20 },
        { nutrient: fiber, state: 'unknown' },
      ],
    },
    25,
  );

  assert.equal(scaled.nutrients[0]?.value, 50);
  assert.equal(scaled.nutrients[1]?.value, 5);
  assert.equal(scaled.nutrients[2]?.state, 'unknown');
  assert.equal(scaled.nutrients[2]?.value, undefined);
});

test('uses serving gram weight for partial servings', () => {
  const item = food('toast', { basisGrams: 100, nutrients: [] });
  assert.equal(
    gramsForFoodPortion(item, { servingId: 'toast-serving', quantity: 0.5 }),
    25,
  );
});

test('known zero remains distinct from unknown when aggregating', () => {
  const total = aggregateNutritionFacts([
    { nutrients: [{ nutrient: fiber, state: 'known', value: 0 }] },
    { nutrients: [{ nutrient: fiber, state: 'known', value: 4 }] },
  ]);
  assert.equal(total.nutrients[0]?.state, 'known');
  assert.equal(total.nutrients[0]?.value, 4);
});

test('missing nutrient data makes that aggregate nutrient unknown', () => {
  const total = aggregateNutritionFacts([
    { nutrients: [{ nutrient: protein, state: 'known', value: 10 }] },
    { nutrients: [{ nutrient: energy, state: 'known', value: 100 }] },
  ]);
  assert.equal(total.nutrients.find((entry) => entry.nutrient.code === 'protein-g')?.state, 'unknown');
  assert.equal(total.nutrients.find((entry) => entry.nutrient.code === 'energy-kcal')?.state, 'unknown');
});

test('calculates meal nutrition deterministically from food records', () => {
  const chicken = food('chicken', {
    basisGrams: 100,
    nutrients: [
      { nutrient: energy, state: 'known', value: 165 },
      { nutrient: protein, state: 'known', value: 31 },
    ],
  });
  const meal: Meal = {
    id: 'meal-1' as MealId,
    occurredAt: now,
    items: [
      {
        id: 'meal-item-1' as MealItemId,
        foodId: chicken.id,
        portion: { gramWeight: 200, quantity: 1 },
      },
    ],
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
  };
  const total = nutritionForMeal(meal, new Map([[chicken.id, chicken]]));
  assert.equal(total.nutrients.find((entry) => entry.nutrient.code === 'energy-kcal')?.value, 330);
  assert.equal(total.nutrients.find((entry) => entry.nutrient.code === 'protein-g')?.value, 62);
});

test('calculates recipe nutrition per serving', () => {
  const oats = food('oats', {
    basisGrams: 100,
    nutrients: [{ nutrient: protein, state: 'known', value: 10 }],
  });
  const recipe: Recipe = {
    id: 'recipe-1' as RecipeId,
    name: 'Oats',
    ingredients: [{ foodId: oats.id, quantity: 1, gramWeight: 200 }],
    yieldServings: 2,
    createdAt: now,
    updatedAt: now,
  };
  const perServing = nutritionPerRecipeServing(recipe, new Map([[oats.id, oats]]));
  assert.equal(perServing.nutrients[0]?.value, 10);
});

test('rounds only for display', () => {
  assert.equal(roundNutritionForDisplay('energy-kcal', 123.6), 124);
  assert.equal(roundNutritionForDisplay('protein-g', 12.345), 12.3);
});

test('calculation rejects corrupt negative and non-finite nutrition data', () => {
  assert.throws(
    () => scaleNutritionFacts({
      basisGrams: 100,
      nutrients: [{ nutrient: protein, state: 'known', value: -1 }],
    }, 50),
    /finite nonnegative nutrition value/,
  );
  assert.throws(
    () => scaleNutritionFacts({
      basisGrams: 100,
      nutrients: [{ nutrient: protein, state: 'known', value: Number.POSITIVE_INFINITY }],
    }, 50),
    /finite nonnegative nutrition value/,
  );
  assert.throws(
    () => scaleNutritionFacts({ basisGrams: 100, nutrients: [] }, Number.POSITIVE_INFINITY),
    /finite nonnegative/,
  );
  assert.throws(
    () => aggregateNutritionFacts([{
      nutrients: [{ nutrient: protein, state: 'known', value: -1 }],
    }]),
    /finite nonnegative nutrition value/,
  );
});
