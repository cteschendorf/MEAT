import assert from 'node:assert/strict';
import test from 'node:test';

import { DeferredRouteExit } from '../src/ui/navigation/deferred-route-exit';

test('a deferred route exit waits for its mutation guard and runs exactly once', () => {
  const exit = new DeferredRouteExit();
  let calls = 0;

  assert.equal(exit.queue(() => { calls += 1; }), true);
  assert.equal(exit.hasPending, true);
  assert.equal(exit.flush(true), false);
  assert.equal(calls, 0);

  assert.equal(exit.flush(false), true);
  assert.equal(exit.hasPending, false);
  assert.equal(calls, 1);
  assert.equal(exit.flush(false), false);
  assert.equal(calls, 1);
});

test('a deferred route exit rejects a second completion and can be cleared on unmount', () => {
  const exit = new DeferredRouteExit();
  let destination = '';

  assert.equal(exit.queue(() => { destination = 'composer'; }), true);
  assert.equal(exit.queue(() => { destination = 'today'; }), false);
  exit.clear();
  assert.equal(exit.flush(false), false);
  assert.equal(destination, '');
});
