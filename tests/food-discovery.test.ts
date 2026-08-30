import assert from 'node:assert/strict';
import test from 'node:test';

import type { FoodSourcePreferenceStore } from '../src/data/food-data/source-preferences';
import { ApiError } from '../src/data/providers/api-error';
import { FOOD_DETAIL_CACHE_TTL_MS, MemoryProviderCache } from '../src/data/providers/cache';
import type { MealRepository } from '../src/data/repositories/contracts';
import type {
  FoodLookupResult,
  FoodProvider,
  FoodSearchOptions,
} from '../src/data/providers/contracts';
import { UsdaFdcProxyProvider } from '../src/data/providers/usda-fdc-proxy';
import type { Food, Meal } from '../src/domain';
import type {
  FoodCandidate,
  FoodRef,
  FoodSearchGroup,
  FoodSourceId,
} from '../src/domain/food/source';
import { foodIdForRef } from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import {
  CompositeFoodRepository,
  FoodDiscoveryService,
  PersonalFoodProvider,
} from '../src/services/logging/food-discovery';
import { FoodLoggingService } from '../src/services/logging/food-logging';
import { buildTodaySnapshot } from '../src/services/today/snapshot';

const now = '2026-08-29T12:00:00.000Z' as ISODateTime;
const START = Date.parse(now);

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function candidate(sourceId: FoodSourceId, record = '17'): FoodCandidate {
  const ref = { sourceId, recordId: record as SourceRecordId };
  const id = foodIdForRef(ref);
  const food: Food = {
    id,
    kind: sourceId === 'personal' ? 'custom' : 'generic',
    name: `${sourceId} food`,
    nutrition: {
      basisGrams: 100,
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
      },
    ],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ref,
    food,
    portions: [
      {
        id: `${id}:serving`,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
      },
    ],
    provenance: { provider: sourceId, recordId: ref.recordId, retrievedAt: now },
  };
}

function preferences(enabled: readonly FoodSourceId[]): FoodSourcePreferenceStore {
  return {
    async isEnabled(sourceId: FoodSourceId) {
      return enabled.includes(sourceId);
    },
  } as unknown as FoodSourcePreferenceStore;
}

class FakeProvider implements FoodProvider {
  readonly capabilities = { search: true, getById: true, lookupBarcode: false, persist: true };
  searches = 0;
  persists: FoodCandidate[] = [];
  receivedSignal: AbortSignal | undefined;

  constructor(
    readonly id: FoodSourceId,
    private readonly searchResult: FoodSearchGroup | Error = {
      sourceId: id,
      query: 'apple',
      state: 'ready',
      candidates: [candidate(id)],
      freshness: 'network',
    },
  ) {}

  async search(query: string, options: FoodSearchOptions = {}): Promise<FoodSearchGroup> {
    this.searches += 1;
    this.receivedSignal = options.signal;
    if (this.searchResult instanceof Error) throw this.searchResult;
    return { ...this.searchResult, query };
  }

  async getById(ref: FoodRef): Promise<FoodLookupResult> {
    return {
      candidate: ref.sourceId === this.id ? candidate(this.id, ref.recordId) : null,
      freshness: 'stale-cache',
    };
  }

  async persist(value: FoodCandidate): Promise<void> {
    this.persists.push(value);
  }
}

test('source toggles prevent disabled network calls and preserve fixed provider order', async () => {
  const providers = [
    new FakeProvider('open-food-facts'),
    new FakeProvider('usda-fdc'),
    new FakeProvider('personal'),
    new FakeProvider('usda-core'),
  ];
  const discovery = new FoodDiscoveryService(providers, preferences(['personal', 'usda-core']));

  const groups = await discovery.search('apple');

  assert.deepEqual(groups.map((group) => group.sourceId), ['personal', 'usda-core']);
  assert.equal(providers.find((provider) => provider.id === 'usda-fdc')?.searches, 0);
  assert.equal(providers.find((provider) => provider.id === 'open-food-facts')?.searches, 0);
});

test('one provider failure is visible without hiding successful provider results', async () => {
  const personal = new FakeProvider('personal');
  const offline = new FakeProvider(
    'usda-fdc',
    new ApiError('offline', 'USDA Online is unavailable.'),
  );
  const off = new FakeProvider('open-food-facts');
  const discovery = new FoodDiscoveryService(
    [personal, offline, off],
    preferences(['personal', 'usda-fdc', 'open-food-facts']),
  );

  const groups = await discovery.search('apple');

  assert.equal(groups.find((group) => group.sourceId === 'personal')?.state, 'ready');
  const failed = groups.find((group) => group.sourceId === 'usda-fdc');
  assert.equal(failed?.state, 'offline');
  assert.equal(failed && 'issue' in failed ? failed.issue.message : null, 'USDA Online is unavailable.');
  assert.equal(groups.find((group) => group.sourceId === 'open-food-facts')?.state, 'ready');
});

test('search cancellation signal reaches every enabled provider', async () => {
  const signalController = new AbortController();
  const providers = [new FakeProvider('personal'), new FakeProvider('usda-fdc')];
  const discovery = new FoodDiscoveryService(providers, preferences(['personal', 'usda-fdc']));

  await discovery.search('apple', { signal: signalController.signal });

  assert.equal(providers[0]?.receivedSignal, signalController.signal);
  assert.equal(providers[1]?.receivedSignal, signalController.signal);
});

test('completed source groups are published while another provider is still pending', async () => {
  let releaseSlow: ((value: FoodSearchGroup) => void) | undefined;
  const slow = new FakeProvider('usda-fdc');
  slow.search = async (query) => new Promise<FoodSearchGroup>((resolve) => {
    releaseSlow = resolve;
  }).then((group) => ({ ...group, query }));
  const discovery = new FoodDiscoveryService(
    [new FakeProvider('personal'), slow],
    preferences(['personal', 'usda-fdc']),
  );
  const published: FoodSourceId[] = [];

  const pending = discovery.search('apple', {
    onGroup: (group) => published.push(group.sourceId),
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(published, ['personal']);
  assert.ok(releaseSlow);
  releaseSlow({
    sourceId: 'usda-fdc',
    query: 'apple',
    state: 'empty',
    freshness: 'network',
  });
  await pending;
  assert.deepEqual(published, ['personal', 'usda-fdc']);
});

test('historical external references resolve even after their source is disabled', async () => {
  const usda = new FakeProvider('usda-fdc');
  const discovery = new FoodDiscoveryService([usda], preferences([]));

  const resolved = await discovery.getByFoodId(foodIdForRef({
    sourceId: 'usda-fdc',
    recordId: '99' as SourceRecordId,
  }));

  assert.equal(resolved?.ref.sourceId, 'usda-fdc');
  assert.equal(resolved?.ref.recordId, '99');
});

test('disabled historical sources resolve an expired selected record without a network call', async () => {
  let current = START;
  let requests = 0;
  const cache = new MemoryProviderCache();
  const usda = new UsdaFdcProxyProvider({
    cache,
    clock: () => new Date(current),
    fetch: async () => {
      requests += 1;
      throw new Error('network must remain disabled');
    },
  });
  const selected = candidate('usda-fdc', '99');
  await usda.persist(selected);
  current += FOOD_DETAIL_CACHE_TTL_MS + 1;
  const discovery = new FoodDiscoveryService([usda], preferences([]));

  const resolved = await discovery.getByFoodId(selected.food.id);

  assert.equal(resolved?.ref.recordId, '99');
  assert.equal(resolved?.food.name, selected.food.name);
  assert.equal(requests, 0);
});

test('external candidates retain provider provenance before logging and are not rewritten generically', async () => {
  const usda = new FakeProvider('usda-fdc');
  const discovery = new FoodDiscoveryService([usda], preferences(['usda-fdc']));
  const original = candidate('usda-fdc', '101');
  const personalWrites: Food[] = [];
  const knownRefs: FoodId[] = [];
  const composite = new CompositeFoodRepository(
    {
      async getById() { return null; },
      async save(food) { personalWrites.push(food); },
      async delete() {},
      async list() { return []; },
    },
    discovery,
    {
      async listKnownIds() { return knownRefs; },
      async touch(foodId) { knownRefs.push(foodId); },
    },
  );

  await discovery.persist(original);
  await composite.save(original.food);

  assert.deepEqual(usda.persists, [original]);
  assert.deepEqual(personalWrites, []);
  assert.deepEqual(knownRefs, [original.food.id]);
});

test('persisted external food logs resolve into correct Today totals', async () => {
  const usda = new FakeProvider('usda-fdc');
  const discovery = new FoodDiscoveryService([usda], preferences(['usda-fdc']));
  const selected = candidate('usda-fdc', '202');
  const knownRefs: FoodId[] = [];
  const composite = new CompositeFoodRepository(
    {
      async getById() { return null; },
      async save() {},
      async delete() {},
      async list() { return []; },
    },
    discovery,
    {
      async listKnownIds() { return knownRefs; },
      async touch(foodId) { knownRefs.push(foodId); },
    },
  );
  const mealValues = new Map<MealId, Meal>();
  const meals: MealRepository = {
    async getById(id) { return mealValues.get(id) ?? null; },
    async save(meal) { mealValues.set(meal.id, meal); },
    async delete(id) { mealValues.delete(id); },
    async listByDateRange(start, end) {
      return [...mealValues.values()].filter((meal) => meal.occurredAt >= start && meal.occurredAt < end);
    },
    async listRecent() { return [...mealValues.values()]; },
  };
  let sequence = 0;
  const logging = new FoodLoggingService(composite, meals, (prefix) => `${prefix}:${++sequence}`);

  await discovery.persist(selected);
  await logging.logFood(selected.food, 50, now);
  const snapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    foods: composite,
    meals,
    goals: { async save() {}, async listActive() { return []; } },
  });

  assert.deepEqual(usda.persists, [selected]);
  assert.equal(snapshot.metrics.find((metric) => metric.code === 'energy-kcal')?.value, 40);
});

test('USDA Atwater-only Foundation calories survive provider caching, logging, and Today totals', async () => {
  const provider = new UsdaFdcProxyProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => json({
      apiVersion: 'v1',
      data: {
        source: 'usda-fdc',
        foods: [{
          id: 'usda:60001',
          fdcId: 60001,
          dataType: 'Foundation',
          kind: 'generic',
          name: 'Apple, raw',
          nutrition: {
            basisGrams: 100,
            nutrients: [{
              id: 2047,
              code: 'energy-kcal',
              name: 'Energy (Atwater General Factors)',
              unit: 'kcal',
              state: 'known',
              amount: 52,
              provenance: { nutrientId: 2047 },
            }],
          },
          portions: [],
          provenance: {
            source: 'usda-fdc',
            provider: 'USDA FoodData Central',
            sourceRecordId: '60001',
            fdcId: 60001,
            dataType: 'Foundation',
            license: 'CC0-1.0',
            retrievedAt: now,
          },
        }],
        pagination: { limit: 25, returned: 1 },
      },
    }),
  });
  const group = await provider.search('apple');
  assert.equal(group.state, 'ready');
  if (group.state !== 'ready') assert.fail('Expected a USDA Foundation result.');
  const selected = group.candidates[0];
  if (!selected) assert.fail('Expected an Atwater food candidate.');

  const discovery = new FoodDiscoveryService([provider], preferences(['usda-fdc']));
  const knownRefs: FoodId[] = [];
  const composite = new CompositeFoodRepository(
    {
      async getById() { return null; },
      async save() {},
      async delete() {},
      async list() { return []; },
    },
    discovery,
    {
      async listKnownIds() { return knownRefs; },
      async touch(foodId) { knownRefs.push(foodId); },
    },
  );
  const mealValues = new Map<MealId, Meal>();
  const meals: MealRepository = {
    async getById(id) { return mealValues.get(id) ?? null; },
    async save(meal) { mealValues.set(meal.id, meal); },
    async delete(id) { mealValues.delete(id); },
    async listByDateRange(start, end) {
      return [...mealValues.values()].filter((meal) => meal.occurredAt >= start && meal.occurredAt < end);
    },
    async listRecent() { return [...mealValues.values()]; },
  };
  let sequence = 0;

  await discovery.persist(selected);
  await new FoodLoggingService(composite, meals, (prefix) => `${prefix}:${++sequence}`).logFood(
    selected.food,
    50,
    now,
  );
  const snapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    foods: composite,
    meals,
    goals: { async save() {}, async listActive() { return []; } },
  });

  assert.equal(snapshot.metrics.find((metric) => metric.code === 'energy-kcal')?.value, 26);
  assert.deepEqual(snapshot.unavailableItems, []);
});

test('legacy provider snapshots are fallback-only and never appear as personal foods', async () => {
  const ref = { sourceId: 'usda-fdc' as const, recordId: '99' as SourceRecordId };
  const canonicalId = foodIdForRef(ref);
  const legacyId = 'usda:99' as FoodId;
  const normalized = candidate('usda-fdc', '99').food;
  const legacyFood: Food = {
    ...normalized,
    id: legacyId,
    servings: normalized.servings.map((serving) => ({ ...serving, foodId: legacyId })),
  };
  const personalWrites: Food[] = [];
  const privateFoods = {
    async getById(id: FoodId) { return id === legacyId ? legacyFood : null; },
    async save(food: Food) { personalWrites.push(food); },
    async delete() {},
    async list() { return [legacyFood]; },
    async search() { return [legacyFood]; },
  };
  const personal = new PersonalFoodProvider(privateFoods);
  const unavailable = new FakeProvider('usda-fdc');
  unavailable.getById = async () => {
    throw new ApiError('offline', 'USDA cache is unavailable.');
  };
  const discovery = new FoodDiscoveryService([personal, unavailable], preferences(['personal']));
  const touched: FoodId[] = [];
  const composite = new CompositeFoodRepository(privateFoods, discovery, {
    async listKnownIds() { return [canonicalId]; },
    async touch(id) { touched.push(id); },
  });

  const personalResults = await personal.search('yogurt');
  assert.equal(personalResults.state, 'empty');
  const resolved = await composite.getById(canonicalId);
  assert.equal(resolved?.id, canonicalId);
  assert.equal(resolved?.name, legacyFood.name);
  assert.deepEqual((await composite.list()).map((food) => food.id), [canonicalId]);

  if (!resolved) assert.fail('Expected compatibility snapshot to resolve.');
  await composite.save(resolved);
  assert.deepEqual(personalWrites, []);
  assert.deepEqual(touched, [canonicalId]);
});
