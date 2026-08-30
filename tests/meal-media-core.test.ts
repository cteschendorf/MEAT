import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, FoodCandidate, Meal, MediaAsset } from '../src/domain';
import {
  MEAL_CAPTION_MAX_LENGTH,
  MEAL_LOCATION_MAX_LENGTH,
  MEAL_TITLE_MAX_LENGTH,
  normalizeMealContextInput,
} from '../src/domain/meals/meal';
import { foodIdForRef } from '../src/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  MediaId,
  SourceRecordId,
} from '../src/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  MediaRepository,
} from '../src/data/repositories/contracts';
import { latestMigrationVersion, migrateDatabase } from '../src/data/sqlite/migrations';
import {
  SqliteMealRepository,
  SqliteMediaRepository,
  SqlitePrivateDataRepository,
} from '../src/data/sqlite/repositories';
import { MealComposerService } from '../src/services/meals/meal-composer';
import {
  LastMealItemRemovalRequiresConfirmationError,
  MealDeletionExpiredError,
  MealHistoryService,
} from '../src/services/meals/meal-history';
import { PrivateDataLifecycleService } from '../src/services/privacy/private-data-lifecycle';
import { buildTodaySnapshot } from '../src/services/today/snapshot';
import { MealComposerSessionStore } from '../src/ui/meal-composer-session';

const createdAt = '2026-08-29T12:00:00.000Z' as ISODateTime;
const later = '2026-08-29T13:00:00.000Z' as ISODateTime;
const tomorrow = '2026-08-30T08:30:00.000Z' as ISODateTime;

function expoDatabase(node: DatabaseSync): SQLiteDatabase {
  const adapter = {
    async execAsync(sql: string) { node.exec(sql); },
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

function transactionRunner(db: SQLiteDatabase) {
  return {
    async run<T>(operation: () => Promise<T>): Promise<T> {
      let result: T | undefined;
      await db.withTransactionAsync(async () => { result = await operation(); });
      if (result === undefined) throw new Error('Transaction returned no result.');
      return result;
    },
  };
}

function makeIds() {
  let sequence = 0;
  return (prefix: string) => `${prefix}:${++sequence}`;
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function candidate(recordId: string): FoodCandidate {
  const ref = { sourceId: 'usda-fdc' as const, recordId: recordId as SourceRecordId };
  const id = foodIdForRef(ref);
  const servingId = `${id}:serving` as FoodServingId;
  const food: Food = {
    id,
    kind: 'generic',
    name: `Food ${recordId}`,
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [{
      id: servingId,
      foodId: id,
      label: '100 g',
      quantity: 1,
      unit: 'serving',
      gramWeight: 100,
    }],
    createdAt,
    updatedAt: createdAt,
  };
  return {
    ref,
    food,
    portions: [{ id: servingId, label: '100 g', quantity: 1, unit: 'serving', gramWeight: 100 }],
    provenance: { provider: 'usda-fdc', recordId: recordId as SourceRecordId },
  };
}

function mediaAsset(id: string, timestamp = createdAt): MediaAsset {
  return {
    id: id as MediaId,
    kind: 'photo',
    storage: 'local',
    uri: `file:///private/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 1600,
    height: 1200,
    byteSize: 42_000,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

class MemoryFoodRepository implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  constructor(private readonly events: string[] = []) {}
  async getById(id: FoodId) { return this.values.get(id) ?? null; }
  async save(food: Food) { this.events.push(`food:${food.id}`); this.values.set(food.id, food); }
  async delete(id: FoodId) { this.values.delete(id); }
  async list(limit = 100) { return [...this.values.values()].slice(0, limit); }
}

class MemoryMealRepository implements MealRepository {
  readonly values = new Map<MealId, Meal>();
  saveCalls = 0;
  saveBarrier: Promise<void> | null = null;
  constructor(private readonly events: string[] = []) {}
  async getById(id: MealId) { return this.values.get(id) ?? null; }
  async save(meal: Meal) {
    this.saveCalls += 1;
    this.events.push(`meal:${meal.id}`);
    if (this.saveBarrier) await this.saveBarrier;
    this.values.set(meal.id, meal);
  }
  async delete(id: MealId) { this.values.delete(id); }
  async listByDateRange(start: string, end: string) {
    return [...this.values.values()].filter((meal) => meal.occurredAt >= start && meal.occurredAt < end);
  }
  async listRecent(limit = 250) { return [...this.values.values()].slice(0, limit); }
}

class MemoryMediaRepository implements MediaRepository {
  readonly values = new Map<MediaId, MediaAsset>();
  readonly owners = new Map<MediaId, MealId>();
  async getById(id: MediaId) { return this.values.get(id) ?? null; }
  async list(limit = 1_000) { return [...this.values.values()].slice(0, limit); }
  async listByIds(ids: readonly MediaId[]) {
    return ids.flatMap((id) => this.values.get(id) ? [this.values.get(id)!] : []);
  }
  async listByMealId(mealId: MealId) {
    return [...this.values.values()].filter((asset) => this.owners.get(asset.id) === mealId);
  }
  async listUnattachedBefore(cutoff: ISODateTime, limit = 100) {
    return [...this.values.values()]
      .filter((asset) => !this.owners.has(asset.id) && asset.createdAt < cutoff)
      .slice(0, limit);
  }
  async save(asset: MediaAsset) { this.values.set(asset.id, asset); }
  async saveMany(assets: readonly MediaAsset[]) { for (const asset of assets) await this.save(asset); }
  async attachToMeal(ids: readonly MediaId[], mealId: MealId) {
    for (const id of ids) {
      if (!this.values.has(id)) throw new Error(`missing ${id}`);
      const owner = this.owners.get(id);
      if (owner && owner !== mealId) throw new Error(`owned ${id}`);
      this.owners.set(id, mealId);
    }
  }
  async detachFromMeal(ids: readonly MediaId[], mealId: MealId) {
    for (const id of ids) if (this.owners.get(id) === mealId) this.owners.delete(id);
  }
  async delete(id: MediaId) { this.owners.delete(id); this.values.delete(id); }
  async deleteMany(ids: readonly MediaId[]) { for (const id of ids) await this.delete(id); }
}

function meal(
  id: string,
  occurredAt: ISODateTime,
  itemIds: readonly string[] = ['item:1'],
  mediaIds: readonly MediaId[] = [],
  created = createdAt,
): Meal {
  return {
    id: id as MealId,
    occurredAt,
    items: itemIds.map((itemId, index) => ({
      id: itemId as MealItemId,
      foodId: `food:${index}` as FoodId,
      portion: { quantity: 1, gramWeight: 100 },
    })),
    mediaIds,
    createdAt: created,
    updatedAt: created,
  };
}

test('meal context trims optional values, removes blanks, and enforces privacy-facing limits', () => {
  assert.deepEqual(normalizeMealContextInput({
    occurredAt: createdAt,
    title: '  Breakfast  ',
    caption: '   ',
    location: { label: '  Gym cafe  ' },
    mediaIds: [],
  }), {
    occurredAt: createdAt,
    title: 'Breakfast',
    location: { label: 'Gym cafe' },
  });
  assert.throws(
    () => normalizeMealContextInput({ occurredAt: createdAt, title: 'x'.repeat(MEAL_TITLE_MAX_LENGTH + 1) }),
    /80 characters or fewer/,
  );
  assert.throws(
    () => normalizeMealContextInput({
      occurredAt: createdAt,
      location: { label: 'x'.repeat(MEAL_LOCATION_MAX_LENGTH + 1) },
    }),
    /120 characters or fewer/,
  );
  assert.throws(
    () => normalizeMealContextInput({ occurredAt: createdAt, caption: 'x'.repeat(MEAL_CAPTION_MAX_LENGTH + 1) }),
    /500 characters or fewer/,
  );
  assert.throws(
    () => normalizeMealContextInput({
      occurredAt: createdAt,
      mediaIds: ['photo:1', 'photo:1'] as MediaId[],
    }),
    /same photo more than once/,
  );
  assert.throws(
    () => normalizeMealContextInput({
      occurredAt: createdAt,
      mediaIds: Array.from({ length: 6 }, (_, index) => `photo:${index}` as MediaId),
    }),
    /up to 5 photos/,
  );
});

test('composer retains each provider candidate before adding it and writes one atomic multi-food meal', async () => {
  const events: string[] = [];
  const foods = new MemoryFoodRepository(events);
  const meals = new MemoryMealRepository(events);
  const service = new MealComposerService(
    foods,
    meals,
    { async persist(value) { events.push(`provider:${value.ref.recordId}`); } },
    makeIds(),
  );
  let draft = service.createDraft({ occurredAt: later, title: '  Lunch ', location: { label: ' Gym ' } }, createdAt);
  draft = await service.addCandidate(draft, candidate('10'), { portion: { quantity: 1, gramWeight: 120 } });
  draft = await service.addCandidate(draft, candidate('20'), { portion: { quantity: 0.5, gramWeight: 80 } });
  const saved = await service.save(draft, later);

  assert.deepEqual(events, [
    'provider:10', 'food:usda-fdc:10',
    'provider:20', 'food:usda-fdc:20',
    `meal:${saved.id}`,
  ]);
  assert.equal(meals.saveCalls, 1);
  assert.equal(saved.items.length, 2);
  assert.deepEqual(saved.items.map((item) => item.foodRef?.recordId), ['10', '20']);
  assert.equal(saved.title, 'Lunch');
  assert.deepEqual(saved.location, { label: 'Gym' });
});

test('composer coalesces simultaneous confirmation taps into one meal write', async () => {
  const foods = new MemoryFoodRepository();
  const meals = new MemoryMealRepository();
  let release: (() => void) | undefined;
  meals.saveBarrier = new Promise<void>((resolve) => { release = resolve; });
  const service = new MealComposerService(foods, meals, { async persist() {} }, makeIds());
  let draft = service.createDraft({ occurredAt: later }, createdAt);
  draft = await service.addCandidate(draft, candidate('30'), { portion: { quantity: 1, gramWeight: 100 } });

  const first = service.save(draft, later);
  const second = service.save(draft, later);
  assert.equal(first, second);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(meals.saveCalls, 1);
  release?.();
  assert.equal((await first).id, (await second).id);
});

test('editing preserves identity and creation time while moving an event across days', async () => {
  const foods = new MemoryFoodRepository();
  const meals = new MemoryMealRepository();
  const existing = meal('meal:move', later);
  await meals.save(existing);
  const service = new MealComposerService(foods, meals, { async persist() {} }, makeIds());
  const draft = service.withContext(service.draftFromMeal(existing), {
    occurredAt: tomorrow,
    title: 'Dinner',
    caption: 'After training',
    location: { label: 'Home' },
  });
  const updated = await service.save(draft, tomorrow);

  assert.equal(updated.id, existing.id);
  assert.equal(updated.createdAt, existing.createdAt);
  assert.equal(updated.occurredAt, tomorrow);
  assert.equal(updated.caption, 'After training');
  assert.deepEqual(await meals.listByDateRange('2026-08-29', '2026-08-30'), []);
  assert.deepEqual(await meals.listByDateRange('2026-08-30', '2026-08-31'), [updated]);
});

test('location can be saved, edited, and cleared without changing nutrition, provider use, or ordering', async () => {
  const foods = new MemoryFoodRepository();
  const meals = new MemoryMealRepository();
  let providerWrites = 0;
  const service = new MealComposerService(
    foods,
    meals,
    { async persist() { providerWrites += 1; } },
    makeIds(),
  );
  const baseCandidate = candidate('location');
  const nutritionCandidate: FoodCandidate = {
    ...baseCandidate,
    food: {
      ...baseCandidate.food,
      nutrition: {
        basisGrams: 100,
        nutrients: [{
          nutrient: { code: 'energy-kcal', name: 'Calories', unit: 'kcal' },
          state: 'known',
          value: 240,
        }],
      },
    },
  };
  let draft = service.createDraft({ occurredAt: later }, createdAt);
  draft = await service.addCandidate(draft, nutritionCandidate, {
    portion: { quantity: 1, gramWeight: 50 },
  });
  const saved = await service.save(draft, later);
  const noGoals = { async save() {}, async listActive() { return []; } };
  const snapshot = () => buildTodaySnapshot(new Date(later), { foods, meals, goals: noGoals });
  const before = await snapshot();
  const orderBefore = (await meals.listRecent()).map((mealValue) => mealValue.id);

  const located = await service.save(service.withContext(service.draftFromMeal(saved), {
    occurredAt: later,
    location: { label: 'Gym cafe' },
  }), tomorrow);
  const afterSave = await snapshot();
  assert.deepEqual(located.location, { label: 'Gym cafe' });

  const edited = await service.save(service.withContext(service.draftFromMeal(located), {
    occurredAt: later,
    location: { label: 'Home kitchen' },
  }), tomorrow);
  const afterEdit = await snapshot();
  assert.deepEqual(edited.location, { label: 'Home kitchen' });

  const cleared = await service.save(service.withContext(service.draftFromMeal(edited), {
    occurredAt: later,
  }), tomorrow);
  const afterClear = await snapshot();
  assert.equal(cleared.location, undefined);

  const calories = (value: Awaited<ReturnType<typeof snapshot>>) =>
    value.metrics.find((metric) => metric.code === 'energy-kcal')?.value;
  assert.equal(calories(before), 120);
  assert.equal(calories(afterSave), calories(before));
  assert.equal(calories(afterEdit), calories(before));
  assert.equal(calories(afterClear), calories(before));
  assert.equal(providerWrites, 1);
  assert.deepEqual((await meals.listRecent()).map((mealValue) => mealValue.id), orderBefore);
  assert.equal(cleared.occurredAt, saved.occurredAt);
});

test('history ordering is stable and final-item removal requires confirmation with undo', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const equalTime = later;
  const first = meal('meal:b', equalTime, ['item:b'], [], '2026-08-29T11:00:00.000Z' as ISODateTime);
  const second = meal('meal:a', equalTime, ['item:a'], [], '2026-08-29T10:00:00.000Z' as ISODateTime);
  await meals.save(first);
  await meals.save(second);
  const history = new MealHistoryService(meals, media, makeIds());

  assert.deepEqual(
    (await history.listDay('2026-08-29T00:00:00.000Z' as ISODateTime, '2026-08-30T00:00:00.000Z' as ISODateTime))
      .map((value) => value.id),
    [second.id, first.id],
  );
  await assert.rejects(
    history.removeItem(first.id, first.items[0]!.id, later),
    LastMealItemRemovalRequiresConfirmationError,
  );
  const result = await history.removeItem(first.id, first.items[0]!.id, later, true);
  assert.equal(result.kind, 'pending-delete');
  if (result.kind !== 'pending-delete') return;
  assert.equal(await meals.getById(first.id), null);
  assert.deepEqual(await history.undoDelete(
    result.deletion.token,
    '2026-08-29T13:00:09.999Z' as ISODateTime,
  ), first);
  assert.deepEqual(await meals.getById(first.id), first);
});

test('history updates portions and removes one food without splitting the remaining event', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const value = meal('meal:multi', later, ['item:first', 'item:second']);
  await meals.save(value);
  const history = new MealHistoryService(meals, media, makeIds());

  const portioned = await history.updatePortion(
    value.id,
    value.items[0]!.id,
    { quantity: 0.25, gramWeight: 35.5 },
    tomorrow,
  );
  assert.deepEqual(portioned.items[0]?.portion, { quantity: 0.25, gramWeight: 35.5 });
  const result = await history.removeItem(value.id, value.items[1]!.id, tomorrow);
  assert.equal(result.kind, 'updated');
  if (result.kind !== 'updated') return;
  assert.equal(result.meal.id, value.id);
  assert.deepEqual(result.meal.items.map((item) => item.id), [value.items[0]!.id]);
  assert.equal((await meals.getById(value.id))?.items.length, 1);
});

test('expired deletion finalizes media and file cleanup while an in-window undo retains it', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const asset = mediaAsset('photo:delete');
  await media.save(asset);
  const value = meal('meal:delete', later, ['item:delete'], [asset.id]);
  await meals.save(value);
  await media.attachToMeal([asset.id], value.id);
  const deletedFiles: string[] = [];
  const history = new MealHistoryService(
    meals,
    media,
    () => 'deletion:1',
    { async delete(uri) { deletedFiles.push(uri); } },
  );
  const pending = await history.deleteWithUndo(value.id, later);

  assert.equal(await history.cleanupUnattached(tomorrow), 0);
  assert.deepEqual(await media.getById(asset.id), asset);

  await assert.rejects(
    history.undoDelete(pending.token, '2026-08-29T13:00:10.000Z' as ISODateTime),
    MealDeletionExpiredError,
  );
  assert.equal(await media.getById(asset.id), null);
  assert.deepEqual(deletedFiles, [asset.uri]);
  assert.equal(history.getPendingDeletion(pending.token), null);
});

test('an undo that claims a deletion first prevents concurrent finalization from deleting restored media', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const asset = mediaAsset('photo:undo-race');
  const value = meal('meal:undo-race', later, ['item:undo-race'], [asset.id]);
  await media.save(asset);
  await meals.save(value);
  await media.attachToMeal([asset.id], value.id);
  const deletedFiles: string[] = [];
  const history = new MealHistoryService(
    meals,
    media,
    () => 'deletion:undo-race',
    { async delete(uri) { deletedFiles.push(uri); } },
  );
  const pending = await history.deleteWithUndo(value.id, later);

  const releaseRestore = deferred();
  meals.saveBarrier = releaseRestore.promise;
  const undo = history.undoDelete(
    pending.token,
    '2026-08-29T13:00:09.999Z' as ISODateTime,
  );
  while (meals.saveCalls < 2) await new Promise<void>((resolve) => setImmediate(resolve));

  const finalize = history.finalizeDelete(pending.token);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(deletedFiles, [], 'finalization must wait for the claimed undo');
  assert.deepEqual(await media.getById(asset.id), asset);

  releaseRestore.resolve();
  assert.deepEqual(await undo, value);
  assert.equal(await finalize, false);
  assert.deepEqual(await media.getById(asset.id), asset);
  assert.equal((await media.listByMealId(value.id))[0]?.id, asset.id);
});

test('finalization that claims a deletion first makes a concurrent near-deadline undo expire', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const asset = mediaAsset('photo:finalize-race');
  const value = meal('meal:finalize-race', later, ['item:finalize-race'], [asset.id]);
  await media.save(asset);
  await meals.save(value);
  await media.attachToMeal([asset.id], value.id);
  const fileDeletionStarted = deferred();
  const releaseFileDeletion = deferred();
  const history = new MealHistoryService(
    meals,
    media,
    () => 'deletion:finalize-race',
    {
      async delete() {
        fileDeletionStarted.resolve();
        await releaseFileDeletion.promise;
      },
    },
  );
  const pending = await history.deleteWithUndo(value.id, later);

  const finalize = history.finalizeDelete(pending.token);
  await fileDeletionStarted.promise;
  const undo = history.undoDelete(
    pending.token,
    '2026-08-29T13:00:09.999Z' as ISODateTime,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(meals.saveCalls, 1, 'undo must wait rather than restore during finalization');

  releaseFileDeletion.resolve();
  assert.equal(await finalize, true);
  await assert.rejects(undo, MealDeletionExpiredError);
  assert.equal(await meals.getById(value.id), null);
  assert.equal(await media.getById(asset.id), null);
});

test('private-data purge waits for token ownership then invalidates pending undo and every composer session', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const asset = mediaAsset('photo:private-race');
  const value = meal('meal:private-race', later, ['item:private-race'], [asset.id]);
  await media.save(asset);
  await meals.save(value);
  await media.attachToMeal([asset.id], value.id);
  const history = new MealHistoryService(meals, media, () => 'deletion:private-race');
  const pending = await history.deleteWithUndo(value.id, later);
  const sessions = new MealComposerSessionStore();
  const sessionMealId = 'meal:draft-before-private-purge' as MealId;
  sessions.put({
    draft: {
      id: sessionMealId,
      createdAt,
      context: { occurredAt: later },
      items: [],
    },
    existingMedia: [],
    stagedPhotos: [],
  });

  const databaseStarted = deferred();
  const releaseDatabase = deferred();
  const filePurgeStarted = deferred();
  const releaseFilePurge = deferred();
  const lifecycle = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => {
        databaseStarted.resolve();
        await releaseDatabase.promise;
        meals.values.clear();
        media.values.clear();
        media.owners.clear();
      },
    },
    media,
    {
      async delete() {},
      async deleteAll() {
        filePurgeStarted.resolve();
        await releaseFilePurge.promise;
      },
    },
    history,
    sessions,
  );

  const purge = lifecycle.deleteAll();
  await databaseStarted.promise;
  const undo = history.undoDelete(
    pending.token,
    '2026-08-29T13:00:09.999Z' as ISODateTime,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(meals.saveCalls, 1, 'undo must wait for the private-data reset');

  releaseDatabase.resolve();
  await filePurgeStarted.promise;
  assert.notEqual(sessions.get(sessionMealId), null, 'sessions clear only after file purge finishes');
  assert.notEqual(history.getPendingDeletion(pending.token), null);
  releaseFilePurge.resolve();

  await purge;
  await assert.rejects(undo, MealDeletionExpiredError);
  assert.equal(history.getPendingDeletion(pending.token), null);
  assert.equal(sessions.get(sessionMealId), null);
  assert.equal(await meals.getById(value.id), null);
});

test('private-data failures preserve recoverability before commit and invalidate it after commit', async () => {
  const meals = new MemoryMealRepository();
  const media = new MemoryMediaRepository();
  const value = meal('meal:private-failure', later);
  await meals.save(value);
  const history = new MealHistoryService(meals, media, () => 'deletion:private-failure');
  const pending = await history.deleteWithUndo(value.id, later);
  const sessions = new MealComposerSessionStore();
  const sessionMealId = 'meal:draft-private-failure' as MealId;
  const session = {
    draft: { id: sessionMealId, createdAt, context: { occurredAt: later }, items: [] },
    existingMedia: [],
    stagedPhotos: [],
  };
  sessions.put(session);

  const databaseFailure = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => { throw new Error('database failed'); },
    },
    media,
    { async delete() {} },
    history,
    sessions,
  );
  await assert.rejects(databaseFailure.deleteAll(), /database failed/);
  assert.notEqual(history.getPendingDeletion(pending.token), null);
  assert.equal(sessions.get(sessionMealId), session);

  const fileFailure = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => {
        meals.values.clear();
        media.values.clear();
        media.owners.clear();
      },
    },
    media,
    {
      async delete() {},
      async deleteAll() { throw new Error('file purge failed'); },
    },
    history,
    sessions,
  );
  await assert.rejects(fileFailure.deleteAll(), /file purge failed/);
  assert.equal(history.getPendingDeletion(pending.token), null);
  assert.equal(sessions.get(sessionMealId), null);
  await assert.rejects(
    history.undoDelete(pending.token, '2026-08-29T13:00:09.999Z' as ISODateTime),
    MealDeletionExpiredError,
  );
});

test('migration 11 preserves build-1 meals and provides ordered, private media persistence', async () => {
  const node = new DatabaseSync(':memory:');
  const db = expoDatabase(node);
  await migrateDatabase(db);
  assert.equal(latestMigrationVersion, 11);
  node.exec('DELETE FROM schema_migrations WHERE version = 11; DROP TABLE media_assets;');
  const legacy = meal('meal:build-1', createdAt);
  node.prepare('INSERT INTO meals (id, occurred_at, payload, updated_at) VALUES (?, ?, ?, ?)')
    .run(legacy.id, legacy.occurredAt, JSON.stringify(legacy), legacy.updatedAt);

  await migrateDatabase(db);
  assert.deepEqual(await new SqliteMealRepository(db).getById(legacy.id), legacy);
  const columns = node.prepare('PRAGMA table_info(media_assets)').all() as { name: string }[];
  assert.deepEqual(
    columns.map((column) => column.name),
    ['id', 'meal_id', 'kind', 'storage', 'uri', 'mime_type', 'width', 'height', 'byte_size', 'created_at', 'updated_at'],
  );

  const media = new SqliteMediaRepository(db);
  const photoA = mediaAsset('photo:a');
  const photoB = mediaAsset('photo:b', later);
  await media.saveMany([photoA, photoB]);
  assert.deepEqual(await media.listByIds([photoB.id, photoA.id]), [photoB, photoA]);
  await media.attachToMeal([photoB.id, photoA.id], legacy.id, later);
  assert.deepEqual((await media.listByMealId(legacy.id)).map((asset) => asset.id), [photoA.id, photoB.id]);
  const other = meal('meal:other', later);
  await new SqliteMealRepository(db).save(other);
  await assert.rejects(media.attachToMeal([photoA.id], other.id, later), /belongs to another meal/);
  assert.deepEqual((await media.listByMealId(legacy.id)).map((asset) => asset.id), [photoA.id, photoB.id]);

  const exported = JSON.parse(await new SqlitePrivateDataRepository(db).exportJson()) as {
    mediaAssets: MediaAsset[];
  };
  assert.equal(exported.mediaAssets.length, 2);
  await new SqlitePrivateDataRepository(db).deleteAllPrivateData();
  assert.deepEqual(await media.listByIds([photoA.id, photoB.id]), []);
  node.close();
});

test('SQLite composer atomically rolls back new media and meal when attachment cannot commit', async () => {
  const node = new DatabaseSync(':memory:');
  const db = expoDatabase(node);
  await migrateDatabase(db);
  const meals = new SqliteMealRepository(db);
  const media = new SqliteMediaRepository(db);
  const service = new MealComposerService(
    new MemoryFoodRepository(),
    meals,
    { async persist() {} },
    makeIds(),
    media,
    transactionRunner(db),
  );
  const preparedAsset = mediaAsset('photo:prepared');
  let draft = service.createDraft({
    occurredAt: later,
    mediaIds: [preparedAsset.id, 'photo:missing' as MediaId],
  }, createdAt);
  draft = await service.addCandidate(draft, candidate('40'), { portion: { quantity: 1, gramWeight: 100 } });

  await assert.rejects(
    service.saveWithMedia(draft, later, async () => [preparedAsset]),
    /does not exist/,
  );
  assert.equal(await meals.getById(draft.id), null);
  assert.equal(await media.getById(preparedAsset.id), null);
  node.close();
});
