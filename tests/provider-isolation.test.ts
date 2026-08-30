import assert from 'node:assert/strict';
import test from 'node:test';

import type { FoodSourcePreferenceStore } from '../src/data/food-data/source-preferences';
import type { FoodRepository, MealRepository } from '../src/data/repositories/contracts';
import type {
  FoodProvider,
  FoodProviderRequestOptions,
} from '../src/data/providers/contracts';
import type { Food, Meal } from '../src/domain';
import type { FoodCandidate, FoodRef, FoodSourceId } from '../src/domain/food/source';
import { foodIdForRef } from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import {
  CompositeFoodRepository,
  FoodDiscoveryService,
} from '../src/services/logging/food-discovery';
import { FoodSuggestionsService } from '../src/services/logging/food-suggestions';
import { buildTodaySnapshot } from '../src/services/today/snapshot';

const now = '2026-08-29T12:00:00.000Z' as ISODateTime;

function food(id: FoodId, name: string, basisGrams = 100): Food {
  return {
    id,
    kind: 'generic',
    name,
    nutrition: {
      basisGrams,
      nutrients: [
        {
          nutrient: { code: 'energy-kcal', name: 'Calories', unit: 'kcal' },
          state: 'known',
          value: 80,
        },
      ],
    },
    servings: [
      {
        id: `${id}:serving` as FoodServingId,
        foodId: id,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
        isDefault: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function candidate(sourceId: FoodSourceId, recordId: string): FoodCandidate {
  const ref: FoodRef = { sourceId, recordId: recordId as SourceRecordId };
  const value = food(foodIdForRef(ref), `${sourceId} ${recordId}`);
  return {
    ref,
    food: value,
    portions: value.servings.map((serving) => ({
      id: serving.id,
      label: serving.label,
      quantity: serving.quantity,
      unit: serving.unit,
      ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
      ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
    })),
    provenance: { provider: sourceId, recordId: ref.recordId },
  };
}

function preferences(enabled: readonly FoodSourceId[]): FoodSourcePreferenceStore {
  return {
    async isEnabled(sourceId: FoodSourceId) {
      return enabled.includes(sourceId);
    },
  } as unknown as FoodSourcePreferenceStore;
}

function meal(
  id: string,
  items: readonly { id: string; foodId: FoodId; grams: number }[],
): Meal {
  return {
    id: id as MealId,
    occurredAt: now,
    items: items.map((item) => ({
      id: item.id as MealItemId,
      foodId: item.foodId,
      portion: { quantity: 1, gramWeight: item.grams },
    })),
    mediaIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function mealsReturning(values: readonly Meal[]): MealRepository {
  return {
    async getById(id) { return values.find((value) => value.id === id) ?? null; },
    async save() {},
    async delete() {},
    async listByDateRange() { return values; },
    async listRecent() { return values; },
  };
}

const noGoals = { async save() {}, async listActive() { return []; } };

test('composite reusable-food list skips one failed cached provider record', async () => {
  const good = candidate('usda-fdc', 'good');
  const badId = foodIdForRef({ sourceId: 'usda-fdc', recordId: 'bad' as SourceRecordId });
  const lookupOptions: FoodProviderRequestOptions[] = [];
  const provider: FoodProvider = {
    id: 'usda-fdc',
    capabilities: { search: false, getById: true, lookupBarcode: false, persist: false },
    async search(query) {
      return { sourceId: 'usda-fdc', query, state: 'empty', freshness: 'fresh-cache' };
    },
    async getById(ref, options = {}) {
      lookupOptions.push(options);
      if (ref.recordId === 'bad') throw new Error('Corrupt cached record');
      return { candidate: good, freshness: 'stale-cache' };
    },
  };
  const local = food('personal:local' as FoodId, 'Local reusable food');
  const composite = new CompositeFoodRepository(
    {
      async getById() { return null; },
      async save() {},
      async delete() {},
      async list() { return [local]; },
    },
    new FoodDiscoveryService([provider], preferences(['usda-fdc'])),
    {
      async listKnownIds() { return [badId, good.food.id]; },
      async touch() {},
    },
  );

  const listed = await composite.list(10);

  assert.deepEqual(listed.map((value) => value.id), [local.id, good.food.id]);
  assert.equal(lookupOptions.length, 2);
  assert.ok(lookupOptions.every((options) => options.preferCached === true));
});

test('Today remains readable when one historical provider lookup rejects', async () => {
  const available = food('usda-fdc:available' as FoodId, 'Available cached food');
  const unavailableId = 'open-food-facts:unavailable' as FoodId;
  const history = meal('meal:mixed', [
    { id: 'item:available', foodId: available.id, grams: 50 },
    { id: 'item:unavailable', foodId: unavailableId, grams: 100 },
  ]);
  const requested: FoodId[] = [];
  const foods: FoodRepository = {
    async getById(id) {
      requested.push(id);
      if (id === unavailableId) throw new Error('Cached payload could not be decoded');
      return id === available.id ? available : null;
    },
    async save() {},
    async delete() {},
    async list() { return []; },
  };

  const snapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    meals: mealsReturning([history]),
    foods,
    goals: noGoals,
  });

  assert.deepEqual(requested, [available.id, unavailableId]);
  assert.deepEqual(snapshot.meals, [history]);
  assert.deepEqual(snapshot.unavailableItems, [
    { mealId: history.id, itemId: history.items[1]?.id, foodId: unavailableId },
  ]);
  const calories = snapshot.metrics.find((metric) => metric.code === 'energy-kcal');
  assert.equal(calories?.state, 'unknown');
  assert.equal(calories?.value, null, 'a resolved subtotal must not be presented as a complete total');
});

test('Today isolates a resolved food whose cached nutrition payload cannot be scaled', async () => {
  const corrupt = food('usda-fdc:corrupt' as FoodId, 'Corrupt cached food', 0);
  const history = meal('meal:corrupt', [
    { id: 'item:corrupt', foodId: corrupt.id, grams: 100 },
  ]);

  const snapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    meals: mealsReturning([history]),
    foods: {
      async getById() { return corrupt; },
      async save() {},
      async delete() {},
      async list() { return []; },
    },
    goals: noGoals,
  });

  assert.deepEqual(snapshot.unavailableItems, [
    { mealId: history.id, itemId: history.items[0]?.id, foodId: corrupt.id },
  ]);
  assert.equal(snapshot.metrics.find((metric) => metric.code === 'energy-kcal')?.value, null);
});

test('suggestions skip only the food whose provider detail lookup fails', async () => {
  const brokenId = 'open-food-facts:broken' as FoodId;
  const reusable = food('usda-fdc:reusable' as FoodId, 'Reusable cached food');
  const history = meal('meal:recent', [
    { id: 'item:recent', foodId: reusable.id, grams: 75 },
  ]);
  const requested: FoodId[] = [];
  const service = new FoodSuggestionsService(
    { async listRecent() { return [history]; } },
    {
      async getById(id) {
        requested.push(id);
        if (id === brokenId) throw new Error('Provider cache failed');
        return id === reusable.id ? reusable : null;
      },
      async save() {},
      async delete() {},
      async list() { return []; },
    },
    {
      async listFavoriteIds() { return [brokenId]; },
      async setFavorite() {},
    },
  );

  const suggestions = await service.listSuggestions(now, 8);

  assert.deepEqual(new Set(requested), new Set([brokenId, reusable.id]));
  assert.deepEqual(suggestions.map((suggestion) => suggestion.food.id), [reusable.id]);
  assert.equal(suggestions[0]?.suggestedGramWeight, 75);
});
