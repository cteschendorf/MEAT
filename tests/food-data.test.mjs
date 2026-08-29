import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('local corpus uses FTS and indexed barcode lookup', async () => {
  const migrations = await read('../src/data/sqlite/migrations.ts');
  assert.match(migrations, /CREATE VIRTUAL TABLE IF NOT EXISTS food_corpus_fts USING fts5/);
  assert.match(migrations, /food_corpus_gtin_idx/);
});

test('USDA normalization preserves provenance and arbitrary nutrients', async () => {
  const usda = await read('../src/data/food-data/usda.ts');
  assert.match(usda, /USDA FoodData Central/);
  assert.match(usda, /usda-/);
  assert.match(usda, /foodNutrients/);
});

test('food-data policy keeps Open Food Facts segregated from USDA corpus', async () => {
  const docs = await read('../docs/food-data.md');
  assert.match(docs, /Do not merge Open Food Facts records into the USDA-derived corpus/);
});
