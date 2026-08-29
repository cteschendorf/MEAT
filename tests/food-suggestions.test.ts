import assert from 'node:assert/strict';
import test from 'node:test';

import type { Meal } from '../src/domain';
import type { FoodId, ISODateTime, MealId, MealItemId } from '../src/domain/shared/ids';
import { rankFoodUsage } from '../src/services/logging/food-suggestions';

const foodId = (value: string) => value as FoodId;
const localIso = (day: number, hour: number) =>
  new Date(2026, 7, day, hour, 0, 0, 0).toISOString() as ISODateTime;

function meal(id: number, occurredAt: ISODateTime, food: FoodId, grams: number): Meal {
  return {
    id: `meal:${id}` as MealId,
    occurredAt,
    items: [
      {
        id: `item:${id}` as MealItemId,
        foodId: food,
        portion: { quantity: 1, gramWeight: grams },
      },
    ],
    mediaIds: [],
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
}

test('favorites remain first-class suggestions even without prior logs', () => {
  const favorite = foodId('food:favorite');
  const frequent = foodId('food:frequent');
  const meals = Array.from({ length: 10 }, (_, index) =>
    meal(index, localIso(28 - index, 18), frequent, 150),
  );

  const ranked = rankFoodUsage(meals, [favorite], localIso(29, 18));
  assert.equal(ranked[0]?.foodId, favorite);
  assert.equal(ranked[0]?.favorite, true);
  assert.equal(ranked[0]?.logCount, 0);
});

test('ranking preserves recent portion and deterministic usage counts', () => {
  const oats = foodId('food:oats');
  const ranked = rankFoodUsage(
    [meal(1, localIso(27, 8), oats, 80), meal(2, localIso(29, 8), oats, 95)],
    [],
    localIso(29, 8),
  );

  assert.equal(ranked[0]?.foodId, oats);
  assert.equal(ranked[0]?.logCount, 2);
  assert.equal(ranked[0]?.contextLogCount, 2);
  assert.equal(ranked[0]?.lastGramWeight, 95);
});

test('same-time-of-day history can outweigh a slightly more recent off-context log', () => {
  const lunch = foodId('food:lunch');
  const breakfast = foodId('food:breakfast');
  const ranked = rankFoodUsage(
    [meal(1, localIso(26, 12), lunch, 300), meal(2, localIso(28, 8), breakfast, 100)],
    [],
    localIso(29, 12),
  );

  assert.equal(ranked[0]?.foodId, lunch);
});
