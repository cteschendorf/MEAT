import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { localDayRange } from '../src/services/today/snapshot';

const previousTimeZone = process.env.TZ;
process.env.TZ = 'America/Chicago';

after(() => {
  if (previousTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimeZone;
});

test('local day boundaries span the 23-hour spring DST day without losing either edge', () => {
  const range = localDayRange(new Date(2026, 2, 8, 12, 0, 0));
  assert.deepEqual(range, {
    start: '2026-03-08T06:00:00.000Z',
    end: '2026-03-09T05:00:00.000Z',
    dateKey: '2026-03-08',
  });
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 23 * 60 * 60 * 1_000);
});

test('local day boundaries span both repeated hours on the 25-hour fall DST day', () => {
  const range = localDayRange(new Date(2026, 10, 1, 12, 0, 0));
  assert.deepEqual(range, {
    start: '2026-11-01T05:00:00.000Z',
    end: '2026-11-02T06:00:00.000Z',
    dateKey: '2026-11-01',
  });
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 25 * 60 * 60 * 1_000);
});
