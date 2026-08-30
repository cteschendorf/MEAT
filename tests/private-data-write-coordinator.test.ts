import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, MediaAsset } from '../src/domain';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MediaId,
} from '../src/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  MediaRepository,
  PrivateDataRepository,
} from '../src/data/repositories/contracts';
import { MealComposerService } from '../src/services/meals/meal-composer';
import { PrivateDataLifecycleService } from '../src/services/privacy/private-data-lifecycle';
import {
  PrivateDataWriteCoordinator,
  PrivateDataWriteRejectedError,
} from '../src/services/privacy/private-data-write-coordinator';
import { addPersonalFoodToComposer } from '../src/ui/meal-composer-entry';
import { mealComposerSessions } from '../src/ui/meal-composer-session';

const createdAt = '2026-08-29T12:00:00.000Z' as ISODateTime;
const occurredAt = '2026-08-29T13:00:00.000Z' as ISODateTime;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ids() {
  let next = 0;
  return (prefix: string) => `${prefix}:${++next}`;
}

function personalFood(id = 'food:personal'): Food {
  const foodId = id as FoodId;
  return {
    id: foodId,
    kind: 'custom',
    name: 'Private food',
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [{
      id: `${id}:serving` as FoodServingId,
      foodId,
      label: '100 g',
      quantity: 1,
      unit: 'serving',
      gramWeight: 100,
    }],
    createdAt,
    updatedAt: createdAt,
  };
}

function photo(id = 'media:private'): MediaAsset {
  return {
    id: id as MediaId,
    kind: 'photo',
    storage: 'local',
    uri: `file:///private/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 100,
    height: 100,
    byteSize: 20,
    createdAt,
    updatedAt: createdAt,
  };
}

class MemoryFoods implements FoodRepository {
  readonly values = new Map<FoodId, Food>();
  saveOperation: ((food: Food) => Promise<void>) | null = null;

  async getById(id: FoodId) { return this.values.get(id) ?? null; }
  async save(food: Food) {
    if (this.saveOperation) await this.saveOperation(food);
    this.values.set(food.id, food);
  }
  async delete(id: FoodId) { this.values.delete(id); }
  async list(limit = 100) { return [...this.values.values()].slice(0, limit); }
}

class MemoryMeals implements MealRepository {
  readonly values = new Map<MealId, Meal>();
  saveCalls = 0;
  saveOperation: ((meal: Meal) => Promise<void>) | null = null;

  async getById(id: MealId) { return this.values.get(id) ?? null; }
  async save(meal: Meal) {
    this.saveCalls += 1;
    if (this.saveOperation) await this.saveOperation(meal);
    this.values.set(meal.id, meal);
  }
  async delete(id: MealId) { this.values.delete(id); }
  async listByDateRange(start: string, end: string) {
    return [...this.values.values()].filter((meal) => (
      meal.occurredAt >= start && meal.occurredAt < end
    ));
  }
  async listRecent(limit = 100) { return [...this.values.values()].slice(0, limit); }
}

class MemoryMedia implements MediaRepository {
  readonly values = new Map<MediaId, MediaAsset>();

  async getById(id: MediaId) { return this.values.get(id) ?? null; }
  async list(limit = 100) { return [...this.values.values()].slice(0, limit); }
  async listByIds(ids: readonly MediaId[]) {
    return ids.flatMap((id) => {
      const value = this.values.get(id);
      return value ? [value] : [];
    });
  }
  async listByMealId() { return []; }
  async listUnattachedBefore() { return []; }
  async save(asset: MediaAsset) { this.values.set(asset.id, asset); }
  async saveMany(assets: readonly MediaAsset[]) {
    for (const asset of assets) this.values.set(asset.id, asset);
  }
  async attachToMeal() {}
  async detachFromMeal() {}
  async delete(id: MediaId) { this.values.delete(id); }
  async deleteMany(ids: readonly MediaId[]) {
    for (const id of ids) this.values.delete(id);
  }
}

function lifecycle(options: {
  readonly coordinator: PrivateDataWriteCoordinator;
  readonly foods: MemoryFoods;
  readonly meals: MemoryMeals;
  readonly media: MemoryMedia;
  readonly deletePrivateData?: () => Promise<void>;
}): PrivateDataLifecycleService {
  const records: PrivateDataRepository = {
    exportJson: async () => '{}',
    deleteAllPrivateData: options.deletePrivateData ?? (async () => {
      options.foods.values.clear();
      options.meals.values.clear();
      options.media.values.clear();
    }),
  };
  return new PrivateDataLifecycleService(
    records,
    options.media,
    { async delete() {}, async deleteAll() {} },
    undefined,
    undefined,
    options.coordinator,
  );
}

function assertWriteRejection(reason: 'purge-in-progress' | 'stale-generation') {
  return (error: unknown) => (
    error instanceof PrivateDataWriteRejectedError && error.reason === reason
  );
}

test('write-first reset waits for the accepted writer, rejects later writes, and expires its draft', async () => {
  const coordinator = new PrivateDataWriteCoordinator();
  const foods = new MemoryFoods();
  const meals = new MemoryMeals();
  const media = new MemoryMedia();
  const events: string[] = [];
  const writeStarted = deferred();
  const releaseWrite = deferred();
  let firstWrite = true;
  foods.saveOperation = async () => {
    if (!firstWrite) return;
    firstWrite = false;
    events.push('write-started');
    writeStarted.resolve();
    await releaseWrite.promise;
    events.push('write-finished');
  };
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist() {} },
    ids(),
    media,
    undefined,
    coordinator,
  );
  const reset = lifecycle({ coordinator, foods, meals, media });
  const draft = composer.createDraft({ occurredAt }, createdAt);

  const acceptedWrite = composer.addFood(draft, personalFood(), {
    portion: { quantity: 1, gramWeight: 100 },
  });
  await writeStarted.promise;
  const purge = reset.deleteAll().then(() => { events.push('purge-finished'); });

  await assert.rejects(
    composer.addFood(draft, personalFood('food:late'), {
      portion: { quantity: 1, gramWeight: 50 },
    }),
    assertWriteRejection('purge-in-progress'),
  );
  assert.deepEqual(events, ['write-started']);

  releaseWrite.resolve();
  const staleDraft = await acceptedWrite;
  await purge;
  assert.deepEqual(events, ['write-started', 'write-finished', 'purge-finished']);
  assert.equal(foods.values.size, 0);

  await assert.rejects(
    composer.save(staleDraft, occurredAt),
    assertWriteRejection('stale-generation'),
  );
  assert.equal(meals.saveCalls, 0);
});

test('purge-first reset rejects promotion and stale confirmation', async () => {
  const coordinator = new PrivateDataWriteCoordinator();
  const foods = new MemoryFoods();
  const meals = new MemoryMeals();
  const media = new MemoryMedia();
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist() {} },
    ids(),
    media,
    undefined,
    coordinator,
  );
  let staleDraft = composer.createDraft({ occurredAt }, createdAt);
  staleDraft = await composer.addFood(staleDraft, personalFood(), {
    portion: { quantity: 1, gramWeight: 100 },
  });

  const purgeStarted = deferred();
  const releasePurge = deferred();
  const reset = lifecycle({
    coordinator,
    foods,
    meals,
    media,
    deletePrivateData: async () => {
      purgeStarted.resolve();
      await releasePurge.promise;
      foods.values.clear();
      meals.values.clear();
      media.values.clear();
    },
  });
  const purge = reset.deleteAll();
  await purgeStarted.promise;

  let prepared = false;
  await assert.rejects(
    composer.saveWithMedia(staleDraft, occurredAt, async () => {
      prepared = true;
      return [];
    }),
    assertWriteRejection('purge-in-progress'),
  );
  assert.equal(prepared, false);

  releasePurge.resolve();
  await purge;
  await assert.rejects(
    composer.saveWithMedia(staleDraft, occurredAt, async () => {
      prepared = true;
      return [];
    }),
    assertWriteRejection('stale-generation'),
  );
  assert.equal(prepared, false);

  let freshDraft = composer.createDraft({ occurredAt }, occurredAt);
  freshDraft = await composer.addFood(freshDraft, personalFood('food:fresh'), {
    portion: { quantity: 1, gramWeight: 75 },
  });
  const saved = await composer.saveWithMedia(freshDraft, occurredAt, async () => []);
  assert.equal(await meals.getById(saved.id), saved);
});

test('queued purge waits for failed confirmation media rollback before deleting every file', async () => {
  const coordinator = new PrivateDataWriteCoordinator();
  const foods = new MemoryFoods();
  const meals = new MemoryMeals();
  const media = new MemoryMedia();
  const events: string[] = [];
  const durableFiles = new Set<string>();
  const draftFiles = new Set<string>();
  const rollbackStarted = deferred();
  const releaseRollback = deferred();
  meals.saveOperation = async () => { throw new Error('meal database failed'); };
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist() {} },
    ids(),
    media,
    undefined,
    coordinator,
  );
  const asset = photo();
  let draft = composer.createDraft({ occurredAt, mediaIds: [asset.id] }, createdAt);
  draft = await composer.addFood(draft, personalFood(), {
    portion: { quantity: 1, gramWeight: 100 },
  });
  const confirmation = composer.saveWithMedia(
    draft,
    occurredAt,
    async () => {
      events.push('promotion');
      durableFiles.add(asset.uri);
      return [asset];
    },
    async (assets) => {
      events.push('rollback-started');
      rollbackStarted.resolve();
      await releaseRollback.promise;
      await media.deleteMany(assets.map((value) => value.id));
      durableFiles.delete(asset.uri);
      draftFiles.add(asset.uri);
      events.push('rollback-finished');
    },
  );
  await rollbackStarted.promise;

  const reset = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => {
        events.push('purge-database');
        foods.values.clear();
        meals.values.clear();
        media.values.clear();
      },
    },
    media,
    {
      async delete() {},
      async deleteAll() {
        events.push('purge-files');
        durableFiles.clear();
        draftFiles.clear();
      },
    },
    undefined,
    undefined,
    coordinator,
  );
  const purge = reset.deleteAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['promotion', 'rollback-started']);

  releaseRollback.resolve();
  await assert.rejects(confirmation, /meal database failed/);
  await purge;
  assert.deepEqual(events, [
    'promotion',
    'rollback-started',
    'rollback-finished',
    'purge-database',
    'purge-files',
  ]);
  assert.deepEqual([...durableFiles], []);
  assert.deepEqual([...draftFiles], []);
  assert.equal(media.values.size, 0);
});

test('purge waits for a photo-producing draft action and remains the final file operation', async () => {
  const coordinator = new PrivateDataWriteCoordinator();
  const foods = new MemoryFoods();
  const meals = new MemoryMeals();
  const media = new MemoryMedia();
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist() {} },
    ids(),
    media,
    undefined,
    coordinator,
  );
  const draft = composer.createDraft({ occurredAt }, createdAt);
  const stageStarted = deferred();
  const releaseStage = deferred();
  const files = new Set<string>();
  const events: string[] = [];
  const staging = composer.runDraftWrite(draft, async () => {
    files.add('file:///draft/new.jpg');
    events.push('stage-started');
    stageStarted.resolve();
    await releaseStage.promise;
    events.push('stage-finished');
  });
  await stageStarted.promise;
  const reset = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => { events.push('purge-database'); },
    },
    media,
    {
      async delete() {},
      async deleteAll() {
        events.push('purge-files');
        files.clear();
      },
    },
    undefined,
    undefined,
    coordinator,
  );
  const purge = reset.deleteAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['stage-started']);

  releaseStage.resolve();
  await staging;
  await purge;
  assert.deepEqual(events, [
    'stage-started',
    'stage-finished',
    'purge-database',
    'purge-files',
  ]);
  assert.deepEqual([...files], []);
});

test('purge completion prevents an awaited utility add from republishing its stale session', async () => {
  const coordinator = new PrivateDataWriteCoordinator();
  const foods = new MemoryFoods();
  const meals = new MemoryMeals();
  const media = new MemoryMedia();
  const writeStarted = deferred();
  const releaseWrite = deferred();
  foods.saveOperation = async () => {
    writeStarted.resolve();
    await releaseWrite.promise;
  };
  const composer = new MealComposerService(
    foods,
    meals,
    { async persist() {} },
    ids(),
    media,
    undefined,
    coordinator,
  );
  const expectedMealId = 'meal:1' as MealId;
  mealComposerSessions.clearAll();
  const add = addPersonalFoodToComposer(
    { mealComposer: composer },
    undefined,
    personalFood(),
    100,
    occurredAt,
  );
  await writeStarted.promise;
  const reset = new PrivateDataLifecycleService(
    {
      exportJson: async () => '{}',
      deleteAllPrivateData: async () => {
        foods.values.clear();
        meals.values.clear();
        media.values.clear();
      },
    },
    media,
    { async delete() {}, async deleteAll() {} },
    undefined,
    mealComposerSessions,
    coordinator,
  );
  const purge = reset.deleteAll();
  releaseWrite.resolve();
  await purge;

  await assert.rejects(add, PrivateDataWriteRejectedError);
  assert.equal(mealComposerSessions.get(expectedMealId), null);
  mealComposerSessions.clearAll();
});
