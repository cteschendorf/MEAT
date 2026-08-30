import type { ProviderCache, ProviderCacheEntry } from '@/data/providers/contracts';

export const SEARCH_CACHE_TTL_MS = 30 * 60 * 1_000;
export const BARCODE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const FOOD_DETAIL_CACHE_TTL_MS = BARCODE_CACHE_TTL_MS;

export function isFresh<T>(entry: ProviderCacheEntry<T>, now: Date): boolean {
  return entry.expiresAt > now.getTime();
}

export function cacheEntry<T>(value: T, now: Date, ttlMs: number): ProviderCacheEntry<T> {
  const storedAt = now.getTime();
  return { value, storedAt, expiresAt: storedAt + ttlMs };
}

export class MemoryProviderCache implements ProviderCache {
  private readonly entries = new Map<string, ProviderCacheEntry<unknown>>();

  async get<T>(key: string): Promise<ProviderCacheEntry<T> | null> {
    return (this.entries.get(key) as ProviderCacheEntry<T> | undefined) ?? null;
  }

  async set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void> {
    this.entries.set(key, entry as ProviderCacheEntry<unknown>);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}
