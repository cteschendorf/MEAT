import assert from 'node:assert/strict';
import test from 'node:test';

import type { ISODateTime } from '../src/domain/shared/ids';
import { JOURNAL_PAGE_SIZE, nextJournalLimit } from '../src/ui/journal-pagination';
import { remainingUndoSeconds } from '../src/ui/meal-deletion-presentation';

test('journal loads meal history in accessible batches of exactly 100 events', () => {
  assert.equal(JOURNAL_PAGE_SIZE, 100);
  assert.equal(nextJournalLimit(JOURNAL_PAGE_SIZE), 200);
  assert.equal(nextJournalLimit(200), 300);
  assert.throws(() => nextJournalLimit(99), /at least 100/);
});

test('undo countdown is clamped and includes the partial final second', () => {
  const expiresAt = '2026-08-29T12:00:10.000Z' as ISODateTime;
  assert.equal(remainingUndoSeconds(expiresAt, Date.parse('2026-08-29T12:00:00.000Z')), 10);
  assert.equal(remainingUndoSeconds(expiresAt, Date.parse('2026-08-29T12:00:09.500Z')), 1);
  assert.equal(remainingUndoSeconds(expiresAt, Date.parse('2026-08-29T12:00:10.000Z')), 0);
  assert.equal(remainingUndoSeconds(expiresAt, Date.parse('2026-08-29T12:00:11.000Z')), 0);
});
