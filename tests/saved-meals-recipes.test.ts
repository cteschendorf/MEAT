import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, Recipe, SavedMeal } from '../src/domain/index';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  RecipeId,
  SavedMealId,
} from '../src/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  RecipeRepository,
  SavedMealRepository,
} from '../src/data/repositories/contracts';
import {
  materializeRecipeFood,
  RecipeService,
  SavedMealService,
} from '../src/services/meals/saved-meals';

const now = '2026-08-29T15:00:00.000Z' as ISODateTime;
const protein = { code: 'protein-g', name: 'Protein', unit: 'g' } as const;

function food(id: string, proteinPer100g: number): Food {
  const foodId = id as FoodId;
  return {
    id: foodId,
    kind: 'generic',
    name: id,
    nutrition: {
      basisGrams: 100,
      nutrients: [{ nutrient: protein, state: 'known', value: proteinPer100g }],
    },
    servings: [
      {
        id: `${id}-serving` as FoodServingId,
        foodId,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function recipe(ingredient: Food, grams = 200, servings = 2): Recipe {
  return {
    id: 'recipe-1' as RecipeId,
    name: 'Protein bowl',
    ingredients: [{ foodId: ingredient.id, quantity: 1, gramWeight: grams }],
    yieldServings: servings,
    createdAt: now,
    updatedAt: now,
  };
}

class MemoryFoodRepository implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  async getById(id: FoodId) { return this.values.get(id) ?? null; }
  async save(value: Food) { this.values.set(value.id, value); }
  async delete(id: FoodId) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}

class MemoryRecipeRepository implements RecipeRepository {
  readonly values = new Map<RecipeId, Recipe>();
  async getById(id: RecipeId) { return this.values.get(id) ?? null; }
  async save(value: Recipe) { this.values.set(value.id, value); }
  async delete(id: RecipeId) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}

class MemorySavedMealRepository implements SavedMealRepository {
  readonly values = new Map<SavedMealId, SavedMeal>();
  async getById(id: SavedMealId) { return this.values.get(id) ?? null; }
  async save(value: SavedMeal) { this.values.set(value.id, value); }
  async delete(id: SavedMealId) { this.values.delete(id); }
  async list() { return [...this.values.values()]; }
}

class MemoryMealRepository implements MealRepository {
  readonly values = new Map<MealId, Meal>();
  async getById(id: MealId) { return this.values.get(id) ?? null; }
  async save(value: Meal) { this.values.set(value.id, value); }
  async delete(id: MealId) { this.values.delete(id); }
  async listByDateRange() { return [...this.values.values()]; }
  async listRecent(limit = 250) { return [...this.values.values()].slice(0, limit); }
}

test('materializes a recipe as an ordinary recipe-kind food for the logging flow', () => {
  const chicken = food('chicken', 30);
  const result = materializeRecipeFood(recipe(chicken), new Map([[chicken.id, chicken]]));

  assert.equal(result.kind, 'recipe');
  assert.equal(result.servings[0]?.gramWeight, 100);
  assert.equal(result.nutrition.basisGrams, 100);
  assert.equal(result.nutrition.nutrients[0]?.value, 30);
});

test('recipe edits recalculate deterministic per-serving nutrition', () => {
  const oats = food('oats', 10);
  const original = materializeRecipeFood(recipe(oats, 200, 2), new Map([[oats.id, oats]]));
  const edited = materializeRecipeFood(recipe(oats, 300, 2), new Map([[oats.id, oats]]));

  assert.equal(original.nutrition.nutrients[0]?.value, 10);
  assert.equal(edited.nutrition.nutrients[0]?.value, 15);
});

test('recipe service persists recipe and its logging-compatible food representation', async () => {
  const ingredient = food('yogurt', 12);
  const foods = new MemoryFoodRepository();
  await foods.save(ingredient);
  const recipes = new MemoryRecipeRepository();
  const service = new RecipeService(recipes, foods);
  const value = recipe(ingredient);

  const recipeFood = await service.save(value);

  assert.deepEqual(await recipes.getById(value.id), value);
  assert.deepEqual(await foods.getById(recipeFood.id), recipeFood);
});

test('saved meal duplicates receive new identity without sharing mutable portion objects', () => {
  let sequence = 0;
  const service = new SavedMealService(
    new MemorySavedMealRepository(),
    new MemoryMealRepository(),
    (prefix) => `${prefix}-${++sequence}`,
  );
  const template: SavedMeal = {
    id: 'saved-1' as SavedMealId,
    name: 'Lunch',
    items: [{ foodId: 'food-1' as FoodId, portion: { quantity: 1, gramWeight: 150 } }],
    createdAt: now,
    updatedAt: now,
  };

  const duplicate = service.duplicate(template, now);

  assert.notEqual(duplicate.id, template.id);
  assert.equal(duplicate.name, 'Lunch copy');
  assert.notEqual(duplicate.items[0]?.portion, template.items[0]?.portion);
});

test('logging a saved meal preserves whole or partial quantities in a new meal instance', async () => {
  let sequence = 0;
  const meals = new MemoryMealRepository();
  const service = new SavedMealService(
    new MemorySavedMealRepository(),
    meals,
    (prefix) => `${prefix}-${++sequence}`,
  );
  const template: SavedMeal = {
    id: 'saved-2' as SavedMealId,
    name: 'Breakfast',
    items: [
      { foodId: 'food-1' as FoodId, portion: { quantity: 0.5, gramWeight: 50 } },
      { foodId: 'food-2' as FoodId, portion: { quantity: 2, gramWeight: 200 } },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const logged = await service.log(template, now);

  assert.equal(logged.title, 'Breakfast');
  assert.equal(logged.items[0]?.portion.quantity, 0.5);
  assert.equal(logged.items[1]?.portion.quantity, 2);
  assert.deepEqual(await meals.getById(logged.id), logged);
});
