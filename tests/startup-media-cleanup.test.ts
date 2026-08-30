import assert from 'node:assert/strict';
import test from 'node:test';

import type { Meal, MediaAsset } from '../src/domain';
import type { MealRepository, MediaRepository } from '../src/data/repositories/contracts';
import type { ISODateTime, MealId, MediaId } from '../src/domain/shared/ids';
import { MealHistoryService } from '../src/services/meals/meal-history';

const createdAt = '2026-08-29T12:00:00.000Z' as ISODateTime;

function asset(id: string): MediaAsset {
  return {
    id: id as MediaId,
    kind: 'photo',
    storage: 'local',
    uri: `file:///private/${id}.jpg`,
    mimeType: 'image/jpeg',
    width: 1200,
    height: 900,
    byteSize: 10_000,
    createdAt,
    updatedAt: createdAt,
  };
}

test('a fresh app session immediately finalizes media left unattached by an interrupted Undo', async () => {
  const value = asset('photo:interrupted-undo');
  const values = new Map<MediaId, MediaAsset>([[value.id, value]]);
  const deletedFiles: string[] = [];
  const media = {
    async listUnattachedBefore(cutoff: ISODateTime) {
      return [...values.values()].filter((entry) => entry.createdAt < cutoff);
    },
    async deleteMany(ids: readonly MediaId[]) {
      ids.forEach((id) => values.delete(id));
    },
  } as unknown as MediaRepository;
  const meals = {
    async getById() { return null; },
    async save(_meal: Meal) {},
    async delete(_id: MealId) {},
    async listByDateRange() { return []; },
    async listRecent() { return []; },
  } satisfies MealRepository;
  // A new service instance intentionally has no in-memory Undo token. The
  // detached row is therefore no longer recoverable and must not linger.
  const restartedHistory = new MealHistoryService(
    meals,
    media,
    () => 'unused',
    { async delete(uri) { deletedFiles.push(uri); } },
  );

  assert.equal(await restartedHistory.cleanupUnattached(
    '2026-08-29T12:00:00.001Z' as ISODateTime,
    2_147_483_647,
  ), 1);
  assert.deepEqual([...values.values()], []);
  assert.deepEqual(deletedFiles, [value.uri]);
});
