import assert from 'node:assert/strict';
import test from 'node:test';

import type { Food, Meal, MediaAsset, NutritionGoal } from '../src/domain';
import type { FoodRepository, MediaRepository } from '../src/data/repositories/contracts';
import type {
  FoodId,
  FoodServingId,
  GoalId,
  ISODateTime,
  MealId,
  MealItemId,
  MediaId,
} from '../src/domain/shared/ids';
import {
  buildMealTimelineEntries,
  compareTimelineEntriesChronologically,
  derivedFoodSummary,
  groupTimelineEntries,
  pageFromLookahead,
} from '../src/services/meals/meal-timeline-presentation';
import {
  metricAccessibilityLabel,
  metricGoalText,
  metricProgress,
  metricValueText,
} from '../src/ui/nutrition-dashboard-model';
import type { TodayMetric } from '../src/services/today/snapshot';

const timestamp = '2026-08-29T12:00:00.000Z' as ISODateTime;

function food(id: string, name: string): Food {
  const foodId = id as FoodId;
  return {
    id: foodId,
    kind: 'custom',
    name,
    nutrition: { basisGrams: 100, nutrients: [] },
    servings: [{
      id: `${id}:serving` as FoodServingId,
      foodId,
      label: '100 g',
      gramWeight: 100,
      quantity: 1,
      unit: 'serving',
    }],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function meal(input: {
  id: string;
  occurredAt: Date;
  createdAt?: Date;
  foodIds?: readonly string[];
  mediaIds?: readonly string[];
  title?: string;
  caption?: string;
  location?: string;
}): Meal {
  const createdAt = (input.createdAt ?? input.occurredAt).toISOString() as ISODateTime;
  return {
    id: input.id as MealId,
    occurredAt: input.occurredAt.toISOString() as ISODateTime,
    createdAt,
    updatedAt: createdAt,
    items: (input.foodIds ?? ['food:eggs']).map((foodId, index) => ({
      id: `${input.id}:item:${index}` as MealItemId,
      foodId: foodId as FoodId,
      portion: { quantity: 1, gramWeight: 80 + index * 20 },
    })),
    mediaIds: (input.mediaIds ?? []).map((id) => id as MediaId),
    ...(input.title ? { title: input.title } : {}),
    ...(input.caption ? { caption: input.caption } : {}),
    ...(input.location ? { location: { label: input.location } } : {}),
  };
}

function foodsRepository(values: readonly Food[]): FoodRepository {
  const byId = new Map(values.map((value) => [value.id, value]));
  return {
    async getById(id) { return byId.get(id) ?? null; },
    async save(value) { byId.set(value.id, value); },
    async delete(id) { byId.delete(id); },
    async list(limit = 100) { return [...byId.values()].slice(0, limit); },
  };
}

function goalMetric(ratio: number): TodayMetric {
  const goal: NutritionGoal = {
    id: 'goal:protein' as GoalId,
    nutrientCode: 'protein-g',
    target: { mode: 'minimum', minimum: 150 },
    effectiveFrom: '2026-08-01T00:00:00.000Z' as ISODateTime,
  };
  return {
    code: 'protein-g',
    value: 126.04,
    state: 'known',
    goal: { goal, current: 126.04, status: 'below', ratio, remaining: 23.96 },
  };
}

test('dashboard formatting distinguishes unknown values and clamps visual progress', () => {
  const metric = goalMetric(1.4);
  assert.equal(metricValueText(metric), '126');
  assert.equal(metricGoalText(metric), '24 g to goal');
  assert.equal(metricProgress(metric), 1);
  assert.match(metricAccessibilityLabel(metric), /Protein, 126 g\. 24 g to goal/);

  const unknown: TodayMetric = { code: 'fiber-g', value: null, state: 'unknown', goal: null };
  assert.equal(metricValueText(unknown), '—');
  assert.equal(metricGoalText(unknown), 'No data yet');
  assert.equal(metricProgress(unknown), null);
});

test('timeline presentation derives food-first titles and resolves optional context', async () => {
  const photo: MediaAsset = {
    id: 'media:lunch' as MediaId,
    kind: 'photo',
    storage: 'local',
    uri: 'file:///private/lunch.jpg',
    mimeType: 'image/jpeg',
    width: 1200,
    height: 900,
    byteSize: 44_000,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const media = {
    async listByIds(ids: readonly MediaId[]) {
      return ids.includes(photo.id) ? [photo] : [];
    },
  } satisfies Pick<MediaRepository, 'listByIds'>;
  const event = meal({
    id: 'meal:lunch',
    occurredAt: new Date(2026, 7, 29, 12, 15),
    foodIds: ['food:chicken', 'food:rice', 'food:beans'],
    title: 'Post-workout lunch',
    caption: 'This stays out of the compact timeline card.',
    location: 'Home',
    mediaIds: [photo.id],
  });

  const [entry] = await buildMealTimelineEntries(
    [event],
    foodsRepository([
      food('food:chicken', 'Chicken breast'),
      food('food:rice', 'Brown rice'),
      food('food:beans', 'Black beans'),
    ]),
    { media },
  );

  assert.ok(entry);
  assert.equal(entry.foodSummary, 'Chicken breast, Brown rice +1 more');
  assert.equal(entry.mealTitle, 'Post-workout lunch');
  assert.equal(entry.locationLabel, 'Home');
  assert.equal(entry.thumbnailUri, photo.uri);
  assert.equal('caption' in entry, false);
  assert.deepEqual(entry.items.map((item) => item.portionText), ['80 g', '100 g', '120 g']);
});

test('journal days are newest first while each day is chronological with stable tie breaks', async () => {
  const baseFoods = foodsRepository([food('food:eggs', 'Eggs')]);
  const sameOccurrence = new Date(2026, 7, 28, 9, 0);
  const events = [
    meal({ id: 'meal:b', occurredAt: sameOccurrence, createdAt: new Date(2026, 7, 28, 9, 2) }),
    meal({ id: 'meal:a', occurredAt: sameOccurrence, createdAt: new Date(2026, 7, 28, 9, 2) }),
    meal({ id: 'meal:early', occurredAt: new Date(2026, 7, 28, 7, 30) }),
    meal({ id: 'meal:new-day', occurredAt: new Date(2026, 7, 29, 8, 0) }),
  ];
  const entries = await buildMealTimelineEntries(events, baseFoods);
  const sections = groupTimelineEntries(entries);

  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map((section) => section.dayKey), [
    `${new Date(2026, 7, 29).getFullYear()}-08-29`,
    `${new Date(2026, 7, 28).getFullYear()}-08-28`,
  ]);
  assert.deepEqual(sections[1]?.entries.map((entry) => entry.id), ['meal:early', 'meal:a', 'meal:b']);
  assert.deepEqual([...entries].sort(compareTimelineEntriesChronologically).map((entry) => entry.id), [
    'meal:early',
    'meal:a',
    'meal:b',
    'meal:new-day',
  ]);
});

test('food summaries and lookahead pagination stay deterministic', () => {
  assert.equal(derivedFoodSummary([]), 'Meal entry');
  assert.equal(derivedFoodSummary([' Eggs ', 'Toast']), 'Eggs & Toast');
  assert.deepEqual(pageFromLookahead([1, 2, 3], 2), { values: [1, 2], hasMore: true });
  assert.deepEqual(pageFromLookahead([1, 2], 2), { values: [1, 2], hasMore: false });
  assert.throws(() => pageFromLookahead([], 0), /positive integer/);
});
