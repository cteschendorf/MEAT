import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food } from '@/domain';
import type { ISODateTime } from '@/domain/shared/ids';
import { normalizeUsdaFood, type UsdaFoodRecord } from '@/data/food-data/usda';

export type ExternalFoodProviderId = 'usda-fdc' | 'open-food-facts';

export interface ExternalFoodProvider {
  readonly id: ExternalFoodProviderId;
  search(query: string): Promise<ReadonlyArray<Food>>;
  findByBarcode(barcode: string): Promise<Food | null>;
}

export class ExternalFoodCache {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(provider: ExternalFoodProviderId, key: string, now = new Date()): Promise<Food | null> {
    const row = await this.db.getFirstAsync<{ payload: string; expires_at: string | null }>(
      'SELECT payload, expires_at FROM external_food_cache WHERE provider = ? AND cache_key = ?',
      provider,
      key,
    );
    if (!row) return null;
    if (row.expires_at && new Date(row.expires_at) <= now) return null;
    return JSON.parse(row.payload) as Food;
  }

  async put(provider: ExternalFoodProviderId, key: string, food: Food, ttlDays = 30): Promise<void> {
    const fetchedAt = new Date();
    const expiresAt = new Date(fetchedAt.getTime() + ttlDays * 86_400_000);
    await this.db.runAsync(
      `INSERT INTO external_food_cache (provider, cache_key, fetched_at, expires_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, cache_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         payload = excluded.payload`,
      provider,
      key,
      fetchedAt.toISOString(),
      expiresAt.toISOString(),
      JSON.stringify(food),
    );
  }
}

export class UsdaFoodDataCentralProvider implements ExternalFoodProvider {
  readonly id = 'usda-fdc' as const;

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error('USDA FoodData Central API key is required.');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`https://api.nal.usda.gov/fdc/v1${path}${separator}api_key=${encodeURIComponent(this.apiKey)}`, init);
    if (!response.ok) throw new Error(`USDA FoodData Central request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  async search(query: string): Promise<ReadonlyArray<Food>> {
    const data = await this.request<{ foods?: UsdaFoodRecord[] }>('/foods/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageSize: 25 }),
    });
    const now = new Date().toISOString() as ISODateTime;
    return (data.foods ?? []).map((food) => normalizeUsdaFood(food, now));
  }

  async findByBarcode(barcode: string): Promise<Food | null> {
    const results = await this.search(barcode);
    return results.find((food) => food.barcode === barcode) ?? null;
  }
}

interface OpenFoodFactsProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, number | string | undefined>;
  serving_quantity?: string | number;
}

export class OpenFoodFactsProvider implements ExternalFoodProvider {
  readonly id = 'open-food-facts' as const;

  constructor(private readonly userAgent: string) {
    if (!userAgent.trim()) throw new Error('Open Food Facts requires an identifying User-Agent.');
  }

  async search(): Promise<ReadonlyArray<Food>> {
    return [];
  }

  async findByBarcode(barcode: string): Promise<Food | null> {
    const response = await fetch(`https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json`, {
      headers: { 'User-Agent': this.userAgent },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Open Food Facts request failed (${response.status}).`);
    const body = (await response.json()) as { product?: OpenFoodFactsProduct };
    const product = body.product;
    if (!product?.product_name) return null;

    const source = { kind: 'external-api' as const, provider: 'Open Food Facts' };
    const n = product.nutriments ?? {};
    const values: Array<[string, string, 'kcal' | 'g', number | string | undefined]> = [
      ['energy-kcal', 'Energy', 'kcal', n['energy-kcal_100g']],
      ['protein-g', 'Protein', 'g', n.proteins_100g],
      ['carbohydrate-g', 'Carbohydrate', 'g', n.carbohydrates_100g],
      ['fat-g', 'Fat', 'g', n.fat_100g],
      ['fiber-g', 'Fiber', 'g', n.fiber_100g],
    ];
    const now = new Date().toISOString() as ISODateTime;

    return {
      id: `off:${barcode}` as Food['id'],
      kind: 'branded',
      name: product.product_name,
      ...(product.brands ? { brand: product.brands } : {}),
      barcode,
      nutrition: {
        basisGrams: 100,
        nutrients: values.map(([code, name, unit, raw]) => {
          const value = typeof raw === 'number' ? raw : raw !== undefined ? Number(raw) : undefined;
          return value !== undefined && Number.isFinite(value)
            ? { nutrient: { code, name, unit }, state: 'known' as const, value, source }
            : { nutrient: { code, name, unit }, state: 'unknown' as const, source };
        }),
      },
      servings: [],
      primarySource: source,
      createdAt: now,
      updatedAt: now,
    };
  }
}

export interface ExternalResolutionContext {
  localSearch: (query: string) => Promise<ReadonlyArray<Food>>;
  localBarcode: (barcode: string) => Promise<Food | null>;
  providers: ReadonlyArray<ExternalFoodProvider>;
  cache: ExternalFoodCache;
}

export async function resolveFoodSearch(query: string, context: ExternalResolutionContext): Promise<ReadonlyArray<Food>> {
  const local = await context.localSearch(query);
  if (local.length > 0) return local;

  for (const provider of context.providers) {
    try {
      const results = await provider.search(query);
      if (results.length > 0) return results;
    } catch {
      continue;
    }
  }
  return [];
}

export async function resolveFoodBarcode(barcode: string, context: ExternalResolutionContext): Promise<Food | null> {
  const local = await context.localBarcode(barcode);
  if (local) return local;

  for (const provider of context.providers) {
    const cacheKey = `barcode:${barcode}`;
    const cached = await context.cache.get(provider.id, cacheKey);
    if (cached) return cached;
    try {
      const result = await provider.findByBarcode(barcode);
      if (!result) continue;
      await context.cache.put(provider.id, cacheKey, result);
      return result;
    } catch {
      continue;
    }
  }
  return null;
}
