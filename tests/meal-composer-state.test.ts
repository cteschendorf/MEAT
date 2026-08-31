import assert from 'node:assert/strict';
import test from 'node:test';

import type { MealItem } from '../src/domain/meals/meal';
import type { FoodId, ISODateTime, MealId, MealItemId } from '../src/domain/shared/ids';
import type { MealDraft } from '../src/services/meals/meal-composer';
import {
  contextFromRawMealValues,
  isCustomMealTitle,
  rawMealContextForDraft,
  rebaseComposerAddition,
} from '../src/ui/meal-composer-state';

const time = '2026-08-29T18:00:00.000Z' as ISODateTime;

function item(id: string): MealItem {
  return {
    id: id as MealItemId,
    foodId: `food:${id}` as FoodId,
    portion: { quantity: 1, gramWeight: 100 },
  };
}

function draft(items: readonly MealItem[], title?: string): MealDraft {
  return {
    id: 'meal:draft' as MealId,
    createdAt: time,
    context: { occurredAt: time, ...(title ? { title } : {}) },
    items,
  };
}

test('composer keeps multi-word context untrimmed until canonical commit', () => {
  const base = draft([]);
  const context = contextFromRawMealValues(base, {
    title: 'Post workout lunch',
    location: 'Gym cafe downtown',
    caption: 'Ate with my training partner',
  });

  assert.equal(context.title, 'Post workout lunch');
  assert.equal(context.location?.label, 'Gym cafe downtown');
  assert.equal(context.caption, 'Ate with my training partner');
  assert.deepEqual(
    contextFromRawMealValues(base, { title: '   ', location: '', caption: ' ' }),
    { occurredAt: time },
  );
});

test('an externally prefixed saved-meal title becomes visible as Custom', () => {
  const external = draft([], 'Post-workout meal');
  const raw = rawMealContextForDraft(external);
  assert.equal(raw.title, 'Post-workout meal');
  assert.equal(isCustomMealTitle(raw.title, ['Breakfast', 'Lunch', 'Dinner', 'Snack']), true);
});

test('a slow provider add rebases its new item onto the latest draft edits', () => {
  const original = draft([item('old')], 'Breakfast');
  const providerResult = { ...original, items: [...original.items, item('provider')] };
  const latest = {
    ...original,
    context: { occurredAt: time, title: 'Lunch' },
    items: [item('replacement')],
  };

  const rebased = rebaseComposerAddition(original, providerResult, latest);
  assert.equal(rebased.context.title, 'Lunch');
  assert.deepEqual(rebased.items.map((value) => value.id), ['replacement', 'provider']);
});
