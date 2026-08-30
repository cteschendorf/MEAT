import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import {
  migrateDatabase,
  transferLegacyProviderFoodSnapshots,
} from '../src/data/sqlite/migrations';
import {
  SqliteFoodRepository,
  SqliteFoodReferenceRepository,
  SqliteGoalRepository,
  SqliteMealRepository,
  SqliteUserPreferencesRepository,
} from '../src/data/sqlite/repositories';
import type { FoodSourcePreferenceStore } from '../src/data/food-data/source-preferences';
import type { FoodProvider } from '../src/data/providers/contracts';
import type { Food, Meal } from '../src/domain';
import {
  foodIdForRef,
  sourceIdFromFoodId,
  type FoodCandidate,
  type FoodSourceId,
} from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import { buildTodaySnapshot } from '../src/services/today/snapshot';
import {
  CompositeFoodRepository,
  FoodDiscoveryService,
  PersonalFoodProvider,
} from '../src/services/logging/food-discovery';

function expoDatabase(node: DatabaseSync): SQLiteDatabase {
  const adapter = {
    async execAsync(sql: string) {
      node.exec(sql);
    },
    async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return (node.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) {
      return node.prepare(sql).all(...params) as T[];
    },
    async runAsync(sql: string, ...params: (string | number | null)[]) {
      return node.prepare(sql).run(...params);
    },
    async withTransactionAsync(operation: () => Promise<void>) {
      node.exec('BEGIN');
      try {
        await operation();
        node.exec('COMMIT');
      } catch (error) {
        node.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return adapter as unknown as SQLiteDatabase;
}

const timestamp = '2026-08-29T12:00:00.000Z' as ISODateTime;

function legacyFood(): Food {
  const id = 'food:build-1' as FoodId;
  return {
    id,
    kind: 'custom',
    name: 'Build 1 yogurt',
    nutrition: {
      basisGrams: 100,
      nutrients: [
        {
          nutrient: { code: 'energy-kcal', name: 'Calories', unit: 'kcal' },
          state: 'known',
          value: 100,
        },
      ],
    },
    servings: [
      {
        id: 'serving:build-1' as FoodServingId,
        foodId: id,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function legacyMeal(foodId: FoodId): Meal {
  return {
    id: 'meal:build-1' as MealId,
    occurredAt: timestamp,
    items: [
      {
        id: 'item:build-1' as MealItemId,
        foodId,
        portion: { quantity: 1, gramWeight: 125 },
      },
    ],
    mediaIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function legacyProviderFood(id: FoodId, name: string, calories: number): Food {
  return {
    id,
    kind: String(id).startsWith('off:') ? 'branded' : 'generic',
    name,
    nutrition: {
      basisGrams: 100,
      nutrients: [
        {
          nutrient: { code: 'energy-kcal', name: 'Calories', unit: 'kcal' },
          state: 'known',
          value: calories,
        },
      ],
    },
    servings: [
      {
        id: `${id}:serving` as FoodServingId,
        foodId: id,
        label: 'serving',
        quantity: 1,
        unit: 'serving',
        gramWeight: 100,
      },
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function legacyProviderMeal(foodIds: readonly FoodId[]): Meal {
  return {
    id: 'meal:build-1-providers' as MealId,
    occurredAt: timestamp,
    items: foodIds.map((foodId, index) => ({
      id: `item:build-1-provider:${index}` as MealItemId,
      foodId,
      portion: { quantity: 1, gramWeight: 100 },
    })),
    mediaIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function unavailableProvider(id: FoodSourceId): FoodProvider {
  return {
    id,
    capabilities: { search: true, getById: true, lookupBarcode: false, persist: false },
    async search(query) {
      return { sourceId: id, query, state: 'empty', freshness: 'network' };
    },
    async getById() {
      throw new Error(`${id} cache unavailable`);
    },
  };
}

async function buildVersionSevenFixture() {
  const node = new DatabaseSync(':memory:');
  const db = expoDatabase(node);
  await migrateDatabase(db);
  node.exec(`
    DELETE FROM schema_migrations WHERE version >= 8;
    DROP TABLE favorite_food_refs;
    DROP TABLE known_food_refs;
    CREATE TABLE favorite_foods (
      food_id TEXT PRIMARY KEY NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
      updated_at TEXT NOT NULL
    );
    DELETE FROM food_source_preferences WHERE source_id = 'usda-core';
    INSERT INTO food_source_preferences (source_id, enabled, priority)
      VALUES ('usda-local', 0, 7);
  `);
  return { node, db };
}

test('build-1 data migrates to source-aware refs without losing totals or preferences', async () => {
  const { node, db } = await buildVersionSevenFixture();
  const food = legacyFood();
  const meal = legacyMeal(food.id);
  const existingPreferences = {
    massUnit: 'g',
    energyUnit: 'kcal',
    appearance: 'dark',
    weekStartsOn: 1,
  };
  node.prepare('INSERT INTO foods (id, payload, updated_at) VALUES (?, ?, ?)')
    .run(food.id, JSON.stringify(food), timestamp);
  node.prepare('INSERT INTO meals (id, occurred_at, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run(meal.id, meal.occurredAt, JSON.stringify(meal), timestamp);
  node.prepare('INSERT INTO favorite_foods (food_id, updated_at) VALUES (?, ?)')
    .run(food.id, timestamp);
  node.prepare(
    'INSERT INTO user_preferences (singleton_id, payload, onboarding_completed, updated_at) VALUES (1, ?, 0, ?)',
  ).run(JSON.stringify(existingPreferences), timestamp);

  await migrateDatabase(db);

  assert.deepEqual(await new SqliteFoodRepository(db).getById(food.id), food);
  assert.deepEqual(await new SqliteMealRepository(db).getById(meal.id), meal);
  assert.deepEqual(
    node.prepare('SELECT food_id FROM favorite_food_refs').all().map((row) => row.food_id),
    [food.id],
  );
  assert.deepEqual(
    node.prepare('SELECT food_id FROM known_food_refs').all().map((row) => row.food_id),
    [food.id],
  );
  const legacySourceCount = node
    .prepare("SELECT COUNT(*) AS count FROM food_source_preferences WHERE source_id = 'usda-local'")
    .get() as { count: number };
  assert.equal(legacySourceCount.count, 0);
  const coreSource = node
    .prepare("SELECT enabled, priority FROM food_source_preferences WHERE source_id = 'usda-core'")
    .get() as { enabled: number; priority: number };
  assert.equal(coreSource.enabled, 0);
  assert.equal(coreSource.priority, 7);
  const replacedTables = node.prepare(
    `SELECT name FROM sqlite_master
     WHERE type IN ('table', 'view')
       AND name IN ('food_corpus', 'food_corpus_fts', 'external_food_cache', 'favorite_foods')`,
  ).all();
  assert.deepEqual(replacedTables, []);

  const userPreferences = new SqliteUserPreferencesRepository(db);
  assert.deepEqual(await userPreferences.get(), existingPreferences);
  assert.equal(await userPreferences.isOnboardingComplete(), true);

  const snapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    foods: new SqliteFoodRepository(db),
    meals: new SqliteMealRepository(db),
    goals: new SqliteGoalRepository(db),
  });
  assert.equal(snapshot.metrics.find((metric) => metric.code === 'energy-kcal')?.value, 125);
  node.close();
});

test('a genuinely empty install remains eligible for onboarding', async () => {
  const { node, db } = await buildVersionSevenFixture();
  await migrateDatabase(db);
  assert.equal(await new SqliteUserPreferencesRepository(db).isOnboardingComplete(), false);
  node.close();
});

test('build-1 provider IDs transfer full snapshots before private compatibility rows are removed', async () => {
  const { node, db } = await buildVersionSevenFixture();
  const personal = legacyFood();
  const usda = legacyProviderFood('usda:171077' as FoodId, 'Build 1 USDA yogurt', 63);
  const off = legacyProviderFood('off:3017620422003' as FoodId, 'Build 1 OFF spread', 539);
  const meal = legacyProviderMeal([personal.id, usda.id, off.id]);

  for (const food of [personal, usda, off]) {
    node.prepare('INSERT INTO foods (id, payload, updated_at) VALUES (?, ?, ?)')
      .run(food.id, JSON.stringify(food), timestamp);
    node.prepare('INSERT INTO favorite_foods (food_id, updated_at) VALUES (?, ?)')
      .run(food.id, timestamp);
  }
  node.prepare('INSERT INTO meals (id, occurred_at, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run(meal.id, meal.occurredAt, JSON.stringify(meal), timestamp);

  await migrateDatabase(db);

  const usdaCanonical = foodIdForRef({
    sourceId: 'usda-fdc',
    recordId: '171077' as SourceRecordId,
  });
  const offCanonical = foodIdForRef({
    sourceId: 'open-food-facts',
    recordId: '3017620422003' as SourceRecordId,
  });
  assert.equal(sourceIdFromFoodId(usda.id), 'usda-fdc');
  assert.equal(sourceIdFromFoodId(off.id), 'open-food-facts');
  assert.equal(sourceIdFromFoodId(personal.id), null);
  assert.deepEqual(
    node.prepare('SELECT food_id FROM known_food_refs ORDER BY food_id').all().map((row) => row.food_id),
    [offCanonical, personal.id, usdaCanonical].sort(),
  );
  assert.deepEqual(
    node.prepare('SELECT food_id FROM favorite_food_refs ORDER BY food_id').all().map((row) => row.food_id),
    [offCanonical, personal.id, usdaCanonical].sort(),
  );

  let attemptedWrites = 0;
  await assert.rejects(
    transferLegacyProviderFoodSnapshots(db, async () => {
      attemptedWrites += 1;
      if (attemptedWrites === 2) throw new Error('provider cache unavailable');
    }),
    /provider cache unavailable/,
  );
  const retained = node
    .prepare("SELECT COUNT(*) AS count FROM foods WHERE id LIKE 'usda:%' OR id LIKE 'off:%'")
    .get() as { count: number };
  assert.equal(retained.count, 2);
  assert.deepEqual(
    (await new SqliteMealRepository(db).getById(meal.id))?.items.map((item) => item.foodId),
    [personal.id, usda.id, off.id],
  );
  const privateFoods = new SqliteFoodRepository(db);
  const discovery = new FoodDiscoveryService(
    [
      new PersonalFoodProvider(privateFoods),
      unavailableProvider('usda-fdc'),
      unavailableProvider('open-food-facts'),
    ],
    { async isEnabled() { return false; } } as unknown as FoodSourcePreferenceStore,
  );
  const compatibilityFoods = new CompositeFoodRepository(
    privateFoods,
    discovery,
    new SqliteFoodReferenceRepository(db),
  );
  const fallbackSnapshot = await buildTodaySnapshot(new Date('2026-08-29T18:00:00.000Z'), {
    foods: compatibilityFoods,
    meals: new SqliteMealRepository(db),
    goals: new SqliteGoalRepository(db),
  });
  assert.equal(fallbackSnapshot.unavailableItems.length, 0);
  assert.equal(fallbackSnapshot.metrics.find((metric) => metric.code === 'energy-kcal')?.value, 702);

  const transferred: FoodCandidate[] = [];
  const result = await transferLegacyProviderFoodSnapshots(db, async (candidate) => {
    transferred.push(candidate);
  });

  assert.deepEqual(result, { snapshotsTransferred: 2, payloadsRewritten: 1 });
  assert.deepEqual(
    transferred.map((candidate) => ({
      sourceId: candidate.ref.sourceId,
      recordId: candidate.ref.recordId,
      foodId: candidate.food.id,
      servingFoodId: candidate.food.servings[0]?.foodId,
      license: candidate.provenance.license?.name,
    })),
    [
      {
        sourceId: 'open-food-facts',
        recordId: '3017620422003',
        foodId: offCanonical,
        servingFoodId: offCanonical,
        license: 'ODbL 1.0',
      },
      {
        sourceId: 'usda-fdc',
        recordId: '171077',
        foodId: usdaCanonical,
        servingFoodId: usdaCanonical,
        license: 'CC0 1.0',
      },
    ],
  );
  assert.deepEqual(await new SqliteFoodRepository(db).getById(personal.id), personal);
  assert.equal(await new SqliteFoodRepository(db).getById(usda.id), null);
  assert.equal(await new SqliteFoodRepository(db).getById(off.id), null);

  const migratedMeal = await new SqliteMealRepository(db).getById(meal.id);
  assert.deepEqual(migratedMeal?.items.map((item) => item.foodId), [
    personal.id,
    usdaCanonical,
    offCanonical,
  ]);
  assert.equal(migratedMeal?.items[0]?.foodRef, undefined);
  assert.deepEqual(migratedMeal?.items[1]?.foodRef, {
    sourceId: 'usda-fdc',
    recordId: '171077',
  });
  assert.deepEqual(migratedMeal?.items[2]?.foodRef, {
    sourceId: 'open-food-facts',
    recordId: '3017620422003',
  });
  node.close();
});
