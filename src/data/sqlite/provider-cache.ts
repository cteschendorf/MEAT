import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { ProviderCache, ProviderCacheEntry } from '@/data/providers/contracts';

export type CachedFoodProviderId = 'usda-fdc' | 'open-food-facts';

const databaseNames: Readonly<Record<CachedFoodProviderId, string>> = {
  'usda-fdc': 'usda-fdc-cache.db',
  'open-food-facts': 'open-food-facts-cache.db',
};

const databasePromises = new Map<CachedFoodProviderId, Promise<SQLiteDatabase>>();

async function initializeProviderCache(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY NOT NULL,
      stored_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cache_entries_expiry_idx
      ON cache_entries (expires_at);
  `);
}

export function openProviderCacheDatabase(provider: CachedFoodProviderId): Promise<SQLiteDatabase> {
  const existing = databasePromises.get(provider);
  if (existing) return existing;

  const promise = openDatabaseAsync(databaseNames[provider], { useNewConnection: true })
    .then(async (db) => {
      await initializeProviderCache(db);
      return db;
    })
    .catch((error: unknown) => {
      databasePromises.delete(provider);
      throw error;
    });
  databasePromises.set(provider, promise);
  return promise;
}

interface CacheRow {
  payload: string;
  stored_at: number;
  expires_at: number;
}

export class SqliteProviderCache implements ProviderCache {
  constructor(private readonly db: SQLiteDatabase) {}

  async get<T>(key: string): Promise<ProviderCacheEntry<T> | null> {
    const row = await this.db.getFirstAsync<CacheRow>(
      'SELECT payload, stored_at, expires_at FROM cache_entries WHERE cache_key = ?',
      key,
    );
    if (!row) return null;
    return {
      value: JSON.parse(row.payload) as T,
      storedAt: row.stored_at,
      expiresAt: row.expires_at,
    };
  }

  async set<T>(key: string, entry: ProviderCacheEntry<T>): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO cache_entries (cache_key, stored_at, expires_at, payload)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         stored_at = excluded.stored_at,
         expires_at = excluded.expires_at,
         payload = excluded.payload`,
      key,
      entry.storedAt,
      entry.expiresAt,
      JSON.stringify(entry.value),
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM cache_entries WHERE cache_key = ?', key);
  }

  async prune(before = Date.now() - 30 * 24 * 60 * 60 * 1_000): Promise<void> {
    await this.db.runAsync('DELETE FROM cache_entries WHERE expires_at < ?', before);
  }
}

export async function createProviderCache(provider: CachedFoodProviderId): Promise<SqliteProviderCache> {
  return new SqliteProviderCache(await openProviderCacheDatabase(provider));
}
