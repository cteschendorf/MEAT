import { ApiError, isApiError } from '@/data/providers/api-error';
import { cacheEntry, isFresh } from '@/data/providers/cache';
import type {
  FoodLookupResult,
  ProviderCache,
  ProviderClock,
} from '@/data/providers/contracts';
import type { FoodCandidate, FoodSearchGroup, FoodSourceId } from '@/domain/food/source';

export function cacheKey(sourceId: FoodSourceId, operation: string, value: string): string {
  return `food-provider:${sourceId}:${operation}:${encodeURIComponent(value)}`;
}

export function normalizedQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, ' ');
  if (!normalized) throw new ApiError('invalid-request', 'Enter a food search term.');
  return normalized;
}

export function normalizedLimit(limit: number | undefined, fallback = 25, maximum = 100): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw new ApiError('invalid-request', `Search limit must be an integer from 1 through ${maximum}.`);
  }
  return limit;
}

export function normalizedRecordId(recordId: string): string {
  const normalized = recordId.trim();
  if (!normalized) throw new ApiError('invalid-request', 'Food record ID is required.');
  return normalized;
}

export function normalizedBarcode(barcode: string): string {
  const normalized = barcode.replace(/[\s-]/g, '');
  if (!/^\d{4,24}$/.test(normalized)) {
    throw new ApiError('invalid-request', 'Barcode must contain 4 to 24 digits.');
  }
  return normalized;
}

function operationalError(error: unknown): ApiError {
  return isApiError(error)
    ? error
    : new ApiError('invalid-response', 'The food provider returned an unexpected result.', { cause: error });
}

export async function cachedSearch(input: {
  readonly sourceId: FoodSourceId;
  readonly query: string;
  readonly key: string;
  readonly cache: ProviderCache;
  readonly clock: ProviderClock;
  readonly ttlMs: number;
  readonly load: () => Promise<readonly FoodCandidate[]>;
}): Promise<FoodSearchGroup> {
  const cached = await input.cache.get<readonly FoodCandidate[]>(input.key);
  const now = input.clock();
  if (cached && isFresh(cached, now)) {
    return cached.value.length
      ? { sourceId: input.sourceId, query: input.query, state: 'ready', candidates: cached.value, freshness: 'fresh-cache' }
      : { sourceId: input.sourceId, query: input.query, state: 'empty', freshness: 'fresh-cache' };
  }

  try {
    const candidates = await input.load();
    await input.cache.set(input.key, cacheEntry(candidates, input.clock(), input.ttlMs));
    return candidates.length
      ? { sourceId: input.sourceId, query: input.query, state: 'ready', candidates, freshness: 'network' }
      : { sourceId: input.sourceId, query: input.query, state: 'empty', freshness: 'network' };
  } catch (caught) {
    const error = operationalError(caught);
    if (error.code === 'aborted' || error.code === 'invalid-request') throw error;
    const issue = error.toProviderIssue();
    const candidates = cached?.value ?? [];
    const freshness = cached ? ({ freshness: 'stale-cache' as const }) : {};
    if (error.code === 'offline') {
      return { sourceId: input.sourceId, query: input.query, state: 'offline', candidates, issue, ...freshness };
    }
    if (error.code === 'throttled') {
      return { sourceId: input.sourceId, query: input.query, state: 'throttled', candidates, issue, ...freshness };
    }
    return { sourceId: input.sourceId, query: input.query, state: 'error', candidates, issue, ...freshness };
  }
}

export async function cachedLookup(input: {
  readonly key: string;
  readonly cache: ProviderCache;
  readonly clock: ProviderClock;
  readonly ttlMs: number;
  readonly preferCached?: boolean;
  readonly allowNetwork?: boolean;
  readonly load: () => Promise<FoodCandidate | null>;
}): Promise<FoodLookupResult> {
  const cached = await input.cache.get<FoodCandidate | null>(input.key);
  if (cached) {
    const fresh = isFresh(cached, input.clock());
    if (fresh || input.preferCached) {
      return { candidate: cached.value, freshness: fresh ? 'fresh-cache' : 'stale-cache' };
    }
  }
  if (input.allowNetwork === false) {
    return {
      candidate: cached?.value ?? null,
      freshness: cached ? 'stale-cache' : 'fresh-cache',
    };
  }
  try {
    const candidate = await input.load();
    await input.cache.set(input.key, cacheEntry(candidate, input.clock(), input.ttlMs));
    return { candidate, freshness: 'network' };
  } catch (caught) {
    const error = operationalError(caught);
    if (error.code === 'aborted' || error.code === 'invalid-request' || !cached) throw error;
    return { candidate: cached.value, freshness: 'stale-cache', issue: error.toProviderIssue() };
  }
}
