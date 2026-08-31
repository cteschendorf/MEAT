import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError } from '../src/data/providers/api-error';
import { MemoryProviderCache, SEARCH_CACHE_TTL_MS, BARCODE_CACHE_TTL_MS } from '../src/data/providers/cache';
import type { FetchLike } from '../src/data/providers/contracts';
import { fetchJson, MEAT_USER_AGENT } from '../src/data/providers/http';
import { OpenFoodFactsProvider } from '../src/data/providers/open-food-facts';
import { UsdaFdcProxyProvider } from '../src/data/providers/usda-fdc-proxy';
import { foodIdForRef, sourceIdFromFoodId } from '../src/domain/food/source';
import type { SourceRecordId } from '../src/domain/shared/ids';

const START = Date.parse('2026-08-29T12:00:00.000Z');

function json(body: unknown, status = 200, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function usdaFood(id = 17) {
  return {
    fdcId: id,
    description: 'Greek yogurt, plain',
    dataType: 'Foundation',
    brandOwner: 'Example Dairy',
    gtinUpc: '0123456789012',
    servingSize: 170,
    servingSizeUnit: 'g',
    foodNutrients: [
      { nutrient: { id: 1008, name: 'Energy', unitName: 'KCAL' }, amount: 97 },
      { nutrient: { id: 1003, name: 'Protein', unitName: 'G' }, amount: 9 },
    ],
  };
}

function proxyUsdaFood(id = 17) {
  return {
    id: `usda:${id}`,
    fdcId: id,
    dataType: 'Foundation',
    kind: 'generic',
    name: 'Greek yogurt, plain',
    brand: 'Example Dairy',
    barcode: '0123456789012',
    nutrition: {
      basisGrams: 100,
      nutrients: [
        { code: 'energy-kcal', name: 'Energy', unit: 'kcal', state: 'known', amount: 97, provenance: {} },
        { code: 'protein-g', name: 'Protein', unit: 'g', state: 'known', amount: 9, provenance: {} },
      ],
    },
    portions: [{ id: 'portion:1', amount: 1, unit: 'serving', gramWeight: 170, description: '1 container' }],
    provenance: {
      source: 'usda-fdc',
      provider: 'USDA FoodData Central',
      sourceRecordId: String(id),
      fdcId: id,
      dataType: 'Foundation',
      license: 'CC0-1.0',
      retrievedAt: '2026-08-29T12:00:00.000Z',
    },
  };
}

function offProduct(code = '3017620422003') {
  return {
    code,
    product_name: 'Hazelnut spread',
    brands: 'Example Brand',
    serving_size: '15 g',
    serving_quantity: '15',
    serving_quantity_unit: 'g',
    nutriments: {
      'energy-kj_100g': 2252,
      proteins_100g: '6.3',
      carbohydrates_100g: 57.5,
      fat_100g: 30.9,
      fiber_100g: 3.4,
    },
  };
}

test('a package serving stated in ounces is kept, not discarded for 100 g', async () => {
  // Only a literal "g" used to be recognised, so every serving expressed in
  // ounces lost its gram weight, was filtered out of the portion list, and the
  // food fell back to a synthesized 100 g that nobody weighs out.
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => json({
      status: 'success',
      product: {
        ...offProduct('0044000032029'),
        serving_size: '1 oz (28 g)',
        serving_quantity: '1',
        serving_quantity_unit: 'oz',
      },
    }),
  });

  const result = await provider.lookupBarcode('0044000032029');
  const serving = result.candidate?.portions.find((portion) => portion.isDefault);
  assert.ok(serving, 'the package serving survives');
  // One avoirdupois ounce is exactly 28.349523125 g.
  assert.ok(Math.abs((serving.gramWeight ?? 0) - 28.349523125) < 1e-9);
});

test('a serving stated in a volume unit keeps its label but claims no weight', async () => {
  // A serving of "250 ml" cannot become grams without knowing what the product
  // weighs per millilitre, and that is not something to invent.
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => json({
      status: 'success',
      product: {
        ...offProduct('5449000000996'),
        serving_size: '250 ml',
        serving_quantity: '250',
        serving_quantity_unit: 'ml',
      },
    }),
  });

  const result = await provider.lookupBarcode('5449000000996');
  const serving = result.candidate?.portions.find((portion) => portion.label === '250 ml');
  assert.ok(serving, 'the serving is still described');
  assert.equal(serving.gramWeight, undefined);
});

test('stable refs generate reversible provider-scoped food IDs', () => {
  const id = foodIdForRef({ sourceId: 'open-food-facts', recordId: '123/45' as SourceRecordId });
  assert.equal(id, 'open-food-facts:123%2F45');
  assert.equal(sourceIdFromFoodId(id), 'open-food-facts');
  assert.equal(sourceIdFromFoodId('legacy:123'), null);
});

test('USDA proxy search parses FoodData Central data without exposing an API key', async () => {
  let requestedUrl = '';
  let requestedUserAgent = '';
  const fetcher: FetchLike = async (input, init) => {
    requestedUrl = String(input);
    requestedUserAgent = new Headers(init?.headers).get('user-agent') ?? '';
    return json({ apiVersion: 'v1', data: { source: 'usda-fdc', foods: [proxyUsdaFood()], pagination: { limit: 12, returned: 1 } } });
  };
  const provider = new UsdaFdcProxyProvider({
    cache: new MemoryProviderCache(),
    fetch: fetcher,
    clock: () => new Date(START),
  });

  const group = await provider.search(' greek yogurt ', { limit: 12 });
  assert.equal(group.state, 'ready');
  assert.equal(group.freshness, 'network');
  assert.equal(group.candidates[0]?.food.name, 'Greek yogurt, plain');
  assert.equal(group.candidates[0]?.food.id, 'usda-fdc:17');
  assert.equal(group.candidates[0]?.portions[0]?.gramWeight, 170);
  assert.equal(group.candidates[0]?.provenance.provider, 'usda-fdc');
  assert.equal(
    group.candidates[0]?.food.nutrition.nutrients.find((entry) => entry.nutrient.code === 'energy-kcal')?.value,
    97,
  );
  assert.match(requestedUrl, /^https:\/\/api\.meatnutrition\.app\/v1\/usda\/search\?/);
  assert.match(requestedUrl, /q=greek\+yogurt/);
  assert.doesNotMatch(requestedUrl, /api[_-]?key/i);
  assert.equal(requestedUserAgent, MEAT_USER_AGENT);
});

test('Open Food Facts submitted text search parses nutrients, servings, and provenance', async () => {
  let requestedUrl = '';
  let requestedUserAgent = '';
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedUserAgent = new Headers(init?.headers).get('user-agent') ?? '';
      return json({ count: 1, page: 1, page_size: 24, products: [offProduct()] });
    },
  });

  const group = await provider.search('spreads');
  assert.equal(group.state, 'ready');
  const candidate = group.candidates[0];
  assert.equal(candidate?.food.id, 'open-food-facts:3017620422003');
  assert.equal(candidate?.food.brand, 'Example Brand');
  assert.equal(candidate?.portions[0]?.gramWeight, 15);
  assert.equal(candidate?.provenance.license?.name, 'ODbL 1.0');
  const energy = candidate?.food.nutrition.nutrients.find((entry) => entry.nutrient.code === 'energy-kcal');
  assert.ok(energy?.value !== undefined);
  assert.ok(Math.abs(energy.value - 2252 / 4.184) < 1e-10);
  assert.match(requestedUrl, /\/cgi\/search\.pl\?/);
  assert.match(requestedUrl, /search_terms=spreads/);
  assert.match(requestedUrl, /search_simple=1/);
  assert.match(requestedUrl, /action=process/);
  assert.match(requestedUrl, /fields=/);
  assert.equal(requestedUserAgent, MEAT_USER_AGENT);
});

test('Open Food Facts v3 barcode lookup validates and caches successful products for seven days', async () => {
  let requests = 0;
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async (input) => {
      requests += 1;
      assert.match(String(input), /\/api\/v3\/product\/3017620422003\?/);
      return json({ status: 'success', product: offProduct() });
    },
  });

  const first = await provider.lookupBarcode('3017-6204-2200-3');
  const second = await provider.lookupBarcode('3017620422003');
  assert.equal(first.freshness, 'network');
  assert.equal(second.freshness, 'fresh-cache');
  assert.equal(second.candidate?.food.name, 'Hazelnut spread');
  assert.equal(requests, 1);
});

test('fresh search cache prevents duplicate provider requests for thirty minutes', async () => {
  let requests = 0;
  const provider = new UsdaFdcProxyProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => {
      requests += 1;
      return json({ foods: [usdaFood()] });
    },
  });

  const first = await provider.search('yogurt');
  const second = await provider.search('yogurt');
  assert.equal(first.state, 'ready');
  assert.equal(second.state, 'ready');
  assert.equal(first.freshness, 'network');
  assert.equal(second.freshness, 'fresh-cache');
  assert.equal(requests, 1);
  assert.equal(SEARCH_CACHE_TTL_MS, 30 * 60 * 1_000);
});

test('expired search cache becomes a marked stale fallback when offline', async () => {
  let now = START;
  let requests = 0;
  const provider = new UsdaFdcProxyProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(now),
    fetch: async () => {
      requests += 1;
      if (requests === 1) return json({ foods: [usdaFood()] });
      throw new TypeError('Network request failed');
    },
  });

  await provider.search('yogurt');
  now += SEARCH_CACHE_TTL_MS + 1;
  const fallback = await provider.search('yogurt');
  assert.equal(fallback.state, 'offline');
  assert.equal(fallback.freshness, 'stale-cache');
  assert.equal(fallback.candidates[0]?.food.name, 'Greek yogurt, plain');
  assert.equal(fallback.issue.code, 'offline');
});

test('expired barcode cache falls back for seven days and preserves the typed issue', async () => {
  let now = START;
  let requests = 0;
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(now),
    fetch: async () => {
      requests += 1;
      if (requests === 1) return json({ status: 'success', product: offProduct() });
      throw new TypeError('offline');
    },
  });

  await provider.lookupBarcode('3017620422003');
  now += BARCODE_CACHE_TTL_MS + 1;
  const fallback = await provider.lookupBarcode('3017620422003');
  assert.equal(fallback.freshness, 'stale-cache');
  assert.equal(fallback.candidate?.ref.recordId, '3017620422003');
  assert.equal(fallback.issue?.kind, 'offline');
});

test('429 search responses become throttled groups with Retry-After metadata', async () => {
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => json({ error: 'slow down' }, 429, { 'Retry-After': '120' }),
  });

  const group = await provider.search('spreads');
  assert.equal(group.state, 'throttled');
  assert.equal(group.candidates.length, 0);
  assert.equal(group.issue.status, 429);
  assert.equal(group.issue.retryAt, '2026-08-29T12:02:00.000Z');
});

test('response content type and body shape are validated', async () => {
  const badContentType = new UsdaFdcProxyProvider({
    cache: new MemoryProviderCache(),
    fetch: async () => new Response('<html>no</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
  });
  const invalidShape = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    fetch: async () => json({ count: 1 }),
  });

  const contentTypeGroup = await badContentType.search('yogurt');
  const shapeGroup = await invalidShape.search('spreads');
  assert.equal(contentTypeGroup.state, 'error');
  assert.equal(contentTypeGroup.issue.code, 'invalid-response');
  assert.equal(shapeGroup.state, 'error');
  assert.equal(shapeGroup.issue.code, 'invalid-response');
});

test('AbortSignal cancellation rejects with a typed aborted ApiError and never uses stale data', async () => {
  const cache = new MemoryProviderCache();
  let now = START;
  let requests = 0;
  const provider = new UsdaFdcProxyProvider({
    cache,
    clock: () => new Date(now),
    fetch: async (_input, init) => {
      requests += 1;
      if (requests === 1) return json({ foods: [usdaFood()] });
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException('The operation was aborted', 'AbortError');
    },
  });
  await provider.search('yogurt');
  now += SEARCH_CACHE_TTL_MS + 1;
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    provider.search('yogurt', { signal: controller.signal }),
    (error: unknown) => error instanceof ApiError && error.code === 'aborted',
  );
});

test('a provider request that never settles is bounded by a typed timeout', async () => {
  let requestSignal: AbortSignal | undefined;
  const stalled: FetchLike = async (_input, init) => {
    requestSignal = init?.signal ?? undefined;
    return new Promise<Response>(() => undefined);
  };

  await assert.rejects(
    fetchJson(stalled, 'https://example.test/stalled', {
      clock: () => new Date(START),
      timeoutMs: 10,
    }),
    (error: unknown) => error instanceof ApiError && error.code === 'timeout',
  );
  assert.equal(requestSignal?.aborted, true);
});

test('Open Food Facts treats negative analytical nutrient values as unknown', async () => {
  const value = offProduct();
  value.nutriments.proteins_100g = '-0.2';
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    clock: () => new Date(START),
    fetch: async () => json({ count: 1, products: [value] }),
  });

  const group = await provider.search('spread');
  assert.equal(group.state, 'ready');
  if (group.state !== 'ready') return;
  const protein = group.candidates[0]?.food.nutrition.nutrients.find(
    (entry) => entry.nutrient.code === 'protein-g',
  );
  assert.equal(protein?.state, 'unknown');
});

test('lookup surfaces typed HTTP errors and negative-caches not-found products', async () => {
  let requests = 0;
  const provider = new OpenFoodFactsProvider({
    cache: new MemoryProviderCache(),
    fetch: async () => {
      requests += 1;
      return requests <= 2 ? json({ message: 'server error' }, 503) : json({ message: 'missing' }, 404);
    },
  });

  await assert.rejects(
    provider.getById({ sourceId: 'open-food-facts', recordId: '1234' as SourceRecordId }),
    (error: unknown) => error instanceof ApiError && error.code === 'http-error' && error.status === 503,
  );
  await assert.rejects(
    provider.getById({ sourceId: 'open-food-facts', recordId: '1234' as SourceRecordId }),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
  const missing = await provider.getById({ sourceId: 'open-food-facts', recordId: '9999' as SourceRecordId });
  const cachedMissing = await provider.getById({ sourceId: 'open-food-facts', recordId: '9999' as SourceRecordId });
  assert.equal(missing.candidate, null);
  assert.equal(cachedMissing.freshness, 'fresh-cache');
  assert.equal(requests, 3);
});
