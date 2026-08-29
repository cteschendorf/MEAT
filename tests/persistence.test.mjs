import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('persistence uses explicit migrations and WAL', async () => {
  const migrations = await read('../src/data/sqlite/migrations.ts');
  assert.match(migrations, /schema_migrations/);
  assert.match(migrations, /PRAGMA journal_mode = WAL/);
  assert.match(migrations, /PRAGMA foreign_keys = ON/);
  assert.doesNotMatch(migrations, /DROP TABLE/i);
});

test('expo-sqlite is an explicit dependency', async () => {
  const pkg = JSON.parse(await read('../package.json'));
  assert.equal(pkg.dependencies['expo-sqlite'], '~57.0.2');
});
