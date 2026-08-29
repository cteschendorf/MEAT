import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import type { ResponseCache } from '../src/cache.ts';
import { InMemoryRateLimiter } from '../src/rate-limit.ts';
import { createWorker, type Env } from '../src/worker.ts';
import type { FetchImplementation } from '../src/usda-client.ts';

const TEST_KEY = 'usda-secret-value';
const BASE_URL = 'https://api.meatnutrition.app';

test('deployment configuration disables invocation URL logging', () => {
  const configuration = readFileSync(
    fileURLToPath(new URL('../wrangler.toml', import.meta.url)),
    'utf8',
  );
  assert.match(configuration, /\[observability\]\s+enabled = false/);
  assert.match(configuration, /\[observability\.logs\]\s+invocation_logs = false/);
});

class MockCache implements ResponseCache {
  readonly entries = new Map<string, Response>();
  readonly seenUrls = new Set<string>();

  async match(request: Request): Promise<Response | undefined> {
    this.seenUrls.add(request.url);
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.seenUrls.add(request.url);
    this.entries.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return this.entries.delete(request.url);
  }
}

function request(path: string, ip = '192.0.2.1', init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set('CF-Connecting-IP', ip);
  return new Request(`${BASE_URL}${path}`, { ...init, headers });
}

function json(payload: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(headers)) },
  });
}

function testEnv(overrides: Partial<Env> = {}): Env {
  return { USDA_FDC_API_KEY: TEST_KEY, ...overrides };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const searchFood = {
  fdcId: 12345,
  description: 'PLAIN GREEK YOGURT',
  dataType: 'Branded',
  brandOwner: 'Example Dairy',
  gtinUpc: '000123456789',
  servingSize: 170,
  servingSizeUnit: 'g',
  householdServingFullText: '1 container',
  foodNutrients: [
    {
      nutrientId: 1008,
      nutrientName: 'Energy',
      nutrientNumber: '208',
      unitName: 'KCAL',
      value: 88,
      derivationCode: 'LCCS',
    },
    {
      nutrientId: 1003,
      nutrientName: 'Protein',
      nutrientNumber: '203',
      unitName: 'G',
      value: 15,
    },
  ],
};

const detailFood = {
  fdcId: 54321,
  description: 'APPLE, RAW',
  dataType: 'Foundation',
  foodNutrients: [
    {
      amount: 52,
      nutrient: { id: 1008, number: '208', name: 'Energy', unitName: 'KCAL' },
      foodNutrientDerivation: { code: 'NC' },
    },
    {
      nutrient: { id: 1079, number: '291', name: 'Fiber, total dietary', unitName: 'G' },
    },
    {
      amount: -0.1,
      nutrient: { id: 1003, number: '203', name: 'Protein', unitName: 'G' },
    },
  ],
  foodPortions: [
    {
      id: 77,
      amount: 1,
      gramWeight: 182,
      portionDescription: '1 medium apple',
      measureUnit: { id: 9999, name: 'apple', abbreviation: 'apple' },
    },
  ],
};

test('health is public, read-only, and does not call USDA', async () => {
  let upstreamCalls = 0;
  const worker = createWorker({
    fetchImplementation: async () => {
      upstreamCalls += 1;
      return json({});
    },
    cache: new MockCache(),
  });

  const response = await worker.fetch(request('/v1/health'), {});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    apiVersion: 'v1',
    data: { service: 'meat-usda-proxy', status: 'ok' },
  });
  assert.equal(upstreamCalls, 0);

  const preflight = await worker.fetch(
    request('/v1/usda/search', '192.0.2.1', { method: 'OPTIONS' }),
    {},
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Methods'), 'GET, OPTIONS');
});

test('search validates q and limit before calling upstream', async () => {
  let upstreamCalls = 0;
  const worker = createWorker({
    fetchImplementation: async () => {
      upstreamCalls += 1;
      return json({ foods: [] });
    },
    cache: new MockCache(),
  });

  const cases: [string, string][] = [
    ['/v1/usda/search', 'INVALID_QUERY'],
    ['/v1/usda/search?q=a', 'INVALID_QUERY'],
    [`/v1/usda/search?q=${'a'.repeat(81)}`, 'INVALID_QUERY'],
    ['/v1/usda/search?q=apple&limit=0', 'INVALID_LIMIT'],
    ['/v1/usda/search?q=apple&limit=26', 'INVALID_LIMIT'],
    ['/v1/usda/search?q=apple&limit=1.5', 'INVALID_LIMIT'],
  ];

  for (const [path, expectedCode] of cases) {
    const response = await worker.fetch(request(path), testEnv());
    assert.equal(response.status, 400);
    const payload = await body(response);
    assert.equal((payload.error as Record<string, unknown>).code, expectedCode);
  }
  assert.equal(upstreamCalls, 0);
});

test('search normalizes flattened USDA nutrients and branded portions', async () => {
  let upstreamUrl = '';
  const fetchImplementation: FetchImplementation = async (url) => {
    upstreamUrl = url;
    return json({ foods: [searchFood], totalHits: 42 });
  };
  const worker = createWorker({ fetchImplementation, cache: new MockCache(), now: () => 1_800_000_000_000 });

  const response = await worker.fetch(request('/v1/usda/search?q=Greek%20%20Yogurt&limit=5'), testEnv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-MEAT-Cache'), null);
  const payload = (await response.json()) as {
    data: { foods: Record<string, any>[]; pagination: Record<string, number> };
  };
  const food = payload.data.foods[0];
  assert.equal(payload.data.pagination.limit, 5);
  assert.equal(payload.data.pagination.returned, 1);
  assert.equal(payload.data.pagination.totalHits, 42);
  assert.equal(food?.fdcId, 12345);
  assert.equal(food?.dataType, 'Branded');
  assert.equal(food?.kind, 'branded');
  assert.equal(food?.brand, 'Example Dairy');
  assert.equal(food?.provenance.provider, 'USDA FoodData Central');
  assert.equal(food?.provenance.license, 'CC0-1.0');
  assert.equal(food?.nutrition.nutrients[0]?.code, 'energy-kcal');
  assert.equal(food?.nutrition.nutrients[0]?.amount, 88);
  assert.equal(food?.nutrition.nutrients[0]?.provenance.derivationCode, 'LCCS');
  assert.deepEqual(food?.portions[0], {
    id: 'usda:12345:portion:serving',
    amount: 170,
    unit: 'g',
    gramWeight: 170,
    description: '1 container',
  });

  const parsedUrl = new URL(upstreamUrl);
  assert.equal(parsedUrl.pathname, '/fdc/v1/foods/search');
  assert.equal(parsedUrl.searchParams.get('query'), 'Greek Yogurt');
  assert.equal(parsedUrl.searchParams.get('pageSize'), '5');
  assert.equal(parsedUrl.searchParams.get('api_key'), TEST_KEY);
});

test('FNDDS search foodMeasures preserve household gram weights', async () => {
  const fnddsFood = {
    ...searchFood,
    fdcId: 70001,
    description: 'RICE, BROWN, COOKED',
    dataType: 'Survey (FNDDS)',
    foodMeasures: [{
      id: 991,
      disseminationText: '1 cup, cooked',
      gramWeight: 195,
      measureUnitName: 'cup',
    }],
  };
  const worker = createWorker({
    fetchImplementation: async () => json({ foods: [fnddsFood] }),
    cache: new MockCache(),
    now: () => 1_800_000_000_000,
  });

  const response = await worker.fetch(request('/v1/usda/search?q=brown%20rice'), testEnv());
  const payload = (await response.json()) as { data: { foods: { portions: Record<string, unknown>[] }[] } };
  assert.deepEqual(payload.data.foods[0]?.portions[0], {
    id: 'usda:70001:portion:991',
    amount: 1,
    unit: 'cup',
    gramWeight: 195,
    description: '1 cup, cooked',
  });
});

test('food details normalize nested nutrients, unknown values, and USDA portions', async () => {
  const worker = createWorker({
    fetchImplementation: async () => json(detailFood),
    cache: new MockCache(),
    now: () => 1_800_000_000_000,
  });

  const response = await worker.fetch(request('/v1/usda/foods/54321'), testEnv());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const payload = (await response.json()) as { data: { food: Record<string, any> } };
  const food = payload.data.food;
  assert.equal(food.fdcId, 54321);
  assert.equal(food.dataType, 'Foundation');
  assert.equal(food.nutrition.nutrients[0].code, 'energy-kcal');
  assert.equal(food.nutrition.nutrients[0].amount, 52);
  assert.equal(food.nutrition.nutrients[1].code, 'fiber-g');
  assert.equal(food.nutrition.nutrients[1].state, 'unknown');
  assert.equal('amount' in food.nutrition.nutrients[1], false);
  assert.equal(food.nutrition.nutrients[2].code, 'protein-g');
  assert.equal(food.nutrition.nutrients[2].state, 'unknown');
  assert.equal('amount' in food.nutrition.nutrients[2], false);
  assert.deepEqual(food.portions[0], {
    id: 'usda:54321:portion:77',
    amount: 1,
    unit: 'apple',
    gramWeight: 182,
    description: '1 medium apple',
  });
});

test('Foundation Atwater energy becomes one canonical calorie value by USDA ID priority', async () => {
  const atwaterFood = {
    ...detailFood,
    fdcId: 60001,
    description: 'APPLE, RAW',
    foodNutrients: [
      {
        nutrient: { id: 2048, number: '957', name: 'Energy (Atwater Specific Factors)', unitName: 'KCAL' },
        amount: 51,
      },
      {
        nutrient: { id: 2047, number: '958', name: 'Energy (Atwater General Factors)', unitName: 'KCAL' },
        amount: 52,
      },
    ],
  };
  const worker = createWorker({
    fetchImplementation: async () => json(atwaterFood),
    cache: new MockCache(),
    now: () => 1_800_000_000_000,
  });

  const response = await worker.fetch(request('/v1/usda/foods/60001'), testEnv());
  const payload = (await response.json()) as { data: { food: { nutrition: { nutrients: Record<string, unknown>[] } } } };
  const energy = payload.data.food.nutrition.nutrients.filter((nutrient) => nutrient.code === 'energy-kcal');
  assert.equal(energy.length, 1);
  assert.equal(energy[0]?.id, 2047);
  assert.equal(energy[0]?.amount, 52);
  assert.equal(payload.data.food.nutrition.nutrients.some((nutrient) => nutrient.code === 'usda-2048-kcal'), false);
});

test('search cache lasts 15 minutes and details cache lasts 24 hours', async () => {
  let currentTime = 1_800_000_000_000;
  let searchCalls = 0;
  let detailCalls = 0;
  const cache = new MockCache();
  const worker = createWorker({
    cache,
    now: () => currentTime,
    fetchImplementation: async (url) => {
      if (new URL(url).pathname.endsWith('/foods/search')) {
        searchCalls += 1;
        return json({ foods: [searchFood] });
      }
      detailCalls += 1;
      return json(detailFood);
    },
  });

  const firstSearch = await worker.fetch(request('/v1/usda/search?q=Apple&limit=3'), testEnv());
  const cachedSearch = await worker.fetch(request('/v1/usda/search?q=apple&limit=3'), testEnv());
  assert.equal(firstSearch.headers.get('X-MEAT-Cache'), null);
  assert.equal(cachedSearch.headers.get('X-MEAT-Cache'), null);
  assert.equal(cachedSearch.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(searchCalls, 1);

  currentTime += 900_001;
  await worker.fetch(request('/v1/usda/search?q=apple&limit=3'), testEnv());
  assert.equal(searchCalls, 2);

  const firstDetail = await worker.fetch(request('/v1/usda/foods/54321'), testEnv());
  const cachedDetail = await worker.fetch(request('/v1/usda/foods/54321'), testEnv());
  assert.equal(firstDetail.headers.get('X-MEAT-Cache'), null);
  assert.equal(cachedDetail.headers.get('X-MEAT-Cache'), null);
  assert.equal(detailCalls, 1);

  currentTime += 86_400_001;
  await worker.fetch(request('/v1/usda/foods/54321'), testEnv());
  assert.equal(detailCalls, 2);
});

test('upstream failures return safe typed errors', async () => {
  const worker = createWorker({
    fetchImplementation: async () => json({ diagnostic: TEST_KEY }, 503),
    cache: new MockCache(),
  });

  const response = await worker.fetch(request('/v1/usda/search?q=private%20meal'), testEnv());
  assert.equal(response.status, 502);
  const raw = await response.text();
  assert.match(raw, /UPSTREAM_FAILURE/);
  assert.doesNotMatch(raw, new RegExp(TEST_KEY));
  assert.doesNotMatch(raw, /private meal/i);
});

test('upstream USDA throttling remains a retryable 429 for the app', async () => {
  const worker = createWorker({
    fetchImplementation: async () => json({}, 429, { 'Retry-After': '17' }),
    cache: new MockCache(),
  });

  const response = await worker.fetch(request('/v1/usda/search?q=apple'), testEnv());
  const payload = await body(response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '17');
  assert.equal((payload.error as Record<string, unknown>).code, 'UPSTREAM_RATE_LIMITED');
  assert.equal((payload.error as Record<string, unknown>).retryable, true);
});

test('malformed USDA responses are rejected without partial normalization', async () => {
  const worker = createWorker({
    fetchImplementation: async () => json({ foods: 'not-an-array' }),
    cache: new MockCache(),
  });

  const response = await worker.fetch(request('/v1/usda/search?q=apple'), testEnv());
  assert.equal(response.status, 502);
  const payload = await body(response);
  assert.equal((payload.error as Record<string, unknown>).code, 'UPSTREAM_INVALID_RESPONSE');
  assert.equal((payload.error as Record<string, unknown>).retryable, true);
});

test('rate limiting allows 30 requests per minute per IP and blocks the thirty-first', async () => {
  const worker = createWorker({
    fetchImplementation: async () => json({ foods: [] }),
    cache: new MockCache(),
    rateLimiter: new InMemoryRateLimiter(30, 60_000),
    now: () => 1_800_000_000_000,
  });

  for (let index = 0; index < 30; index += 1) {
    const response = await worker.fetch(request('/v1/usda/search?q=apple', '198.51.100.7'), testEnv());
    assert.equal(response.status, 200);
  }

  const blocked = await worker.fetch(request('/v1/usda/search?q=apple', '198.51.100.7'), testEnv());
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  const payload = await body(blocked);
  assert.equal((payload.error as Record<string, unknown>).code, 'RATE_LIMITED');

  const otherIp = await worker.fetch(request('/v1/usda/search?q=apple', '198.51.100.8'), testEnv());
  assert.equal(otherIp.status, 200);
});

test('secrets and raw queries never leak through thrown errors or cache keys', async () => {
  const cache = new MockCache();
  const worker = createWorker({
    cache,
    fetchImplementation: async (url) => {
      throw new Error(`network failure while fetching ${url}`);
    },
  });
  const rawQuery = 'Sensitive Health Search';

  const response = await worker.fetch(
    request(`/v1/usda/search?q=${encodeURIComponent(rawQuery)}&limit=2`),
    testEnv(),
  );
  assert.equal(response.status, 502);
  const serialized = await response.text();
  assert.doesNotMatch(serialized, new RegExp(TEST_KEY));
  assert.doesNotMatch(serialized, new RegExp(rawQuery, 'i'));
  assert.equal(cache.seenUrls.size, 1);
  for (const cacheKey of cache.seenUrls) {
    assert.doesNotMatch(cacheKey, new RegExp(TEST_KEY));
    assert.doesNotMatch(cacheKey, /sensitive|health/i);
  }
});

test('missing secret and invalid detail IDs fail safely without upstream calls', async () => {
  let upstreamCalls = 0;
  const worker = createWorker({
    fetchImplementation: async () => {
      upstreamCalls += 1;
      return json(detailFood);
    },
    cache: new MockCache(),
  });

  const invalid = await worker.fetch(request('/v1/usda/foods/not-a-number'), testEnv());
  assert.equal(invalid.status, 400);
  assert.equal(((await body(invalid)).error as Record<string, unknown>).code, 'INVALID_FDC_ID');

  const missingSecret = await worker.fetch(request('/v1/usda/foods/54321'), {});
  assert.equal(missingSecret.status, 503);
  const serialized = await missingSecret.text();
  assert.match(serialized, /SERVICE_NOT_CONFIGURED/);
  assert.doesNotMatch(serialized, /USDA_FDC_API_KEY/);
  assert.equal(upstreamCalls, 0);
});
