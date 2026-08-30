import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, Recipe } from '../src/domain';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  RecipeId,
} from '../src/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  RecipeRepository,
} from '../src/data/repositories/contracts';
import { FoodLoggingService } from '../src/services/logging/food-logging';
import {
  RecipeService,
  recipeFoodId,
  recipeGramsForServings,
  recipeRevisionFoodId,
} from '../src/services/meals/saved-meals';
import { buildTodaySnapshot } from '../src/services/today/snapshot';

const createdAt = '2026-08-29T12:00:00.000Z' as ISODateTime;
const firstRevisionAt = '2026-08-29T13:00:00.000Z' as ISODateTime;
const firstLogAt = '2026-08-29T18:00:00.000Z' as ISODateTime;
const secondRevisionAt = '2026-08-30T13:00:00.000Z' as ISODateTime;
const secondLogAt = '2026-08-30T18:00:00.000Z' as ISODateTime;

class MemoryFoodRepository implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  readonly deleted: FoodId[] = [];

  async getById(id: FoodId) { return this.values.get(id) ?? null; }
  async save(value: Food) { this.values.set(value.id, value); }
  async delete(id: FoodId) {
    this.deleted.push(id);
    this.values.delete(id);
  }
  async list(limit = 100) { return [...this.values.values()].slice(0, limit); }
}

class MemoryRecipeRepository implements RecipeRepository {
  readonly values = new Map<RecipeId, Recipe>();

  async getById(id: RecipeId) { return this.values.get(id) ?? null; }
  async save(value: Recipe) { this.values.set(value.id, value); }
  async delete(id: RecipeId) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}

class MemoryMealRepository implements MealRepository {
  readonly values = new Map<MealId, Meal>();

  async getById(id: MealId) { return this.values.get(id) ?? null; }
  async save(value: Meal) { this.values.set(value.id, value); }
  async delete(id: MealId) { this.values.delete(id); }
  async listByDateRange(start: string, end: string) {
    return [...this.values.values()].filter(
      (meal) => meal.occurredAt >= start && meal.occurredAt < end,
    );
  }
  async listRecent(limit = 250) { return [...this.values.values()].slice(0, limit); }
}

function ingredientFood(): Food {
  const id = 'personal:immutable-ingredient' as FoodId;
  return {
    id,
    kind: 'custom',
    name: 'Protein ingredient',
    nutrition: {
      basisGrams: 100,
      nutrients: [
        {
          nutrient: { code: 'protein-g', name: 'Protein', unit: 'g' },
          state: 'known',
          value: 10,
        },
      ],
    },
    servings: [
      {
        id: 'serving:immutable-ingredient' as FoodServingId,
        foodId: id,
        label: '100 g',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
        isDefault: true,
      },
    ],
    createdAt,
    updatedAt: createdAt,
  };
}

function recipeRevision(
  ingredient: Food,
  updatedAt: ISODateTime,
  ingredientGrams: number,
  name: string,
): Recipe {
  return {
    id: 'recipe-immutable-history' as RecipeId,
    name,
    ingredients: [
      { foodId: ingredient.id, quantity: 1, gramWeight: ingredientGrams },
    ],
    yieldServings: 2,
    totalYieldGrams: ingredientGrams,
    createdAt,
    updatedAt,
  };
}

const noGoals = { async save() {}, async listActive() { return []; } };

async function proteinForDay(
  date: Date,
  foods: FoodRepository,
  meals: MealRepository,
): Promise<number | null | undefined> {
  const snapshot = await buildTodaySnapshot(date, { foods, meals, goals: noGoals });
  assert.deepEqual(snapshot.unavailableItems, []);
  return snapshot.metrics.find((metric) => metric.code === 'protein-g')?.value;
}

test('recipe edit and delete retain immutable fractional-serving totals for every revision', async () => {
  const foods = new MemoryFoodRepository();
  const recipes = new MemoryRecipeRepository();
  const meals = new MemoryMealRepository();
  const ingredient = ingredientFood();
  await foods.save(ingredient);
  let sequence = 0;
  const recipeService = new RecipeService(recipes, foods);
  const logging = new FoodLoggingService(foods, meals, (prefix) => `${prefix}:${++sequence}`);

  const first = recipeRevision(ingredient, firstRevisionAt, 200, 'Protein bowl');
  const savedFirstFood = await recipeService.save(first);
  const firstFood = await recipeService.resolveRevisionFood(first);
  assert.equal(firstFood.id, recipeRevisionFoodId(first));
  assert.equal(firstFood, savedFirstFood);
  await logging.logFood(firstFood, recipeGramsForServings(first, 0.5), firstLogAt);
  const firstTotalBeforeEdit = await proteinForDay(
    new Date(firstLogAt),
    foods,
    meals,
  );

  const second = recipeRevision(ingredient, secondRevisionAt, 400, 'Protein bowl, edited');
  const savedSecondFood = await recipeService.save(second);
  const secondFood = await recipeService.resolveRevisionFood(second);
  assert.equal(secondFood.id, recipeRevisionFoodId(second));
  assert.equal(secondFood, savedSecondFood);
  assert.notEqual(secondFood.id, firstFood.id);
  await logging.logFood(secondFood, recipeGramsForServings(second, 0.5), secondLogAt);

  await recipeService.delete(second.id);

  assert.equal(await recipes.getById(second.id), null);
  assert.deepEqual(foods.deleted, []);
  assert.deepEqual(await foods.getById(firstFood.id), firstFood);
  assert.deepEqual(await foods.getById(secondFood.id), secondFood);
  assert.equal(
    await proteinForDay(new Date(firstLogAt), foods, meals),
    firstTotalBeforeEdit,
  );
  assert.equal(firstTotalBeforeEdit, 5);
  assert.equal(await proteinForDay(new Date(secondLogAt), foods, meals), 10);
});

test('deleting recipe metadata retains legacy unversioned recipe foods and logs', async () => {
  const foods = new MemoryFoodRepository();
  const recipes = new MemoryRecipeRepository();
  const meals = new MemoryMealRepository();
  const legacyRecipe: Recipe = {
    id: 'legacy-history' as RecipeId,
    name: 'Legacy recipe',
    ingredients: [],
    yieldServings: 1,
    createdAt,
    updatedAt: firstRevisionAt,
  };
  const id = recipeFoodId(legacyRecipe.id);
  const legacyFood: Food = {
    id,
    kind: 'recipe',
    name: legacyRecipe.name,
    nutrition: {
      basisGrams: 100,
      nutrients: [
        {
          nutrient: { code: 'protein-g', name: 'Protein', unit: 'g' },
          state: 'known',
          value: 12,
        },
      ],
    },
    servings: [
      {
        id: 'recipe-serving:legacy-history' as FoodServingId,
        foodId: id,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
      },
    ],
    createdAt,
    updatedAt: firstRevisionAt,
  };
  await foods.save(legacyFood);
  await recipes.save(legacyRecipe);
  let sequence = 0;
  await new FoodLoggingService(foods, meals, (prefix) => `${prefix}:${++sequence}`).logFood(
    legacyFood,
    50,
    firstLogAt,
  );

  await new RecipeService(recipes, foods).delete(legacyRecipe.id);

  assert.deepEqual(await foods.getById(id), legacyFood);
  assert.equal(await proteinForDay(new Date(firstLogAt), foods, meals), 6);
});
