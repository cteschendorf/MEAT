import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import type { SQLiteDatabase } from 'expo-sqlite';

import { latestMigrationVersion, migrateDatabase } from '../src/data/sqlite/migrations';

import type { ComposerDraftRecord, ComposerDraftRepository } from '../src/data/repositories/contracts';
import type { ISODateTime, MealId } from '../src/domain/shared/ids';
import type { MealDraft } from '../src/services/meals/meal-composer';
import {
  MealComposerSessionStore,
  type MealComposerSession,
} from '../src/ui/meal-composer-session';

class InMemoryDraftRepository implements ComposerDraftRepository {
  readonly rows = new Map<string, ComposerDraftRecord>();
  failNextSave = false;

  async list(): Promise<readonly ComposerDraftRecord[]> {
    return [...this.rows.values()];
  }

  async save(record: ComposerDraftRecord): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error('disk full');
    }
    this.rows.set(record.id, record);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async deleteAll(): Promise<void> {
    this.rows.clear();
  }
}

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

const draftId = 'meal:draft-1' as MealId;

function session(overrides: Partial<MealDraft> = {}): MealComposerSession {
  const draft: MealDraft = {
    id: draftId,
    createdAt: '2026-08-31T12:00:00.000Z' as ISODateTime,
    context: { occurredAt: '2026-08-31T12:00:00.000Z' as ISODateTime, title: 'Thanksgiving' },
    items: [],
    ...overrides,
  };
  return { draft, existingMedia: [], stagedPhotos: [] };
}

test('an in-progress draft survives a restart', async () => {
  const repository = new InMemoryDraftRepository();
  const first = new MealComposerSessionStore();
  await first.attach(repository);

  first.put(session());
  await first.flush();

  // The process dies: a brand new store, same durable rows.
  const restarted = new MealComposerSessionStore();
  await restarted.attach(repository);

  const restored = restarted.get(draftId);
  assert.ok(restored, 'the draft should be restored after a restart');
  assert.equal(restored.draft.context.title, 'Thanksgiving');
});

test('saving or cancelling a draft clears it from storage', async () => {
  const repository = new InMemoryDraftRepository();
  const store = new MealComposerSessionStore();
  await store.attach(repository);

  store.put(session());
  await store.flush();
  assert.equal(repository.rows.size, 1);

  store.clear(draftId);
  await store.flush();
  assert.equal(repository.rows.size, 0, 'a cleared draft must not come back on restart');

  const restarted = new MealComposerSessionStore();
  await restarted.attach(repository);
  assert.equal(restarted.get(draftId), null);
});

test('a private-data purge erases every stored draft', async () => {
  const repository = new InMemoryDraftRepository();
  const store = new MealComposerSessionStore();
  await store.attach(repository);

  store.put(session());
  await store.flush();

  store.clearAll();
  await store.flush();
  assert.equal(repository.rows.size, 0);
});

test('writes are ordered so a delete cannot be overtaken by an earlier save', async () => {
  const repository = new InMemoryDraftRepository();
  const store = new MealComposerSessionStore();
  await store.attach(repository);

  store.put(session());
  store.clear(draftId);
  await store.flush();

  assert.equal(repository.rows.size, 0, 'the delete must win, whatever the scheduling');
});

test('a storage failure is reported without breaking the open composer', async () => {
  const repository = new InMemoryDraftRepository();
  const store = new MealComposerSessionStore();
  await store.attach(repository);

  const errors: unknown[] = [];
  store.onPersistenceError = (error) => errors.push(error);
  repository.failNextSave = true;

  store.put(session());
  await store.flush();

  assert.equal(errors.length, 1, 'the failure should surface');
  assert.ok(store.get(draftId), 'the draft the user is editing stays usable in memory');
});

test('an unreadable stored draft is discarded rather than resurrected', async () => {
  const repository = new InMemoryDraftRepository();
  repository.rows.set('meal:corrupt', {
    id: 'meal:corrupt',
    payload: '{not json',
    updatedAt: '2026-08-31T12:00:00.000Z',
  });

  const store = new MealComposerSessionStore();
  await store.attach(repository);
  await store.flush();

  assert.equal(store.get('meal:corrupt' as MealId), null);
  assert.equal(repository.rows.size, 0, 'the unusable row is cleaned up');
});

test('a draft already open in memory is not overwritten by an older snapshot', async () => {
  const repository = new InMemoryDraftRepository();
  const store = new MealComposerSessionStore();

  // Newer, unsaved edit already in memory.
  store.put(session({ context: { occurredAt: '2026-08-31T12:00:00.000Z' as ISODateTime, title: 'Newer' } }));

  repository.rows.set(draftId, {
    id: draftId,
    payload: JSON.stringify({ version: 1, session: session() }),
    updatedAt: '2026-08-30T12:00:00.000Z',
  });

  await store.attach(repository);
  assert.equal(store.get(draftId)?.draft.context.title, 'Newer');
});

test('draft persistence ships as migration 12', async () => {
  // A canary: adding a migration should be a deliberate act. If this fails,
  // confirm the new migration is intended and bump the expectation.
  assert.equal(latestMigrationVersion, 12);

  const node = new DatabaseSync(':memory:');
  const db = expoDatabase(node);
  await migrateDatabase(db);

  const columns = (node.prepare('PRAGMA table_info(composer_drafts)').all() as { name: string }[])
    .map((column) => column.name)
    .sort();
  assert.deepEqual(columns, ['id', 'payload', 'updated_at']);
  node.close();
});
