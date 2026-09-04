import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, FoodCandidate, FoodSearchGroup, NutrientValue } from '../src/domain/index';
import type { FoodId, FoodServingId, ISODateTime, SourceRecordId } from '../src/domain/shared/ids';
import {
  buildFoodResultTiers,
  defaultPortionFor,
  matchScore,
  metricsForPortion,
} from '../src/ui/food-search-results';

const at = '2026-08-31T12:00:00.000Z' as ISODateTime;

function nutrient(code: string, name: string, unit: string, value?: number): NutrientValue {
  const definition = { code, name, unit };
  return value === undefined
    ? { nutrient: definition, state: 'unknown' }
    : { nutrient: definition, state: 'known', value };
}

function food(id: string, name: string, per100g: Partial<Record<string, number>>, servingGrams?: number): Food {
  const servings = servingGrams
    ? [{
        id: `${id}:portion:1` as FoodServingId,
        foodId: id as FoodId,
        label: '1 medium breast',
        gramWeight: servingGrams,
        quantity: 1,
        unit: 'serving',
        isDefault: true,
      }]
    : [];
  return {
    id: id as FoodId,
    kind: 'generic',
    name,
    nutrition: {
      basisGrams: 100,
      nutrients: [
        nutrient('protein-g', 'Protein', 'g', per100g['protein-g']),
        nutrient('energy-kcal', 'Energy', 'kcal', per100g['energy-kcal']),
        nutrient('carbohydrate-g', 'Carbs', 'g', per100g['carbohydrate-g']),
        nutrient('fat-g', 'Fat', 'g', per100g['fat-g']),
        nutrient('fiber-g', 'Fiber', 'g', per100g['fiber-g']),
      ],
    },
    servings,
    createdAt: at,
    updatedAt: at,
  };
}

function candidate(sourceId: FoodCandidate['ref']['sourceId'], recordId: string, item: Food): FoodCandidate {
  return {
    ref: { sourceId, recordId: recordId as SourceRecordId },
    food: item,
    portions: item.servings.map((serving) => ({
      id: serving.id,
      label: serving.label,
      quantity: serving.quantity,
      unit: serving.unit,
      ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
      ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
    })),
    provenance: { provider: sourceId, recordId: recordId as SourceRecordId, retrievedAt: at },
  };
}

function ready(sourceId: FoodCandidate['ref']['sourceId'], candidates: FoodCandidate[]): FoodSearchGroup {
  return { sourceId, query: 'chicken', state: 'ready', candidates, freshness: 'fresh-cache' };
}

const breast = food('usda-core:1', 'Chicken breast, roasted', {
  'protein-g': 31, 'energy-kcal': 165, 'carbohydrate-g': 0, 'fat-g': 3.6, 'fiber-g': 0,
}, 140);

test('metrics render protein first and never turn unknown into zero', () => {
  // Fiber is genuinely absent here, which is the common case for branded records.
  const bar = food('open-food-facts:1', 'Protein bar', { 'protein-g': 20, 'energy-kcal': 200 });
  const metrics = metricsForPortion(bar, 100);

  assert.deepEqual(metrics.map((metric) => metric.code), [
    'protein-g', 'energy-kcal', 'carbohydrate-g', 'fat-g', 'fiber-g',
  ]);
  const [proteinMetric] = metrics;
  assert.equal(proteinMetric?.text, '20');
  assert.equal(proteinMetric?.label, 'P');
  const fiber = metrics.find((metric) => metric.code === 'fiber-g');
  assert.equal(fiber?.text, '—', 'missing fiber must not read as 0');
  assert.equal(fiber?.known, false);
});

test('metrics are scaled to the row portion, not left per 100 g', () => {
  const metrics = metricsForPortion(breast, 140);
  assert.equal(metrics.find((metric) => metric.code === 'protein-g')?.text, '43.4');
  assert.equal(metrics.find((metric) => metric.code === 'energy-kcal')?.text, '231');
});

test('the portion label leads with the household measure and keeps grams in parentheses', () => {
  assert.equal(defaultPortionFor(candidate('usda-core', '1', breast)).label, '1 medium breast (140 g)');
});

test('a food with no named serving falls back to a plain weight', () => {
  const plain = food('open-food-facts:2', 'Yogurt', { 'protein-g': 10 });
  const portion = defaultPortionFor(candidate('open-food-facts', '2', plain));
  assert.equal(portion.label, '100 g');
  assert.equal(portion.servingId, undefined);
});

test('results group by food category, not by database', () => {
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [
      ready('personal', [candidate('personal', 'p1', food('personal:1', 'My chicken tray bake', { 'protein-g': 12 }))]),
      ready('usda-core', [candidate('usda-core', '1', breast)]),
      ready('open-food-facts', [candidate('open-food-facts', '3', food('open-food-facts:3', 'Chicken strips', { 'protein-g': 22 }))]),
    ],
  });

  assert.deepEqual(tiers.map((tier) => tier.id), ['yours', 'common', 'branded']);
  assert.deepEqual(tiers.map((tier) => tier.title), ['Your foods', 'Common', 'Branded']);
  assert.ok(tiers.every((tier) => tier.rows.length === 1));
});

test('every row carries its own source, so nothing is silently merged', () => {
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [ready('open-food-facts', [candidate('open-food-facts', '3', food('open-food-facts:3', 'Chicken strips', { 'protein-g': 22 }))])],
  });
  assert.equal(tiers[0]?.rows[0]?.sourceLabel, 'Open Food Facts');
});

test('the same USDA record from two caches collapses to one row, preferring offline', () => {
  const online = food('usda-fdc:1', 'Chicken breast, roasted', { 'protein-g': 31 }, 140);
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [
      ready('usda-core', [candidate('usda-core', '1', breast)]),
      ready('usda-fdc', [candidate('usda-fdc', '1', online)]),
    ],
  });

  const common = tiers.find((tier) => tier.id === 'common');
  assert.equal(common?.rows.length, 1, 'one record should appear once');
  assert.equal(common?.rows[0]?.candidate.ref.sourceId, 'usda-core', 'the offline copy wins');
});

test('a USDA record and an Open Food Facts record are never collapsed together', () => {
  const off = food('open-food-facts:1', 'Chicken breast', { 'protein-g': 30 });
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [
      ready('usda-core', [candidate('usda-core', '1', breast)]),
      ready('open-food-facts', [candidate('open-food-facts', '1', off)]),
    ],
  });
  assert.equal(tiers.find((tier) => tier.id === 'common')?.rows.length, 1);
  assert.equal(tiers.find((tier) => tier.id === 'branded')?.rows.length, 1);
});

test('the matched query term is marked so the reason a row matched is visible', () => {
  const tiers = buildFoodResultTiers({ query: 'chicken', groups: [ready('usda-core', [candidate('usda-core', '1', breast)])] });
  const matched = (tiers[0]?.rows[0]?.nameSegments ?? []).filter((segment) => segment.matched);
  assert.deepEqual(matched.map((segment) => segment.text), ['Chicken']);
});

test('a disabled source contributes nothing and prints no card', () => {
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [ready('open-food-facts', [candidate('open-food-facts', '3', food('open-food-facts:3', 'Strips', { 'protein-g': 22 }))])],
    disabledSources: ['open-food-facts'],
  });
  assert.equal(tiers.length, 0, 'a source the user switched off should not occupy the screen');
});

test('an empty source is silent, but an unreachable one explains itself once', () => {
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [
      { sourceId: 'usda-core', query: 'chicken', state: 'empty', freshness: 'fresh-cache' },
      {
        sourceId: 'open-food-facts',
        query: 'chicken',
        state: 'offline',
        candidates: [],
        issue: { kind: 'offline', code: 'offline', message: 'No connection' },
      },
    ],
  });

  assert.equal(tiers.length, 1, 'the empty source produces no section at all');
  assert.deepEqual(tiers[0]?.notes, ['Open Food Facts is unavailable right now.']);
});

// ── Section ranking (1 Sep) ──
//
// Charles: "if the usda branded foods or open foods has the result with the
// highest or best match, can those results appear first? I'm not asking to mix
// results in together."
//
// So the SECTIONS are ranked and the rows stay inside them. `Your foods` is
// pinned above that contest: a food you created and kept is a decision you
// already made, and demoting your own library under a packaged good would be
// answering a question you did not ask.

function loadingGroup(sourceId: FoodCandidate['ref']['sourceId']): FoodSearchGroup {
  return { sourceId, query: 'red bull', state: 'loading' };
}

const redBull = food('open-food-facts:rb', 'Red Bull Sugar Free Energy Drink', {
  'protein-g': 0, 'energy-kcal': 13,
});
// Matches "red" and not "bull" — a real USDA generic, and the wrong answer.
const generic = food('usda-core:rb', 'Energy drink, red, canned', { 'protein-g': 0 });

test('the section holding the best match leads, and Branded is allowed to win', () => {
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('usda-core', [candidate('usda-core', 'rb', generic)]),
      ready('open-food-facts', [candidate('open-food-facts', 'rb', redBull)]),
    ],
  });

  assert.deepEqual(tiers.map((tier) => tier.id), ['branded', 'common'],
    'the exact product should not sit under a generic that matched half the query');
});

test('the rows themselves never leave their section', () => {
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('usda-core', [candidate('usda-core', 'rb', generic)]),
      ready('open-food-facts', [candidate('open-food-facts', 'rb', redBull)]),
    ],
  });

  // Ranking reorders headings. It must never interleave what is under them.
  for (const tier of tiers) {
    const sources = new Set(tier.rows.map((row) => row.sourceLabel));
    assert.equal(sources.size, 1, `${tier.id} mixed sources together`);
  }
  assert.equal(tiers.find((tier) => tier.id === 'branded')?.rows[0]?.sourceLabel, 'Open Food Facts');
  assert.equal(tiers.find((tier) => tier.id === 'common')?.rows[0]?.sourceLabel, 'USDA');
});

test('Your foods is pinned, even when something else matches better', () => {
  // A deliberately poor match in the user's own library, against a perfect one
  // in Branded. Pinning is the whole decision: they saved this on purpose.
  const mine = food('personal:1', 'Red pepper hummus', { 'protein-g': 8 });
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('personal', [candidate('personal', 'p1', mine)]),
      ready('open-food-facts', [candidate('open-food-facts', 'rb', redBull)]),
      ready('usda-core', [candidate('usda-core', 'rb', generic)]),
    ],
  });

  assert.equal(tiers[0]?.id, 'yours');
  assert.deepEqual(tiers.map((tier) => tier.id), ['yours', 'branded', 'common']);
});

test('a section that answers the whole query beats one that answers part of it brilliantly', () => {
  // "bull" alone, at the very front of the name, as good a single match as
  // exists — and still the wrong answer, because half the query is missing.
  const partial = food('usda-core:b', 'Bull, ground, raw', { 'protein-g': 26 });
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('usda-core', [candidate('usda-core', 'b', partial)]),
      ready('open-food-facts', [candidate('open-food-facts', 'rb', redBull)]),
    ],
  });
  assert.deepEqual(tiers.map((tier) => tier.id), ['branded', 'common']);
});

test('nothing to choose between them leaves the curated order alone', () => {
  // Both name the term once, at the front, as a whole word. This function
  // cannot honestly prefer one, so it does not: the declared order survives
  // and so does each provider's own ranking inside it.
  const tiers = buildFoodResultTiers({
    query: 'chicken',
    groups: [
      ready('usda-core', [candidate('usda-core', '1', breast)]),
      ready('open-food-facts', [
        candidate('open-food-facts', '3', food('open-food-facts:3', 'Chicken strips', { 'protein-g': 22 })),
      ]),
    ],
  });
  assert.deepEqual(tiers.map((tier) => tier.id), ['common', 'branded']);
});

test('rows inside a section are ordered by the same score the sections are', () => {
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('open-food-facts', [
        // Handed over in the wrong order on purpose.
        candidate('open-food-facts', 'x', food('open-food-facts:x', 'Red velvet cake', { 'protein-g': 4 })),
        candidate('open-food-facts', 'rb', redBull),
      ]),
    ],
  });
  const names = tiers[0]?.rows.map((row) => row.name) ?? [];
  assert.equal(names[0], 'Red Bull Sugar Free Energy Drink');
});

test('headings hold still while sources are still reporting', () => {
  // Results stream in one provider at a time. Re-ranking eagerly would move
  // the headings under the user's thumb once per source; holding the declared
  // order until the last one lands costs a single re-order at the end.
  const tiers = buildFoodResultTiers({
    query: 'red bull',
    groups: [
      ready('open-food-facts', [candidate('open-food-facts', 'rb', redBull)]),
      loadingGroup('usda-core'),
    ],
  });
  assert.deepEqual(tiers.map((tier) => tier.id), ['common', 'branded'],
    'Branded has the better match, but Common has not finished answering yet');
});

test('the score is a yardstick, not a ranking of the providers', () => {
  assert.equal(matchScore('Chicken', ['chicken']), 1, 'the name IS the query');
  // Whole word beats prefix beats substring.
  assert.ok(matchScore('Chicken breast', ['chicken']) > matchScore('Chickens breast', ['chicken']));
  assert.ok(matchScore('Chickens breast', ['chicken']) > matchScore('Unchickened broth', ['chicken']));
  // Earlier is better.
  assert.ok(matchScore('Chicken soup', ['chicken']) > matchScore('Soup, cream of chicken', ['chicken']));
  // Coverage dominates: every full match outranks every partial one.
  assert.ok(matchScore('Red bull anything at all here', ['red', 'bull']) >
            matchScore('Red', ['red', 'bull']));
  // No query, no opinion — which is what keeps the provider order intact.
  assert.equal(matchScore('Chicken breast', []), 0);
  assert.equal(matchScore('', ['chicken']), 0);
  assert.equal(matchScore('Beef mince', ['chicken']), 0);
});
