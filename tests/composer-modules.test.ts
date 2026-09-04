import assert from 'node:assert/strict';
import test from 'node:test';

import type { NutrientValue, NutritionFacts } from '../src/domain/index';
import type { FoodId, GoalId, ISODateTime, MealId } from '../src/domain/shared/ids';
import type { TodayMetric } from '../src/services/today/snapshot';
import type { MealDraft } from '../src/services/meals/meal-composer';
import { buildDayStandings } from '../src/ui/composer/day-standings';
import { foodSourceNames, sourceForFood } from '../src/ui/composer/food-sources';
import {
  nextMealContext,
  presetMealNames,
  shouldRevealContext,
} from '../src/ui/composer/meal-context';
import {
  combineDatePart,
  isAcceptableMealTime,
  messageFor,
} from '../src/ui/composer/meal-time';
import { buildRunningTotal } from '../src/ui/composer/running-total';

// These modules came out of a 1,340-line screen (THI-316). Every one of them
// held a decision that could previously only be reached by rendering a
// composer, which is why none of them had a test.

// ── The running total ──

function standing(current: number | null, target?: { mode: 'minimum' | 'maximum'; minimum?: number; maximum?: number }) {
  return [
    { code: 'protein-g' as const, current, target: target ?? null },
  ];
}

test('the running total leads with protein, because that is what MEAT counts', () => {
  const total = buildRunningTotal(standing(88.25), 0);
  assert.equal(total.headline, '88.3 g protein');
  assert.equal(total.detail, 'today');
});

test('an uncomputable day prints a dash, never a zero', () => {
  // Zero is a claim that the user has eaten no protein. "We could not work it
  // out" is a different statement and must not be rendered as the first.
  assert.equal(buildRunningTotal(standing(null), 0).headline, '— g protein');
});

test('a minimum goal reads as a target and a maximum reads as a limit', () => {
  assert.equal(
    buildRunningTotal(standing(88, { mode: 'minimum', minimum: 150 }), 0).headline,
    '88 g protein of 150 g',
  );
  assert.equal(
    buildRunningTotal(standing(88, { mode: 'maximum', maximum: 200 }), 0).headline,
    '88 g protein of 200 g limit',
  );
});

test('the unsaved foods are counted in words, and pluralised honestly', () => {
  assert.equal(buildRunningTotal(standing(10), 1).detail, 'today, including 1 food not yet saved');
  assert.equal(buildRunningTotal(standing(10), 3).detail, 'today, including 3 foods not yet saved');
});

test('the spoken label carries the same sentence as the two visible halves', () => {
  const total = buildRunningTotal(standing(88, { mode: 'minimum', minimum: 150 }), 2);
  assert.equal(total.accessibilityLabel, `${total.headline} ${total.detail}.`);
});

// ── Folding the draft into the day ──

function metric(code: TodayMetric['code'], value: number | null, state: TodayMetric['state']): TodayMetric {
  return { code, value, state, goal: null };
}

function facts(protein: number): NutritionFacts {
  const nutrients: NutrientValue[] = [
    { nutrient: { code: 'protein-g', name: 'Protein', unit: 'g' }, state: 'known', value: protein },
  ];
  return { basisGrams: 100, nutrients };
}

test('the draft is added to the day, because it is part of "now" to the person holding it', () => {
  const standings = buildDayStandings([metric('protein-g', 100, 'known')], facts(31));
  assert.equal(standings.find((entry) => entry.code === 'protein-g')?.current, 131);
});

test('a known draft amount added to an unknown day stays unknown', () => {
  // The alternative is reporting 31 g as though the rest of the day were zero,
  // which invents a total nobody can stand behind.
  const standings = buildDayStandings([metric('protein-g', null, 'unknown')], facts(31));
  assert.equal(standings.find((entry) => entry.code === 'protein-g')?.current, null);
});

test('every core nutrient gets a standing, even one the day says nothing about', () => {
  const standings = buildDayStandings([], null);
  assert.equal(standings.length, 5);
  assert.ok(standings.every((entry) => entry.current === null && entry.target === null));
});

test('a goal on the day metric becomes the standing’s target', () => {
  const goal = {
    id: 'goal-1' as GoalId,
    nutrientCode: 'protein-g' as const,
    target: { mode: 'minimum' as const, minimum: 150 },
    effectiveFrom: '2026-01-01T00:00:00.000Z' as ISODateTime,
  };
  const standings = buildDayStandings(
    [{ code: 'protein-g', value: 100, state: 'known', goal: { goal, current: 100, status: 'below', ratio: null, remaining: null } }],
    null,
  );
  assert.deepEqual(standings.find((entry) => entry.code === 'protein-g')?.target, goal.target);
});

// ── The context patch ──

const draft = {
  id: 'meal-1' as MealId,
  items: [],
  context: {
    occurredAt: '2026-09-01T12:00:00.000Z' as ISODateTime,
    title: 'Lunch',
    caption: 'On the balcony',
    location: { label: 'Home' },
  },
} as unknown as MealDraft;

test('null clears a field and absence leaves it alone', () => {
  // Collapsing these two would mean a meal name, once set, could never be
  // removed — which is what the "None" button is for.
  assert.equal(nextMealContext(draft, { title: null }).title, undefined);
  assert.equal(nextMealContext(draft, { caption: null }).title, 'Lunch');
  assert.equal(nextMealContext(draft, {}).caption, 'On the balcony');
});

test('one patched field never disturbs the others', () => {
  const next = nextMealContext(draft, { location: null });
  assert.equal(next.location, undefined);
  assert.equal(next.title, 'Lunch');
  assert.equal(next.caption, 'On the balcony');
  assert.equal(next.occurredAt, draft.context.occurredAt);
});

test('the context opens unfolded only when the draft already carries some', () => {
  assert.equal(shouldRevealContext(draft, { existing: 0, staged: 0 }), true);
  const bare = { ...draft, context: { occurredAt: draft.context.occurredAt } } as MealDraft;
  assert.equal(shouldRevealContext(bare, { existing: 0, staged: 0 }), false);
  // A photo is context even when nothing was typed.
  assert.equal(shouldRevealContext(bare, { existing: 0, staged: 1 }), true);
});

test('the preset meal names are the four the buttons offer', () => {
  assert.deepEqual([...presetMealNames], ['Breakfast', 'Lunch', 'Dinner', 'Snack']);
});

// ── Meal time ──

test('changing the date keeps the time, and changing the time keeps the date', () => {
  const current = new Date(2026, 8, 1, 13, 45, 30);
  const picked = new Date(2026, 7, 20, 9, 5, 0);

  const byDate = combineDatePart(current, picked, 'date');
  assert.equal(byDate.getFullYear(), 2026);
  assert.equal(byDate.getMonth(), 7);
  assert.equal(byDate.getDate(), 20);
  assert.equal(byDate.getHours(), 13);
  assert.equal(byDate.getMinutes(), 45);

  const byTime = combineDatePart(current, picked, 'time');
  assert.equal(byTime.getMonth(), 8);
  assert.equal(byTime.getDate(), 1);
  assert.equal(byTime.getHours(), 9);
  assert.equal(byTime.getMinutes(), 5);
  // The user chose a minute, so carrying the old seconds forward would record
  // a precision they never expressed.
  assert.equal(byTime.getSeconds(), 0);
});

test('a meal cannot have happened in the future', () => {
  const now = new Date('2026-09-01T12:00:00.000Z');
  assert.equal(isAcceptableMealTime(new Date('2026-09-01T11:59:59.000Z'), now), true);
  assert.equal(isAcceptableMealTime(now, now), true, 'this instant counts as now');
  assert.equal(isAcceptableMealTime(new Date('2026-09-01T12:00:01.000Z'), now), false);
  assert.equal(isAcceptableMealTime(new Date('nonsense'), now), false);
});

test('an error speaks for itself when it can, and the fallback speaks when it cannot', () => {
  assert.equal(messageFor(new Error('Draft is read-only.'), 'fallback'), 'Draft is read-only.');
  assert.equal(messageFor('a thrown string', 'fallback'), 'fallback');
  assert.equal(messageFor(undefined, 'fallback'), 'fallback');
});

// ── Sources ──

test('the source names are declared once, and the lookup agrees with the list', () => {
  // These were two separate literals inside the screen, which is how they drifted.
  assert.equal(foodSourceNames['usda-core'], 'USDA Core');
  assert.equal(foodSourceNames['open-food-facts'], 'Open Food Facts');
});

test('a food names its own source, and an unprefixed id is one of yours', () => {
  assert.equal(sourceForFood({ id: 'usda-core:1234' as FoodId }), 'usda-core');
  assert.equal(sourceForFood({ id: 'open-food-facts:5060337502900' as FoodId }), 'open-food-facts');
  assert.equal(sourceForFood({ id: 'something-i-made' as FoodId }), 'personal');
});
