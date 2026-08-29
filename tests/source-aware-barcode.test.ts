import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal } from '../src/domain';
import type { BarcodeProviderResult } from '../src/services/logging/food-discovery';
import {
  BarcodeScanDeduplicator,
  SourceAwareBarcodeService,
  cameraPermissionPlan,
  expandUpcE,
  normalizeRetailBarcode,
  retailBarcodeVariants,
  type SourceAwareBarcodeDiscovery,
  type SourceAwareBarcodeLogger,
} from '../src/services/logging/source-aware-barcode';
import type { FoodCandidate } from '../src/domain/food/source';
import type {
  FoodId,
  ISODateTime,
  MealId,
  SourceRecordId,
} from '../src/domain/shared/ids';

const now = '2026-08-29T18:00:00.000Z' as ISODateTime;

test('camera permission remains deferred and denial has a usable blocked state', () => {
  assert.equal(cameraPermissionPlan(null), 'checking');
  assert.equal(cameraPermissionPlan({ granted: false, canAskAgain: true }), 'request');
  assert.equal(cameraPermissionPlan({ granted: false, canAskAgain: false }), 'blocked');
  assert.equal(cameraPermissionPlan({ granted: true, canAskAgain: true }), 'ready');
});

function candidate(sourceId: 'personal' | 'open-food-facts', barcode = '3017620422003'): FoodCandidate {
  const recordId = barcode as SourceRecordId;
  const food: Food = {
    id: `${sourceId}:${barcode}` as FoodId,
    kind: 'branded',
    name: sourceId === 'personal' ? 'Saved product' : 'Provider product',
    barcode,
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    ref: { sourceId, recordId },
    food,
    portions: [],
    provenance: { provider: sourceId, recordId },
  };
}

function logger(events: string[] = []): SourceAwareBarcodeLogger {
  return {
    async logFood(food, gramWeight, occurredAt) {
      events.push(`log:${food.id}:${gramWeight}`);
      return {
        id: 'meal:1' as MealId,
        occurredAt,
        items: [],
        mediaIds: [],
        createdAt: occurredAt,
        updatedAt: occurredAt,
      } satisfies Meal;
    },
  };
}

test('retail formats normalize and bridge EAN-13, UPC-A, and UPC-E identifiers', () => {
  assert.equal(normalizeRetailBarcode('9638-5074', 'ean8'), '96385074');
  assert.equal(normalizeRetailBarcode('3 017620 422003', 'ean13'), '3017620422003');
  assert.equal(normalizeRetailBarcode('0 12345 67890 5', 'upc_a'), '012345678905');
  assert.equal(expandUpcE('04210005'), '042000001005');
  assert.deepEqual(retailBarcodeVariants('012345678905', 'upc_a'), [
    '012345678905',
    '0012345678905',
  ]);
  assert.deepEqual(retailBarcodeVariants('04210005', 'upc_e'), [
    '04210005',
    '042000001005',
    '0042000001005',
  ]);
  assert.throws(() => normalizeRetailBarcode('1234'), /EAN-8/);
  assert.throws(() => normalizeRetailBarcode('30176204220O3', 'ean13'), /digits only/);
});

test('camera event deduplication closes the same-render race and allows later scans', () => {
  let timestamp = 1_000;
  const deduplicator = new BarcodeScanDeduplicator(1_500, () => timestamp);
  assert.equal(deduplicator.accept('3017620422003', 'ean13'), true);
  assert.equal(deduplicator.accept('3017620422003', 'ean13'), false);
  timestamp += 1_499;
  assert.equal(deduplicator.accept('3017620422003', 'ean13'), false);
  timestamp += 1;
  assert.equal(deduplicator.accept('3017620422003', 'ean13'), true);
  assert.equal(deduplicator.accept('96385074', 'ean8'), true);
  deduplicator.reset();
  assert.equal(deduplicator.accept('96385074', 'ean8'), true);
});

test('provider outcomes stay independent and a stale offline candidate remains usable', async () => {
  const stale = candidate('open-food-facts');
  const discovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode(): Promise<readonly BarcodeProviderResult[]> {
      return [
        { sourceId: 'personal', result: { candidate: null, freshness: 'fresh-cache' } },
        {
          sourceId: 'open-food-facts',
          result: {
            candidate: stale,
            freshness: 'stale-cache',
            issue: { kind: 'offline', code: 'offline', message: 'Using an offline saved result.' },
          },
        },
        {
          sourceId: 'usda-fdc',
          result: {
            candidate: null,
            freshness: 'network',
            issue: { kind: 'error', code: 'provider-error', message: 'USDA unavailable.' },
          },
        },
      ];
    },
    async persist() {},
  };
  const resolution = await new SourceAwareBarcodeService(discovery, logger()).lookup('3017620422003');
  assert.equal(resolution.status, 'found');
  assert.deepEqual(resolution.sources.map((source) => source.state), ['empty', 'found', 'error']);
  const found = resolution.sources[1];
  assert.equal(found?.state, 'found');
  if (found?.state === 'found') {
    assert.equal(found.freshness, 'stale-cache');
    assert.equal(found.issue?.kind, 'offline');
    assert.equal(found.candidate.food.name, 'Provider product');
  }
});

test('confirmed unknown and provider failure are distinct outcomes', async () => {
  const unknownDiscovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode() {
      return [
        { sourceId: 'personal', result: { candidate: null, freshness: 'fresh-cache' } },
        { sourceId: 'open-food-facts', result: { candidate: null, freshness: 'network' } },
      ];
    },
    async persist() {},
  };
  const offlineDiscovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode() {
      return [
        { sourceId: 'personal', result: { candidate: null, freshness: 'fresh-cache' } },
        {
          sourceId: 'open-food-facts',
          result: {
            candidate: null,
            freshness: 'network',
            issue: { kind: 'offline' as const, code: 'offline', message: 'No network.' },
          },
        },
      ];
    },
    async persist() {},
  };
  assert.equal(
    (await new SourceAwareBarcodeService(unknownDiscovery, logger()).lookup('3017620422003')).status,
    'not-found',
  );
  const unavailable = await new SourceAwareBarcodeService(offlineDiscovery, logger()).lookup(
    '3017620422003',
  );
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unavailable.sources[1]?.state, 'offline');
});

test('UPC-E lookup tries the compact and expanded codes without merging source results', async () => {
  const requested: string[] = [];
  const expandedCandidate = candidate('open-food-facts', '042000001005');
  const discovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode(barcode) {
      requested.push(barcode);
      return [
        {
          sourceId: 'open-food-facts',
          result: {
            candidate: barcode === '042000001005' ? expandedCandidate : null,
            freshness: 'fresh-cache',
          },
        },
      ];
    },
    async persist() {},
  };
  const resolution = await new SourceAwareBarcodeService(discovery, logger()).lookup('04210005', {
    format: 'upc_e',
  });
  assert.deepEqual(requested, ['04210005', '042000001005', '0042000001005']);
  assert.equal(resolution.status, 'found');
  assert.equal(resolution.sources.length, 1);
  assert.equal(resolution.sources[0]?.state, 'found');
});

test('UPC-E variants start together so an outage costs one timeout window', async () => {
  const requested: string[] = [];
  let release: (() => void) | undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const discovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode(barcode) {
      requested.push(barcode);
      await barrier;
      return [];
    },
    async persist() {},
  };

  const pending = new SourceAwareBarcodeService(discovery, logger()).lookup('04210005', {
    format: 'upc_e',
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(requested, ['04210005', '042000001005', '0042000001005']);
  release?.();
  await pending;
});

test('known candidate is persisted before logging', async () => {
  const events: string[] = [];
  const known = candidate('open-food-facts');
  const discovery: SourceAwareBarcodeDiscovery = {
    async lookupBarcode() {
      return [];
    },
    async persist(value) {
      events.push(`persist:${value.food.id}`);
    },
  };
  const service = new SourceAwareBarcodeService(discovery, logger(events));
  await service.persistAndLog(known, 30, now);
  assert.deepEqual(events, [
    'persist:open-food-facts:3017620422003',
    'log:open-food-facts:3017620422003:30',
  ]);
  await assert.rejects(service.persistAndLog(known, 0, now), /greater than zero/);
});
