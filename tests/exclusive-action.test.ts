import assert from 'node:assert/strict';
import test from 'node:test';

import type { Meal, SavedMeal } from '../src/domain';
import type { MealRepository, SavedMealRepository } from '../src/data/repositories/contracts';
import type { FoodId, ISODateTime, MealId, SavedMealId } from '../src/domain/shared/ids';
import { ExclusiveActionGate, LatestRequestGate } from '../src/services/actions/exclusive-action';
import { SavedMealService } from '../src/services/meals/saved-meals';

const now = '2026-08-29T18:00:00.000Z' as ISODateTime;

test('two same-render log taps write one saved meal', async () => {
  let releaseSave: (() => void) | undefined;
  const saveStarted = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
  const written: Meal[] = [];
  const meals: MealRepository = {
    async getById() { return null; },
    async save(meal) {
      written.push(meal);
      await saveStarted;
    },
    async delete() {},
    async listByDateRange() { return written; },
  };
  const savedMeals: SavedMealRepository = {
    async getById() { return null; },
    async save() {},
    async delete() {},
    async list() { return []; },
  };
  let sequence = 0;
  const service = new SavedMealService(savedMeals, meals, (prefix) => `${prefix}:${++sequence}`);
  const savedMeal: SavedMeal = {
    id: 'saved-meal:double-tap' as SavedMealId,
    name: 'Breakfast',
    items: [{ foodId: 'food:eggs' as FoodId, portion: { quantity: 1, gramWeight: 100 } }],
    createdAt: now,
    updatedAt: now,
  };
  const gate = new ExclusiveActionGate();

  const first = gate.run(() => service.log(savedMeal, now));
  const second = await gate.run(() => service.log(savedMeal, now));

  assert.deepEqual(second, { started: false });
  assert.equal(written.length, 1);
  releaseSave?.();
  const firstResult = await first;
  assert.equal(firstResult.started, true);
  assert.equal(written.length, 1);
  assert.equal(written[0]?.id, 'meal:1' as MealId);
});

test('a slower previous-day read cannot overwrite the latest Today result', async () => {
  const gate = new LatestRequestGate();
  const committed: string[] = [];
  let resolveOld: ((value: string) => void) | undefined;
  let resolveNew: ((value: string) => void) | undefined;
  const oldDay = new Promise<string>((resolve) => { resolveOld = resolve; });
  const newDay = new Promise<string>((resolve) => { resolveNew = resolve; });

  async function load(value: Promise<string>) {
    const generation = gate.begin();
    const result = await value;
    if (gate.isCurrent(generation)) committed.push(result);
  }

  const oldLoad = load(oldDay);
  const newLoad = load(newDay);
  resolveNew?.('new day');
  await newLoad;
  resolveOld?.('old day');
  await oldLoad;

  assert.deepEqual(committed, ['new day']);
});
