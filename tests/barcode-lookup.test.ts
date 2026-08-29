import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food } from '../src/domain';
import type { FoodId, ISODateTime } from '../src/domain/shared/ids';
import type { ExternalFoodProvider } from '../src/data/food-data/external';
import {
  BarcodeLookupService,
  barcodeCandidates,
  normalizeBarcode,
  type BarcodeCache,
  type BarcodeFoodStore,
  type BarcodeLocalSource,
  type BarcodeSourcePreferences,
} from '../src/services/logging/barcode';

const timestamp = '2026-08-29T15:00:00.000Z' as ISODateTime;

function food(id: string, barcode: string): Food {
  return {
    id: id as FoodId,
    kind: 'branded',
    name: id,
    barcode,
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const enabled: BarcodeSourcePreferences = { async isEnabled() { return true; } };

function cache(): BarcodeCache & { values: Map<string, Food> } {
  const values = new Map<string, Food>();
  return {
    values,
    async get(provider, key) {
      return values.get(`${provider}:${key}`) ?? null;
    },
    async put(provider, key, value) {
      values.set(`${provider}:${key}`, value);
    },
  };
}

test('barcode normalization accepts common retail formats and bridges UPC-A/EAN-13', () => {
  assert.equal(normalizeBarcode('0 12345-67890 5'), '012345678905');
  assert.deepEqual(barcodeCandidates('012345678905'), ['012345678905', '0012345678905']);
  assert.deepEqual(barcodeCandidates('0012345678905'), ['0012345678905', '012345678905']);
  assert.throws(() => normalizeBarcode('1234'), /EAN-8/);
});

test('personal foods resolve before local or network sources', async () => {
  const personal = food('personal-food', '012345678905');
  let networkCalls = 0;
  const provider: ExternalFoodProvider = {
    id: 'open-food-facts',
    async search() { return []; },
    async findByBarcode() { networkCalls += 1; return null; },
  };
  const store: BarcodeFoodStore = { async list() { return [personal]; } };
  const local: BarcodeLocalSource = { async findByBarcode() { throw new Error('local should not run'); } };

  const result = await new BarcodeLookupService(store, local, [provider], cache(), enabled).resolve('012345678905');
  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(result.sourceId, 'personal');
  assert.equal(networkCalls, 0);
});

test('local corpus resolves before free/open network fallback', async () => {
  const localFood = food('local-food', '012345678905');
  let networkCalls = 0;
  const provider: ExternalFoodProvider = {
    id: 'open-food-facts',
    async search() { return []; },
    async findByBarcode() { networkCalls += 1; return null; },
  };
  const store: BarcodeFoodStore = { async list() { return []; } };
  const local: BarcodeLocalSource = { async findByBarcode(value) { return value === localFood.barcode ? localFood : null; } };

  const result = await new BarcodeLookupService(store, local, [provider], cache(), enabled).resolve('012345678905');
  assert.equal(result.status, 'found');
  if (result.status === 'found') assert.equal(result.sourceId, 'usda-local');
  assert.equal(networkCalls, 0);
});

test('external barcode success is cached for later offline resolution', async () => {
  const remoteFood = food('off-food', '012345678905');
  let networkCalls = 0;
  const provider: ExternalFoodProvider = {
    id: 'open-food-facts',
    async search() { return []; },
    async findByBarcode() { networkCalls += 1; return remoteFood; },
  };
  const store: BarcodeFoodStore = { async list() { return []; } };
  const local: BarcodeLocalSource = { async findByBarcode() { return null; } };
  const externalCache = cache();
  const service = new BarcodeLookupService(store, local, [provider], externalCache, enabled);

  const first = await service.resolve('012345678905');
  assert.equal(first.status, 'found');
  assert.equal(networkCalls, 1);
  const second = await service.resolve('012345678905');
  assert.equal(second.status, 'found');
  assert.equal(networkCalls, 1);
});

test('network failure is distinct from a confirmed unknown barcode', async () => {
  const store: BarcodeFoodStore = { async list() { return []; } };
  const local: BarcodeLocalSource = { async findByBarcode() { return null; } };
  const failing: ExternalFoodProvider = {
    id: 'open-food-facts',
    async search() { return []; },
    async findByBarcode() { throw new Error('offline'); },
  };
  const responding: ExternalFoodProvider = {
    id: 'open-food-facts',
    async search() { return []; },
    async findByBarcode() { return null; },
  };

  assert.equal((await new BarcodeLookupService(store, local, [failing], cache(), enabled).resolve('012345678905')).status, 'offline');
  assert.equal((await new BarcodeLookupService(store, local, [responding], cache(), enabled).resolve('012345678905')).status, 'not-found');
});
