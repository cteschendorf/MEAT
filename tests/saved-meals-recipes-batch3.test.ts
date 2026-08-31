import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, Recipe, SavedMeal } from '../src/domain/index';
import { foodIdForRef, type FoodRef } from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  RecipeId,
  SavedMealId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  RecipeRepository,
  SavedMealRepository,
} from '../src/data/repositories/contracts';
import {
  foodRefForFoodId,
  materializeRecipeFood,
  RecipeService,
  recipeGramsForServings,
  recipeServingGrams,
  resolvedFoodId,
  SavedMealService,
} from '../src/services/meals/saved-meals';

const now = '2026-08-29T18:00:00.000Z' as ISODateTime;
const later = '2026-08-29T19:00:00.000Z' as ISODateTime;
const protein = { code: 'protein-g', name: 'Protein', unit: 'g' } as const;

function ref(sourceId: FoodRef['sourceId'], recordId: string): FoodRef {
  return { sourceId, recordId: recordId as SourceRecordId };
}

function food(foodRef: FoodRef, name: string, proteinPer100g: number): Food {
  const id = foodIdForRef(foodRef);
  return {
    id,
    kind: foodRef.sourceId === 'personal' ? 'custom' : 'generic',
    name,
    nutrition: {
      basisGrams: 100,
      nutrients: [{ nutrient: protein, state: 'known', value: proteinPer100g }],
    },
    servings: [
      {
        id: `${id}:serving` as FoodServingId,
        foodId: id,
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

class MemoryFoodRepository implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  readonly requestedIds: FoodId[] = [];

  async getById(id: FoodId) {
    this.requestedIds.push(id);
    return this.values.get(id) ?? null;
  }

  async save(value: Food) {
    this.values.set(value.id, value);
  }

  async delete(id: FoodId) {
    this.values.delete(id);
  }

  async list(limit = 100) {
    return [...this.values.values()].slice(0, limit);
  }
}

class MemoryRecipeRepository implements RecipeRepository {
  readonly values = new Map<RecipeId, Recipe>();

  async getById(id: RecipeId) {
    return this.values.get(id) ?? null;
  }

  async save(value: Recipe) {
    this.values.set(value.id, value);
  }

  async delete(id: RecipeId) {
    this.values.delete(id);
  }

  async list() {
    return [...this.values.values()];
  }
}

class MemorySavedMealRepository implements SavedMealRepository {
  readonly values = new Map<SavedMealId, SavedMeal>();

  async getById(id: SavedMealId) {
    return this.values.get(id) ?? null;
  }

  async save(value: SavedMeal) {
    this.values.set(value.id, value);
  }

  async delete(id: SavedMealId) {
    this.values.delete(id);
  }

  async list() {
    return [...this.values.values()];
  }
}

class MemoryMealRepository implements MealRepository {
  readonly values = new Map<MealId, Meal>();
  saveCalls = 0;
  failNextSave = false;

  async getById(id: MealId) {
    return this.values.get(id) ?? null;
  }

  async save(value: Meal) {
    this.saveCalls += 1;
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('transaction failed');
    }
    this.values.set(value.id, value);
  }

  async delete(id: MealId) {
    this.values.delete(id);
  }

  async listByDateRange() {
    return [...this.values.values()];
  }

  async listRecent(limit = 250) {
    return [...this.values.values()].slice(0, limit);
  }
}

test('FoodRef helpers preserve provider identity while legacy food IDs still resolve unchanged', () => {
  const externalRef = ref('usda-fdc', '123/abc');
  const externalId = foodIdForRef(externalRef);
  assert.deepEqual(foodRefForFoodId(externalId), externalRef);
  assert.equal(resolvedFoodId({ foodId: 'legacy-food' as FoodId }), 'legacy-food');
  assert.equal(
    resolvedFoodId({
      foodId: 'food:build-1-personal' as FoodId,
      foodRef: ref('personal', 'food:build-1-personal'),
    }),
    'food:build-1-personal',
  );
  assert.equal(
    resolvedFoodId({ foodId: 'legacy-food' as FoodId, foodRef: externalRef }),
    externalId,
  );
  assert.deepEqual(foodRefForFoodId('legacy-food' as FoodId), ref('personal', 'legacy-food'));
});

test('recipe service saves multiple source-aware ingredients and calculates deterministic servings', async () => {
  const oatsRef = ref('personal', 'oats');
  const yogurtRef = ref('usda-fdc', '98765');
  const oats = food(oatsRef, 'Oats', 10);
  const yogurt = food(yogurtRef, 'Yogurt', 20);
  const foods = new MemoryFoodRepository();
  await foods.save(oats);
  await foods.save(yogurt);
  const recipes = new MemoryRecipeRepository();
  const service = new RecipeService(recipes, foods, () => 'unused');
  const value: Recipe = {
    id: 'recipe-source-aware' as RecipeId,
    name: 'Oats and yogurt',
    ingredients: [
      { foodId: oats.id, foodRef: oatsRef, quantity: 1, gramWeight: 100 },
      {
        foodId: 'legacy-yogurt-alias' as FoodId,
        foodRef: yogurtRef,
        quantity: 1,
        gramWeight: 200,
      },
    ],
    yieldServings: 4,
    totalYieldGrams: 600,
    createdAt: now,
    updatedAt: now,
  };

  const recipeFood = await service.save(value);

  assert.deepEqual(await service.getById(value.id), value);
  assert.deepEqual(await service.list(), [value]);
  assert.ok(foods.requestedIds.includes(foodIdForRef(yogurtRef)));
  assert.equal(recipeFood.servings[0]?.gramWeight, 150);
  assert.equal(recipeFood.nutrition.basisGrams, 150);
  assert.equal(recipeFood.nutrition.nutrients[0]?.value, 12.5);
});

test('recipe serving math supports deterministic fractional logging amounts', () => {
  const ingredient = food(ref('personal', 'rice'), 'Rice', 5);
  const recipe: Recipe = {
    id: 'recipe-fractional' as RecipeId,
    name: 'Rice batch',
    ingredients: [{ foodId: ingredient.id, quantity: 1, gramWeight: 900 }],
    yieldServings: 6,
    totalYieldGrams: 900,
    createdAt: now,
    updatedAt: now,
  };

  assert.equal(recipeServingGrams(recipe), 150);
  assert.equal(recipeGramsForServings(recipe, 0.25), 37.5);
  assert.equal(recipeGramsForServings(recipe, 1.5), 225);
  assert.throws(() => recipeGramsForServings(recipe, 0), /greater than zero/);
});

test('recipe duplication deep-copies source-aware ingredients and remains logging-compatible', () => {
  let sequence = 0;
  const ingredient = food(ref('usda-core', '321'), 'Beans', 12);
  const service = new RecipeService(
    new MemoryRecipeRepository(),
    new MemoryFoodRepository(),
    (prefix) => `${prefix}-${++sequence}`,
  );
  const original: Recipe = {
    id: 'recipe-original' as RecipeId,
    name: 'Beans',
    ingredients: [
      {
        foodId: ingredient.id,
        foodRef: ref('usda-core', '321'),
        quantity: 1,
        gramWeight: 300,
      },
    ],
    yieldServings: 3,
    createdAt: now,
    updatedAt: now,
  };

  const duplicate = service.duplicate(original, later);
  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.name, 'Beans copy');
  assert.notEqual(duplicate.ingredients, original.ingredients);
  assert.notEqual(duplicate.ingredients[0], original.ingredients[0]);
  assert.notEqual(duplicate.ingredients[0]?.foodRef, original.ingredients[0]?.foodRef);
  assert.equal(recipeServingGrams(duplicate), 100);
});

test('saved-meal CRUD preserves multiple items and logging writes one complete meal transaction', async () => {
  let sequence = 0;
  const savedMeals = new MemorySavedMealRepository();
  const meals = new MemoryMealRepository();
  const service = new SavedMealService(savedMeals, meals, (prefix) => `${prefix}-${++sequence}`);
  const externalRef = ref('open-food-facts', '0042');
  const value: SavedMeal = {
    id: 'saved-source-aware' as SavedMealId,
    name: 'Breakfast plate',
    items: [
      { foodId: 'legacy-toast' as FoodId, portion: { quantity: 1, gramWeight: 60 } },
      {
        foodId: 'legacy-product-alias' as FoodId,
        foodRef: externalRef,
        portion: { quantity: 0.5, gramWeight: 125 },
        note: 'half package',
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await service.save(value);
  assert.deepEqual(await service.getById(value.id), value);
  assert.deepEqual(await service.list(), [value]);

  const logged = await service.log(value, later);
  assert.equal(meals.saveCalls, 1);
  assert.equal(meals.values.size, 1);
  assert.equal(logged.items.length, 2);
  assert.equal(logged.items[0]?.foodId, 'legacy-toast');
  assert.equal(logged.items[1]?.foodId, foodIdForRef(externalRef));
  assert.deepEqual(logged.items[1]?.foodRef, externalRef);
  assert.notEqual(logged.items[1]?.foodRef, value.items[1]?.foodRef);
  assert.equal(logged.items[1]?.portion.quantity, 0.5);

  await service.delete(value.id);
  assert.equal(await service.getById(value.id), null);
});

test('failed saved-meal logging does not split a multi-item meal into partial writes', async () => {
  const meals = new MemoryMealRepository();
  meals.failNextSave = true;
  const service = new SavedMealService(
    new MemorySavedMealRepository(),
    meals,
    (prefix) => `${prefix}-1`,
  );
  const value: SavedMeal = {
    id: 'saved-transaction' as SavedMealId,
    name: 'Two foods',
    items: [
      { foodId: 'one' as FoodId, portion: { quantity: 1, gramWeight: 10 } },
      { foodId: 'two' as FoodId, portion: { quantity: 1, gramWeight: 20 } },
    ],
    createdAt: now,
    updatedAt: now,
  };

  await assert.rejects(service.log(value, later), /transaction failed/);
  assert.equal(meals.saveCalls, 1);
  assert.equal(meals.values.size, 0);
});

test('legacy recipes without FoodRefs retain their existing materialization behavior', () => {
  const legacyId = 'legacy-chicken' as FoodId;
  const ingredient: Food = {
    ...food(ref('personal', 'placeholder'), 'Chicken', 30),
    id: legacyId,
    servings: [],
  };
  const recipe: Recipe = {
    id: 'legacy-recipe' as RecipeId,
    name: 'Legacy chicken',
    ingredients: [{ foodId: legacyId, quantity: 1, gramWeight: 200 }],
    yieldServings: 2,
    createdAt: now,
    updatedAt: now,
  };

  const result = materializeRecipeFood(recipe, new Map([[legacyId, ingredient]]));
  assert.equal(result.nutrition.nutrients[0]?.value, 30);
  assert.equal(result.servings[0]?.gramWeight, 100);
});
