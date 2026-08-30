import assert from 'node:assert/strict';
import test from 'node:test';

import { retryableSingleFlight } from '../src/data/sqlite/single-flight';

test('concurrent database initialization callers share exactly one attempt', async () => {
  let starts = 0;
  let release: ((value: string) => void) | undefined;
  const open = retryableSingleFlight(async () => {
    starts += 1;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });

  const first = open();
  const second = open();
  assert.equal(first, second);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(starts, 1);
  assert.ok(release);
  release('database');
  assert.equal(await first, 'database');
  assert.equal(await open(), 'database');
  assert.equal(starts, 1);
});

test('a failed shared initialization is cleared so a later call can retry', async () => {
  let starts = 0;
  const open = retryableSingleFlight(async () => {
    starts += 1;
    if (starts === 1) throw new Error('migration failed');
    return 'database';
  });

  await assert.rejects(Promise.all([open(), open()]), /migration failed/);
  assert.equal(starts, 1);
  assert.equal(await open(), 'database');
  assert.equal(starts, 2);
});
