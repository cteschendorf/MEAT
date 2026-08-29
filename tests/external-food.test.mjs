import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('external providers are cached separately from the USDA corpus', async () => {
  const migrations = await read('../src/data/sqlite/migrations.ts');
  assert.match(migrations, /external_food_cache/);
  assert.match(migrations, /PRIMARY KEY \(provider, cache_key\)/);
});

test('USDA key is supplied at runtime and not hard-coded', async () => {
  const source = await read('../src/data/food-data/external.ts');
  assert.match(source, /constructor\(private readonly apiKey: string\)/);
  assert.doesNotMatch(source, /DEMO_KEY/);
});

test('Open Food Facts uses an identifying User-Agent and provider-specific cache', async () => {
  const source = await read('../src/data/food-data/external.ts');
  assert.match(source, /User-Agent/);
  assert.match(source, /open-food-facts/);
});
