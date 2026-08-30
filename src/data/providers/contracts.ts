import type {
  FoodCandidate,
  FoodProviderIssue,
  FoodRef,
  FoodResultFreshness,
  FoodSearchGroup,
  FoodSourceId,
} from '@/domain/food/source';

export type { FoodProviderIssue } from '@/domain/food/source';

export interface FoodProviderCapabilities {
  readonly search: boolean;
  readonly getById: boolean;
  readonly lookupBarcode: boolean;
  readonly persist: boolean;
}

export interface FoodProviderRequestOptions {
  readonly signal?: AbortSignal;
  /** Return an expired selected record immediately instead of refreshing it. */
  readonly preferCached?: boolean;
  /** Disabled sources can still resolve cached history without making a request. */
  readonly allowNetwork?: boolean;
}

export interface FoodSearchOptions extends FoodProviderRequestOptions {
  readonly limit?: number;
}

export interface FoodLookupResult {
  readonly candidate: FoodCandidate | null;
  readonly freshness: FoodResultFreshness;
  readonly issue?: FoodProviderIssue;
}

export interface FoodProvider {
  readonly id: FoodSourceId;
  readonly capabilities: FoodProviderCapabilities;
  search(query: string, options?: FoodSearchOptions): Promise<FoodSearchGroup>;
  getById(ref: FoodRef, options?: FoodProviderRequestOptions): Promise<FoodLookupResult>;
  lookupBarcode?(
    barcode: string,
    options?: FoodProviderRequestOptions,
  ): Promise<FoodLookupResult>;
  persist?(candidate: FoodCandidate, options?: FoodProviderRequestOptions): Promise<void>;
}

export interface ProviderCacheEntry<T> {
  readonly value: T;
  readonly storedAt: number;
  readonly expiresAt: number;
}

/**
 * Reads intentionally return expired entries so providers can offer a marked
 * stale fallback during outages. Cache implementations must not eagerly delete
 * expired values from `get`.
 */
export interface ProviderCache {
  get<T>(key: string): Promise<ProviderCacheEntry<T> | null>;
  set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void>;
  delete?(key: string): Promise<void>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type ProviderClock = () => Date;
