import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food } from '@/domain/food/food';
import {
  foodIdForRef,
  legacyProviderFoodRefFromFoodId,
  type FoodCandidate,
  type FoodRef,
} from '@/domain/food/source';
import type { FoodId } from '@/domain/shared/ids';

export interface Migration {
  version: number;
  name: string;
  up: (db: SQLiteDatabase) => Promise<void>;
}

type ReferenceTable = 'favorite_food_refs' | 'known_food_refs';
type PayloadTable = 'meals' | 'recipes' | 'saved_meals';

interface ReferenceRow {
  food_id: FoodId;
  updated_at: string;
}

interface FoodPayloadRow {
  id: FoodId;
  payload: string;
}

interface StoredPayloadRow {
  id: string;
  payload: string;
}

function candidateFromLegacySnapshot(row: FoodPayloadRow, ref: FoodRef): FoodCandidate {
  const parsed = JSON.parse(row.payload) as Food;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.servings)) {
    throw new Error(`Legacy provider food ${row.id} has an invalid payload.`);
  }
  const id = foodIdForRef(ref);
  const food: Food = {
    ...parsed,
    id,
    servings: parsed.servings.map((serving) => ({ ...serving, foodId: id })),
  };
  const license = ref.sourceId === 'usda-fdc'
    ? { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' }
    : { name: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' };
  return {
    ref,
    food,
    portions: food.servings.map((serving) => ({
      id: serving.id,
      label: serving.label,
      quantity: serving.quantity,
      unit: serving.unit,
      ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
      ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
    })),
    provenance: {
      provider: ref.sourceId,
      recordId: ref.recordId,
      license,
      ...(food.updatedAt ? { retrievedAt: food.updatedAt } : {}),
    },
  };
}

async function canonicalizeReferenceTable(db: SQLiteDatabase, table: ReferenceTable): Promise<void> {
  const rows = await db.getAllAsync<ReferenceRow>(
    `SELECT food_id, updated_at FROM ${table} WHERE food_id LIKE 'usda:%' OR food_id LIKE 'off:%'`,
  );
  for (const row of rows) {
    const ref = legacyProviderFoodRefFromFoodId(row.food_id);
    if (!ref) continue;
    const canonicalId = foodIdForRef(ref);
    await db.runAsync(
      `INSERT INTO ${table} (food_id, updated_at) VALUES (?, ?)
       ON CONFLICT(food_id) DO UPDATE SET
         updated_at = MAX(${table}.updated_at, excluded.updated_at)`,
      canonicalId,
      row.updated_at,
    );
    await db.runAsync(`DELETE FROM ${table} WHERE food_id = ?`, row.food_id);
  }
}

function rewriteLegacyFoodIds(value: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(value)) {
    let changed = false;
    const rewritten = value.map((entry) => {
      const result = rewriteLegacyFoodIds(entry);
      changed ||= result.changed;
      return result.value;
    });
    return { value: changed ? rewritten : value, changed };
  }
  if (!value || typeof value !== 'object') return { value, changed: false };

  const original = value as Record<string, unknown>;
  let changed = false;
  const rewritten: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(original)) {
    const result = rewriteLegacyFoodIds(entry);
    rewritten[key] = result.value;
    changed ||= result.changed;
  }

  if (typeof original.foodId === 'string') {
    const ref = legacyProviderFoodRefFromFoodId(original.foodId);
    if (ref) {
      rewritten.foodId = foodIdForRef(ref);
      rewritten.foodRef = ref;
      changed = true;
    }
  }
  return { value: changed ? rewritten : value, changed };
}

async function canonicalizePayloadTable(db: SQLiteDatabase, table: PayloadTable): Promise<number> {
  const rows = await db.getAllAsync<StoredPayloadRow>(`SELECT id, payload FROM ${table}`);
  let rewrittenCount = 0;
  for (const row of rows) {
    const result = rewriteLegacyFoodIds(JSON.parse(row.payload) as unknown);
    if (!result.changed) continue;
    await db.runAsync(`UPDATE ${table} SET payload = ? WHERE id = ?`, JSON.stringify(result.value), row.id);
    rewrittenCount += 1;
  }
  return rewrittenCount;
}

export interface LegacyProviderTransferResult {
  readonly snapshotsTransferred: number;
  readonly payloadsRewritten: number;
}

/**
 * Seed full build-1 provider snapshots into their physical provider caches,
 * then canonicalize private references and remove the compatibility copies.
 * A persistence failure happens before the private transaction, so the legacy
 * snapshots remain available for a later retry and historical logs stay safe.
 */
export async function transferLegacyProviderFoodSnapshots(
  db: SQLiteDatabase,
  persist: (candidate: FoodCandidate) => Promise<void>,
): Promise<LegacyProviderTransferResult> {
  const rows = await db.getAllAsync<FoodPayloadRow>(
    "SELECT id, payload FROM foods WHERE id LIKE 'usda:%' OR id LIKE 'off:%' ORDER BY id ASC",
  );
  const snapshots = rows.map((row) => {
    const ref = legacyProviderFoodRefFromFoodId(row.id);
    if (!ref) throw new Error(`Legacy provider food ${row.id} has an invalid ID.`);
    return { row, candidate: candidateFromLegacySnapshot(row, ref) };
  });

  for (const snapshot of snapshots) await persist(snapshot.candidate);

  let payloadsRewritten = 0;
  await db.withTransactionAsync(async () => {
    await canonicalizeReferenceTable(db, 'favorite_food_refs');
    await canonicalizeReferenceTable(db, 'known_food_refs');
    payloadsRewritten += await canonicalizePayloadTable(db, 'meals');
    payloadsRewritten += await canonicalizePayloadTable(db, 'recipes');
    payloadsRewritten += await canonicalizePayloadTable(db, 'saved_meals');
    for (const snapshot of snapshots) {
      await db.runAsync('DELETE FROM foods WHERE id = ?', snapshot.row.id);
    }
  });

  return { snapshotsTransferred: snapshots.length, payloadsRewritten };
}

const migrations: readonly Migration[] = [
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
  {
    version: 5,
    name: 'favorite-foods',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS favorite_foods (
          food_id TEXT PRIMARY KEY NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 6,
    name: 'user-preferences-and-onboarding',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
          payload TEXT NOT NULL,
          onboarding_completed INTEGER NOT NULL DEFAULT 0 CHECK (onboarding_completed IN (0, 1)),
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 7,
    name: 'saved-meal-templates',
    async up(db) {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS saved_meals (
          id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS saved_meals_updated_at_idx ON saved_meals (updated_at DESC);
      `);
    },
  },
  {
    version: 8,
    name: 'source-aware-favorites-and-legacy-onboarding',
    async up(db) {
      const appliedAt = new Date().toISOString();
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS favorite_food_refs (
          food_id TEXT PRIMARY KEY NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS known_food_refs (
          food_id TEXT PRIMARY KEY NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT OR IGNORE INTO favorite_food_refs (food_id, updated_at)
          SELECT food_id, updated_at FROM favorite_foods;
        INSERT OR IGNORE INTO known_food_refs (food_id, updated_at)
          SELECT id, updated_at FROM foods;

        INSERT OR IGNORE INTO food_source_preferences (source_id, enabled, priority)
          SELECT 'usda-core', enabled, priority
          FROM food_source_preferences
          WHERE source_id = 'usda-local';
        DELETE FROM food_source_preferences WHERE source_id = 'usda-local';
      `);

      const privateData = await db.getFirstAsync<{ count: number }>(
        `SELECT (
          (SELECT COUNT(*) FROM foods) +
          (SELECT COUNT(*) FROM meals) +
          (SELECT COUNT(*) FROM recipes) +
          (SELECT COUNT(*) FROM saved_meals)
        ) AS count`,
      );
      if ((privateData?.count ?? 0) > 0) {
        await db.runAsync(
          `INSERT INTO user_preferences (singleton_id, payload, onboarding_completed, updated_at)
           VALUES (1, ?, 1, ?)
           ON CONFLICT(singleton_id) DO UPDATE SET
             onboarding_completed = 1,
             updated_at = excluded.updated_at`,
          JSON.stringify({
            massUnit: 'g',
            energyUnit: 'kcal',
            appearance: 'system',
            weekStartsOn: 0,
          }),
          appliedAt,
        );
      }
    },
  },
  {
    version: 9,
    name: 'remove-replaced-private-food-caches',
    async up(db) {
      // Build 1 never populated its corpus automatically. Any food that was
      // actually logged was already copied to `foods`, and favorites were
      // migrated in v8. Provider data now lives only in its physical store.
      await db.execAsync(`
        DROP TABLE IF EXISTS food_corpus_fts;
        DROP TABLE IF EXISTS food_corpus;
        DROP TABLE IF EXISTS external_food_cache;
        DROP TABLE IF EXISTS favorite_foods;
      `);
    },
  },
  {
    version: 10,
    name: 'legacy-provider-id-compatibility',
    async up(db) {
      // Build 1 used `usda:*` and `off:*` before provider-scoped IDs were
      // introduced. Reference indexes can be canonicalized immediately. Full
      // payload rewrites and compatibility-row deletion happen only after
      // openAppServices seeds the matching physical provider caches.
      await canonicalizeReferenceTable(db, 'favorite_food_refs');
      await canonicalizeReferenceTable(db, 'known_food_refs');
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
