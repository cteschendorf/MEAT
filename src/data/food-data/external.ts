import type { SQLiteDatabase } from 'expo-sqlite';
import type { Food } from '@/domain';
import type { ISODateTime } from '@/domain/shared/ids';
import type { FoodSourcePreferenceStore } from '@/data/food-data/source-preferences';
import { normalizeUsdaFood, type UsdaFoodRecord } from '@/data/food-data/usda';

export type ExternalFoodProviderId = 'usda-fdc' | 'open-food-facts';

export interface ExternalFoodProvider {
  readonly id: ExternalFoodProviderId;
  search(query: string): Promise<ReadonlyArray<Food>>;
  findByBarcode(barcode: string): Promise<Food | null>;
}

export interface FoodSourceResultGroup {
  sourceId: 'usda-local' | ExternalFoodProviderId;
  foods: ReadonlyArray<Food>;
}

export class ExternalFoodCache {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(provider: ExternalFoodProviderId, key: string, now = new Date()): Promise<Food | null> {
    const row = await this.db.getFirstAsync<{ payload: string; expires_at: string | null }>(
      'SELECT payload, expires_at FROM external_food_cache WHERE provider = ? AND cache_key = ?',
      provider,
      key,
    );
    if (!row || (row.expires_at && new Date(row.expires_at) <= now)) return null;
    return JSON.parse(row.payload) as Food;
  }

  async put(provider: ExternalFoodProviderId, key: string, food: Food, ttlDays = 30): Promise<void> {
    const fetched = new Date();
    const expires = new Date(fetched.getTime() + ttlDays * 86_400_000);
    await this.db.runAsync(
      `INSERT INTO external_food_cache (provider, cache_key, fetched_at, expires_at, payload)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(provider, cache_key) DO UPDATE SET
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         payload = excluded.payload`,
      provider,
      key,
      fetched.toISOString(),
      expires.toISOString(),
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
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1${path}${separator}api_key=${encodeURIComponent(this.apiKey)}`,
      init,
    );
    if (!response.ok) throw new Error(`USDA request failed (${response.status}).`);
    return (await response.json()) as T;
  }

  async search(query: string): Promise<ReadonlyArray<Food>> {
    const data = await this.request<{ foods?: UsdaFoodRecord[] }>('/foods/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, pageSize: 25 }),
    });
    const now = new Date().toISOString() as ISODateTime;
    return (data.foods ?? []).map((item) => normalizeUsdaFood(item, now));
  }

  async findByBarcode(barcode: string): Promise<Food | null> {
    return (await this.search(barcode)).find((food) => food.barcode === barcode) ?? null;
  }
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
    const response = await fetch(
      `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json`,
      { headers: { 'User-Agent': this.userAgent } },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Open Food Facts request failed (${response.status}).`);

    const body = (await response.json()) as {
      product?: {
        product_name?: string;
        brands?: string;
        nutriments?: Record<string, number | string | undefined>;
      };
    };
    const product = body.product;
    if (!product?.product_name) return null;

    const nutrients = product.nutriments ?? {};
    const source = { kind: 'external-api' as const, provider: 'Open Food Facts' };
    const now = new Date().toISOString() as ISODateTime;
    const entries: [string, string, 'kcal' | 'g', number | string | undefined][] = [
      ['energy-kcal', 'Energy', 'kcal', nutrients['energy-kcal_100g']],
      ['protein-g', 'Protein', 'g', nutrients.proteins_100g],
      ['carbohydrate-g', 'Carbohydrate', 'g', nutrients.carbohydrates_100g],
      ['fat-g', 'Fat', 'g', nutrients.fat_100g],
      ['fiber-g', 'Fiber', 'g', nutrients.fiber_100g],
    ];

    return {
      id: `off:${barcode}` as Food['id'],
      kind: 'branded',
      name: product.product_name,
      ...(product.brands ? { brand: product.brands } : {}),
      barcode,
      nutrition: {
        basisGrams: 100,
        nutrients: entries.map(([code, name, unit, raw]) => {
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
  sourcePreferences?: FoodSourcePreferenceStore;
}

async function enabled(context: ExternalResolutionContext, sourceId: 'usda-local' | ExternalFoodProviderId) {
  return context.sourcePreferences ? context.sourcePreferences.isEnabled(sourceId) : true;
}

export async function resolveFoodSearchBySource(
  query: string,
  context: ExternalResolutionContext,
): Promise<ReadonlyArray<FoodSourceResultGroup>> {
  const groups: FoodSourceResultGroup[] = [];

  if (await enabled(context, 'usda-local')) {
    const local = await context.localSearch(query);
    if (local.length) groups.push({ sourceId: 'usda-local', foods: local });
  }

  for (const provider of context.providers) {
    if (!(await enabled(context, provider.id))) continue;
    try {
      const foods = await provider.search(query);
      if (foods.length) groups.push({ sourceId: provider.id, foods });
    } catch {
      // One provider failing must not suppress independent results from other sources.
    }
  }

  return groups;
}

export async function resolveFoodSearch(
  query: string,
  context: ExternalResolutionContext,
): Promise<ReadonlyArray<Food>> {
  const groups = await resolveFoodSearchBySource(query, context);
  return groups.flatMap((group) => group.foods);
}

export async function resolveFoodBarcode(
  barcode: string,
  context: ExternalResolutionContext,
): Promise<Food | null> {
  if (await enabled(context, 'usda-local')) {
    const local = await context.localBarcode(barcode);
    if (local) return local;
  }

  for (const provider of context.providers) {
    if (!(await enabled(context, provider.id))) continue;
    const key = `barcode:${barcode}`;
    const cached = await context.cache.get(provider.id, key);
    if (cached) return cached;
    try {
      const result = await provider.findByBarcode(barcode);
      if (result) {
        await context.cache.put(provider.id, key, result);
        return result;
      }
    } catch {
      // Continue to the next independently configured source.
    }
  }
  return null;
}
