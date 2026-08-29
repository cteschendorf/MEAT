import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { UsdaCoreFoodProvider, type UsdaCoreDatabase } from '../src/data/food-data/usda-core';
import type { SourceRecordId } from '../src/domain/shared/ids';

const databaseUrl = new URL('../assets/usda/meat-usda-core.sqlite', import.meta.url);
const manifestUrl = new URL('../assets/usda/manifest.json', import.meta.url);

interface CorpusManifest {
  readonly schema_version: number;
  readonly excluded_datasets: readonly string[];
  readonly record_counts: {
    readonly foods: number;
    readonly fts_rows: number;
    readonly nutrient_values: number;
    readonly portions: number;
  };
  readonly record_counts_by_dataset: Readonly<Record<string, number>>;
  readonly sqlite: { readonly bytes: number; readonly sha256: string };
}

function providerDatabase(database: DatabaseSync): UsdaCoreDatabase {
  return {
    async getAllAsync<T>(sql: string, ...params: (string | number)[]) {
      return database.prepare(sql).all(...params) as T[];
    },
  };
}

test('bundled USDA manifest matches the immutable database and all pinned datasets are populated', async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, 'utf8')) as CorpusManifest;
  const bytes = await readFile(databaseUrl);

  assert.equal(manifest.schema_version, 1);
  assert.deepEqual(manifest.excluded_datasets, ['Branded']);
  assert.equal(bytes.byteLength, manifest.sqlite.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sqlite.sha256);
  assert.ok(manifest.record_counts.foods > 0);
  assert.equal(manifest.record_counts.fts_rows, manifest.record_counts.foods);
  assert.ok(manifest.record_counts.nutrient_values > manifest.record_counts.foods);
  assert.ok(manifest.record_counts.portions > manifest.record_counts.foods);
  for (const dataset of ['foundation', 'fndds-2021-2023', 'sr-legacy']) {
    assert.ok((manifest.record_counts_by_dataset[dataset] ?? 0) > 0, `${dataset} must be nonempty`);
  }
});

test('USDA Core FTS returns provider-scoped foods with real nutrients, portions, and provenance', async () => {
  const database = new DatabaseSync(databaseUrl.pathname, { readOnly: true });
  const provider = new UsdaCoreFoodProvider(providerDatabase(database));

  const group = await provider.search('chicken breast', { limit: 12 });

  assert.equal(group.sourceId, 'usda-core');
  assert.equal(group.state, 'ready');
  assert.ok(group.candidates.length > 0);
  const candidate = group.candidates[0];
  assert.ok(candidate);
  assert.equal(candidate.ref.sourceId, 'usda-core');
  assert.match(candidate.food.id, /^usda-core:/);
  assert.match(candidate.food.name.toLocaleLowerCase(), /chicken/);
  assert.equal(candidate.food.nutrition.basisGrams, 100);
  assert.equal(candidate.food.nutrition.nutrients.length, 5);
  assert.ok(candidate.food.nutrition.nutrients.some((nutrient) => nutrient.state === 'known'));
  assert.ok(candidate.portions.every((portion) => (portion.gramWeight ?? 0) > 0));
  assert.ok(candidate.provenance.dataset);
  assert.ok(candidate.provenance.release);
  assert.match(candidate.provenance.recordUrl ?? '', /fdc\.nal\.usda\.gov/);

  const loaded = await provider.getById({
    sourceId: 'usda-core',
    recordId: candidate.ref.recordId as SourceRecordId,
  });
  assert.deepEqual(loaded.candidate, candidate);
  database.close();
});

test('USDA Core phrase terms are escaped and no branded rows exist', async () => {
  const database = new DatabaseSync(databaseUrl.pathname, { readOnly: true });
  const provider = new UsdaCoreFoodProvider(providerDatabase(database));

  const escaped = await provider.search('"milk"');
  assert.ok(['ready', 'empty'].includes(escaped.state));
  const branded = database
    .prepare("SELECT COUNT(*) AS count FROM foods WHERE lower(data_type) = 'branded'")
    .get() as { count: number };
  assert.equal(branded.count, 0);
  database.close();
});
