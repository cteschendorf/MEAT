import { ApiError } from '@/data/providers/api-error';
import { cacheEntry, FOOD_DETAIL_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS } from '@/data/providers/cache';
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
  normalizedLimit,
  normalizedQuery,
  normalizedRecordId,
} from '@/data/providers/provider-helpers';
import { parseUsdaFoodResponse, parseUsdaSearchResponse } from '@/data/providers/normalization';
import type { FoodCandidate, FoodRef, FoodSearchGroup } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';

export const DEFAULT_USDA_PROXY_BASE_URL = 'https://api.meatnutrition.app';

export interface UsdaFdcProxyProviderOptions {
  readonly cache: ProviderCache;
  readonly baseUrl?: string;
  readonly fetch?: FetchLike;
  readonly clock?: ProviderClock;
}

function defaultFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  return globalThis.fetch(input, init);
}

export class UsdaFdcProxyProvider implements FoodProvider {
  readonly id = 'usda-fdc' as const;
  readonly capabilities: FoodProviderCapabilities = {
    search: true,
    getById: true,
    lookupBarcode: false,
    persist: true,
  };

  private readonly baseUrl: string;
  private readonly fetcher: FetchLike;
  private readonly clock: ProviderClock;
  private readonly cache: ProviderCache;

  constructor(options: UsdaFdcProxyProviderOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_USDA_PROXY_BASE_URL).replace(/\/$/, '');
    this.fetcher = options.fetch ?? defaultFetch;
    this.clock = options.clock ?? (() => new Date());
    this.cache = options.cache;
  }

  async search(query: string, options: FoodSearchOptions = {}): Promise<FoodSearchGroup> {
    const normalized = normalizedQuery(query);
    if (normalized.length < 2 || normalized.length > 80) {
      throw new ApiError('invalid-request', 'USDA search terms must contain 2 to 80 characters.');
    }
    const limit = normalizedLimit(options.limit, 25, 25);
    const key = cacheKey(this.id, 'search', `${normalized.toLocaleLowerCase('en-US')}:${limit}`);
    return cachedSearch({
      sourceId: this.id,
      query: normalized,
      key,
      cache: this.cache,
      clock: this.clock,
      ttlMs: SEARCH_CACHE_TTL_MS,
      load: async () => {
        const params = new URLSearchParams({ q: normalized, limit: String(limit) });
        const url = `${this.baseUrl}/v1/usda/search?${params}`;
        const body = await fetchJson(this.fetcher, url, {
          clock: this.clock,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return parseUsdaSearchResponse(body, this.clock().toISOString() as ISODateTime);
      },
    });
  }

  async getById(ref: FoodRef, options: FoodProviderRequestOptions = {}): Promise<FoodLookupResult> {
    if (ref.sourceId !== this.id) {
      throw new ApiError('invalid-request', `USDA cannot load a ${ref.sourceId} food reference.`);
    }
    const recordId = normalizedRecordId(ref.recordId);
    if (!/^[1-9]\d{0,9}$/.test(recordId)) {
      throw new ApiError('invalid-request', 'USDA FoodData Central IDs must be positive integers.');
    }
    return cachedLookup({
      key: cacheKey(this.id, 'food', recordId),
      cache: this.cache,
      clock: this.clock,
      ttlMs: FOOD_DETAIL_CACHE_TTL_MS,
      ...(options.preferCached === undefined ? {} : { preferCached: options.preferCached }),
      ...(options.allowNetwork === undefined ? {} : { allowNetwork: options.allowNetwork }),
      load: async () => {
        const url = `${this.baseUrl}/v1/usda/foods/${encodeURIComponent(recordId)}`;
        try {
          const body = await fetchJson(this.fetcher, url, {
            clock: this.clock,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          return parseUsdaFoodResponse(body, this.clock().toISOString() as ISODateTime);
        } catch (error) {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        }
      },
    });
  }

  async persist(candidate: FoodCandidate): Promise<void> {
    if (candidate.ref.sourceId !== this.id) {
      throw new ApiError('invalid-request', 'USDA can only retain USDA FoodData Central records.');
    }
    const recordId = normalizedRecordId(candidate.ref.recordId);
    await this.cache.set(
      cacheKey(this.id, 'food', recordId),
      cacheEntry(candidate, this.clock(), FOOD_DETAIL_CACHE_TTL_MS),
    );
  }

}
