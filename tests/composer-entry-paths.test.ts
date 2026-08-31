import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, FoodCandidate, Meal, Recipe, SavedMeal } from '../src/domain';
import { foodIdForRef } from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  RecipeId,
  SavedMealId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import type { FoodRepository, MealRepository } from '../src/data/repositories/contracts';
import type { AppServices } from '../src/services/app-services';
import { MealComposerService } from '../src/services/meals/meal-composer';
import {
  addCandidateToComposer,
  addPersonalFoodToComposer,
  addRecipeSnapshotToComposer,
  prefillSavedMealComposer,
} from '../src/ui/meal-composer-entry';
import { mealComposerSessions } from '../src/ui/meal-composer-session';

const now = '2026-08-29T18:00:00.000Z' as ISODateTime;

class MemoryFoodRepository implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  async getById(id: FoodId) { return this.values.get(id) ?? null; }
  async save(value: Food) { this.values.set(value.id, value); }
  async delete(id: FoodId) { this.values.delete(id); }
  async list(limit = 100) { return [...this.values.values()].slice(0, limit); }
}

class MemoryMealRepository implements MealRepository {
  readonly values = new Map<MealId, Meal>();
  saveCalls = 0;
  async getById(id: MealId) { return this.values.get(id) ?? null; }
  async save(value: Meal) { this.saveCalls += 1; this.values.set(value.id, value); }
  async delete(id: MealId) { this.values.delete(id); }
  async listByDateRange() { return [...this.values.values()]; }
  async listRecent(limit = 250) { return [...this.values.values()].slice(0, limit); }
}

function makeIds() {
  let sequence = 0;
  return (prefix: string) => `${prefix}:entry:${++sequence}`;
}

function food(sourceId: 'personal' | 'usda-fdc', recordId: string, name: string): Food {
  const ref = { sourceId, recordId: recordId as SourceRecordId };
  const id = foodIdForRef(ref);
  return {
    id,
    kind: sourceId === 'personal' ? 'custom' : 'generic',
    name,
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [{
      id: `${id}:serving` as FoodServingId,
      foodId: id,
      label: 'serving',
      quantity: 1,
      unit: 'serving',
      gramWeight: 100,
    }],
    createdAt: now,
    updatedAt: now,
  };
}

function candidate(value: Food): FoodCandidate {
  const recordId = value.id.slice(value.id.indexOf(':') + 1) as SourceRecordId;
  const ref = { sourceId: 'usda-fdc' as const, recordId };
  return {
    ref,
    food: value,
    portions: [{
      id: value.servings[0]!.id,
      label: 'serving',
      quantity: 1,
      unit: 'serving',
      gramWeight: 100,
    }],
    provenance: { provider: 'usda-fdc', recordId },
  };
}

function harness(providerCandidates: readonly FoodCandidate[] = []) {
  const foods = new MemoryFoodRepository();
  const meals = new MemoryMealRepository();
  const persisted: string[] = [];
  const byFoodId = new Map(providerCandidates.map((value) => [value.food.id, value]));
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist(value) { persisted.push(`${value.ref.sourceId}:${value.ref.recordId}`); } },
    makeIds(),
  );
  const services = {
    foods,
    mealComposer: composer,
    discovery: {
      async getByFoodId(id: FoodId) { return byFoodId.get(id) ?? null; },
    },
    recipeService: {
      async resolveRevisionFood() { throw new Error('No recipe snapshot configured.'); },
    },
  } as unknown as AppServices;
  return { services, foods, meals, persisted };
}

test('manual and barcode paths add to one shared draft without creating a Meal', async () => {
  const manual = food('personal', 'manual', 'Manual yogurt');
  const externalCandidate = candidate(food('usda-fdc', '1234', 'USDA yogurt'));
  const { services, meals, persisted } = harness([externalCandidate]);

  const first = await addPersonalFoodToComposer(services, undefined, manual, 170, now);
  assert.equal(first.created, true);
  assert.equal(first.session.draft.items.length, 1);

  const second = await addCandidateToComposer(
    services,
    first.session.draft.id,
    externalCandidate,
    90,
    now,
  );
  assert.equal(second.created, false);
  assert.deepEqual(second.session.draft.items.map((item) => item.portion.gramWeight), [170, 90]);
  assert.deepEqual(persisted, ['usda-fdc:1234']);
  assert.equal(meals.saveCalls, 0);
  mealComposerSessions.clear(first.session.draft.id);
});

test('saved meals prefill every source-aware item and their optional event name', async () => {
  const personal = food('personal', 'oats', 'Oats');
  const externalCandidate = candidate(food('usda-fdc', '5678', 'Milk'));
  const { services, foods, meals, persisted } = harness([externalCandidate]);
  await foods.save(personal);
  const savedMeal: SavedMeal = {
    id: 'saved-meal:breakfast' as SavedMealId,
    name: 'Post-workout breakfast',
    items: [
      { foodId: personal.id, portion: { quantity: 1, gramWeight: 80 } },
      {
        foodId: externalCandidate.food.id,
        foodRef: { ...externalCandidate.ref },
        portion: { quantity: 1, gramWeight: 240 },
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  const result = await prefillSavedMealComposer(services, undefined, savedMeal, now);
  assert.equal(result.session.draft.context.title, savedMeal.name);
  assert.equal(result.session.draft.items.length, 2);
  assert.deepEqual(result.session.draft.items.map((item) => item.portion.gramWeight), [80, 240]);
  assert.deepEqual(persisted, ['usda-fdc:5678']);
  assert.equal(meals.saveCalls, 0);
  mealComposerSessions.clear(result.session.draft.id);
});

test('recipe entry adds the immutable revision snapshot at an exact fractional serving amount', async () => {
  const { services, meals } = harness();
  const snapshot: Food = {
    ...food('personal', 'recipe-revision', 'Rice bowl'),
    id: 'recipe-snapshot:v1:rice:revision' as FoodId,
    kind: 'recipe',
    servings: [{
      id: 'recipe-serving:revision' as FoodServingId,
      foodId: 'recipe-snapshot:v1:rice:revision' as FoodId,
      label: 'serving',
      quantity: 1,
      unit: 'serving',
      gramWeight: 300,
    }],
  };
  const recipe: Recipe = {
    id: 'recipe:rice' as RecipeId,
    name: 'Rice bowl',
    ingredients: [{ foodId: 'personal:ingredient' as FoodId, quantity: 1, gramWeight: 600 }],
    yieldServings: 2,
    totalYieldGrams: 600,
    createdAt: now,
    updatedAt: now,
  };
  (services as unknown as { recipeService: { resolveRevisionFood: () => Promise<Food> } }).recipeService = {
    async resolveRevisionFood() { return snapshot; },
  };

  const result = await addRecipeSnapshotToComposer(services, undefined, recipe, 0.5, now);
  assert.equal(result.session.draft.items[0]?.foodId, snapshot.id);
  assert.equal(result.session.draft.items[0]?.portion.gramWeight, 150);
  assert.equal(result.session.draft.items[0]?.recipeId, recipe.id);
  assert.equal(meals.saveCalls, 0);
  mealComposerSessions.clear(result.session.draft.id);
});
