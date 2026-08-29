import type { SQLiteDatabase } from 'expo-sqlite';

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

const migrations: ReadonlyArray<Migration> = [
  {
    version: 1,
    name: 'initial-private-tracking-schema',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS foods (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meals (
          id TEXT PRIMARY KEY NOT NULL,
          occurred_at TEXT NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS meals_occurred_at_idx ON meals (occurred_at DESC);
        CREATE TABLE IF NOT EXISTS recipes (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS goals (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 2,
    name: 'local-food-search-corpus',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS food_corpus (
          id TEXT PRIMARY KEY NOT NULL,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          data_type TEXT NOT NULL,
          name TEXT NOT NULL,
          brand TEXT,
          gtin TEXT,
          popularity REAL NOT NULL DEFAULT 0,
          payload TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS food_corpus_source_record_idx
          ON food_corpus (source, source_id);
        CREATE INDEX IF NOT EXISTS food_corpus_gtin_idx
          ON food_corpus (gtin) WHERE gtin IS NOT NULL;
        CREATE VIRTUAL TABLE IF NOT EXISTS food_corpus_fts USING fts5(
          id UNINDEXED,
          name,
          brand,
          tokenize = 'unicode61 remove_diacritics 2'
        );
      `);
    },
  },
  {
    version: 3,
    name: 'segregated-external-food-cache',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS external_food_cache (
          provider TEXT NOT NULL,
          cache_key TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          expires_at TEXT,
          payload TEXT NOT NULL,
          PRIMARY KEY (provider, cache_key)
        );
        CREATE INDEX IF NOT EXISTS external_food_cache_freshness_idx
          ON external_food_cache (provider, fetched_at DESC);
      `);
    },
  },
  {
    version: 4,
    name: 'independent-food-source-preferences',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS food_source_preferences (
          source_id TEXT PRIMARY KEY NOT NULL,
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          priority INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO food_source_preferences (source_id, enabled, priority)
          VALUES ('personal', 1, 0), ('usda-local', 1, 10), ('usda-fdc', 1, 20), ('open-food-facts', 1, 30);
      `);
    },
  },
];

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const current = await db.getFirstAsync<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM schema_migrations',
  );
  const currentVersion = current?.version ?? 0;

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;
    await db.withTransactionAsync(async () => {
      await migration.up(db);
      await db.runAsync(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
  }
}

export const latestMigrationVersion = migrations.at(-1)?.version ?? 0;
