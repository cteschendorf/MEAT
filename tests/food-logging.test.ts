import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal } from '../src/domain';
import type { FoodRepository, MealRepository } from '../src/data/repositories/contracts';
import type { ISODateTime } from '../src/domain/shared/ids';
import { FoodLoggingService } from '../src/services/logging/food-logging';

const foods: Food[] = [];
const meals: Meal[] = [];
const foodRepository: FoodRepository = {
  async getById(id) { return foods.find((food) => food.id === id) ?? null; },
  async save(food) {
    const index = foods.findIndex((value) => value.id === food.id);
    if (index < 0) foods.push(food);
    else foods[index] = food;
  },
  async delete() {},
  async list() { return foods; },
};
const mealRepository: MealRepository = {
  async getById(id) { return meals.find((meal) => meal.id === id) ?? null; },
  async save(meal) { meals.push(meal); },
  async delete(id) {
    const index = meals.findIndex((meal) => meal.id === id);
    if (index >= 0) meals.splice(index, 1);
  },
  async listByDateRange() { return meals; },
};
let sequence = 0;
const service = new FoodLoggingService(
  foodRepository,
  mealRepository,
  (prefix) => `${prefix}:${++sequence}`,
);
const now = '2026-08-29T00:00:00.000Z' as ISODateTime;

test('manual food preserves blank nutrient as unknown and explicit zero as known', async () => {
  const food = await service.createManualFood(
    { name: 'Test', servingGrams: 50, calories: 0, protein: 10 },
    now,
  );
  assert.match(food.id, /^personal:/);
  assert.equal(
    food.nutrition.nutrients.find((nutrient) => nutrient.nutrient.code === 'energy-kcal')?.state,
    'known',
  );
  assert.equal(
    food.nutrition.nutrients.find((nutrient) => nutrient.nutrient.code === 'energy-kcal')?.value,
    0,
  );
  assert.equal(
    food.nutrition.nutrients.find((nutrient) => nutrient.nutrient.code === 'fiber-g')?.state,
    'unknown',
  );
});

test('logging persists the selected food before its meal with a gram portion', async () => {
  const food = foods[0];
  assert.ok(food);
  const meal = await service.logFood(food, 125, now);
  assert.equal(meal.items[0]?.portion.gramWeight, 125);
  assert.equal(meals.at(-1)?.id, meal.id);
  assert.deepEqual(await foodRepository.getById(food.id), food);
});

test('manual nutrition and logged gram amounts reject negative or non-finite values', async () => {
  await assert.rejects(
    service.createManualFood({ name: 'Invalid', servingGrams: Number.POSITIVE_INFINITY }, now),
    /finite number greater than zero/,
  );
  await assert.rejects(
    service.createManualFood({ name: 'Invalid', servingGrams: 100, protein: -1 }, now),
    /Protein must be a finite nonnegative number/,
  );
  const food = foods[0];
  assert.ok(food);
  await assert.rejects(service.logFood(food, Number.POSITIVE_INFINITY, now), /finite number/);
  await assert.rejects(service.logFood(food, -1, now), /finite number/);
});
