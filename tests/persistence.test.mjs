import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('expo-sqlite is an explicit dependency', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.equal(pkg.dependencies['expo-sqlite'], '~57.0.2');
});
