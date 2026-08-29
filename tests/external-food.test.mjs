import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('external cache is provider-segregated', async () => {
  const source = await read('../src/data/sqlite/migrations.ts');
  assert.match(source, /external_food_cache/);
  assert.match(source, /PRIMARY KEY\s*\(provider,\s*cache_key\)/);
});

test('USDA key is runtime-only', async () => {
  const source = await read('../src/data/food-data/external.ts');
  assert.match(source, /private readonly apiKey:\s*string/);
  assert.doesNotMatch(source, /DEMO_KEY/);
});

test('Open Food Facts identifies the app', async () => {
  const source = await read('../src/data/food-data/external.ts');
  assert.match(source, /User-Agent/);
  assert.match(source, /open-food-facts/);
});

test('food sources remain independently selectable', async () => {
  const migration = await read('../src/data/sqlite/migrations.ts');
  const resolver = await read('../src/data/food-data/external.ts');
  assert.match(migration, /food_source_preferences/);
  assert.match(migration, /open-food-facts/);
  assert.match(resolver, /resolveFoodSearchBySource/);
  assert.match(resolver, /sourcePreferences/);
});
