import { ApiError } from '@/data/providers/api-error';
import { BARCODE_CACHE_TTL_MS, cacheEntry, FOOD_DETAIL_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS } from '@/data/providers/cache';
import type {
  FetchLike,
  FoodLookupResult,
  FoodProvider,
  FoodProviderCapabilities,
  FoodProviderRequestOptions,
  FoodSearchOptions,
  ProviderCache,
  ProviderClock,
} from '@/data/providers/contracts';
import { fetchJson } from '@/data/providers/http';
import {
  cacheKey,
  cachedLookup,
  cachedSearch,
  normalizedBarcode,
  normalizedLimit,
  normalizedQuery,
  normalizedRecordId,
} from '@/data/providers/provider-helpers';
import {
  parseOpenFoodFactsProductResponse,
  parseOpenFoodFactsSearchResponse,
} from '@/data/providers/normalization';
import type { FoodCandidate, FoodRef, FoodSearchGroup } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';

export const DEFAULT_OPEN_FOOD_FACTS_BASE_URL = 'https://world.openfoodfacts.org';
const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'abbreviated_product_name',
  'generic_name',
  'brands',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
].join(',');

export interface OpenFoodFactsProviderOptions {
  readonly cache: ProviderCache;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly clock?: ProviderClock;
}

function defaultFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export class OpenFoodFactsProvider implements FoodProvider {
  readonly id = 'open-food-facts' as const;
  readonly capabilities: FoodProviderCapabilities = {
    search: true,
    getById: true,
    lookupBarcode: true,
    persist: true,
  };

  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly clock: ProviderClock;
  private readonly cache: ProviderCache;

  constructor(options: OpenFoodFactsProviderOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPEN_FOOD_FACTS_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetch ?? defaultFetch;
    this.clock = options.clock ?? (() => new Date());
    this.cache = options.cache;
  }

  async search(query: string, options: FoodSearchOptions = {}): Promise<FoodSearchGroup> {
    const normalized = normalizedQuery(query);
    const limit = normalizedLimit(options.limit, 24);
    const key = cacheKey(this.id, 'search', `${normalized.toLocaleLowerCase('en-US')}:${limit}`);
    return cachedSearch({
      sourceId: this.id,
      query: normalized,
      key,
      cache: this.cache,
      clock: this.clock,
      ttlMs: SEARCH_CACHE_TTL_MS,
      load: async () => {
        // OFF v2 only supports structured filters. Its documented legacy v1
        // endpoint remains the only production endpoint for plain-text search.
        const params = new URLSearchParams({
          search_terms: normalized,
          search_simple: '1',
          action: 'process',
          json: '1',
          fields: OFF_FIELDS,
          page: '1',
          page_size: String(limit),
        });
        const url = `${this.baseUrl}/cgi/search.pl?${params}`;
        const body = await fetchJson(this.fetcher, url, {
          clock: this.clock,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return parseOpenFoodFactsSearchResponse(body, this.clock().toISOString() as ISODateTime);
      },
    });
  }

  async getById(ref: FoodRef, options: FoodProviderRequestOptions = {}): Promise<FoodLookupResult> {
    if (ref.sourceId !== this.id) {
      throw new ApiError('invalid-request', `Open Food Facts cannot load a ${ref.sourceId} food reference.`);
    }
    return this.lookup(normalizedRecordId(ref.recordId), 'food', FOOD_DETAIL_CACHE_TTL_MS, options);
  }

  async lookupBarcode(barcode: string, options: FoodProviderRequestOptions = {}): Promise<FoodLookupResult> {
    return this.lookup(normalizedBarcode(barcode), 'barcode', BARCODE_CACHE_TTL_MS, options);
  }

  async persist(candidate: FoodCandidate): Promise<void> {
    if (candidate.ref.sourceId !== this.id) {
      throw new ApiError('invalid-request', 'Open Food Facts can only retain its own product records.');
    }
    const recordId = normalizedRecordId(candidate.ref.recordId);
    const entry = cacheEntry(candidate, this.clock(), FOOD_DETAIL_CACHE_TTL_MS);
    await Promise.all([
      this.cache.set(cacheKey(this.id, 'food', recordId), entry),
      this.cache.set(cacheKey(this.id, 'barcode', recordId), entry),
    ]);
  }

  private async lookup(
    barcode: string,
    operation: 'food' | 'barcode',
    ttlMs: number,
    options: FoodProviderRequestOptions,
  ): Promise<FoodLookupResult> {
    return cachedLookup({
      key: cacheKey(this.id, operation, barcode),
      cache: this.cache,
      clock: this.clock,
      ttlMs,
      ...(options.preferCached === undefined ? {} : { preferCached: options.preferCached }),
      ...(options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork }),
      load: async () => {
        const params = new URLSearchParams({ fields: OFF_FIELDS });
        const url = `${this.baseUrl}/api/v3/product/${encodeURIComponent(barcode)}?${params}`;
        try {
          const body = await fetchJson(this.fetcher, url, {
            clock: this.clock,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          return parseOpenFoodFactsProductResponse(body, this.clock().toISOString() as ISODateTime);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },
    });
  }
}

/** @deprecated Use OpenFoodFactsProvider. */
export { OpenFoodFactsProvider as OpenFoodFactsV2Provider };
