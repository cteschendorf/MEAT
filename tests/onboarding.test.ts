import assert from 'node:assert/strict';
import test from 'node:test';

import type { NutritionGoal, UserPreferences } from '../src/domain';
import type { ISODateTime } from '../src/domain/shared/ids';
import type { GoalRepository, UserPreferencesRepository } from '../src/data/repositories/contracts';
import {
  buildNutritionGoals,
  defaultUserPreferences,
  goalSetupDefinitions,
  OnboardingSetupService,
} from '../src/services/onboarding/setup';

const now = '2026-08-29T15:00:00.000Z' as ISODateTime;

test('setup creates explicit semantic goals for all five MVP metrics without forcing them active', () => {
  const goals = buildNutritionGoals(
    [
      { nutrientCode: 'energy-kcal', mode: 'maximum', maximum: 2100 },
      { nutrientCode: 'protein-g', mode: 'minimum', minimum: 150 },
    ],
    now,
  );

  assert.equal(goals.length, 5);
  assert.equal(goals.find((goal) => goal.nutrientCode === 'energy-kcal')?.target.maximum, 2100);
  assert.equal(goals.find((goal) => goal.nutrientCode === 'protein-g')?.target.minimum, 150);
  assert.equal(goals.find((goal) => goal.nutrientCode === 'fiber-g')?.target.mode, 'none');
});

test('setup validates goal semantics before persistence', () => {
  assert.throws(
    () => buildNutritionGoals([{ nutrientCode: 'protein-g', mode: 'minimum' }], now),
    /requires a non-negative minimum/,
  );
});

test('candidate setup normalizes unsupported ounce drafts to grams', async () => {
  const savedPreferences: UserPreferences[] = [];
  const preferenceRepo: UserPreferencesRepository = {
    async get() { return null; },
    async save(value) { savedPreferences.push(value); },
    async isOnboardingComplete() { return false; },
    async markOnboardingComplete() {},
  };
  const goalRepo: GoalRepository = {
    async save() {},
    async listActive() { return []; },
  };

  await new OnboardingSetupService(preferenceRepo, goalRepo).save(
    {
      preferences: { ...defaultUserPreferences, massUnit: 'oz' },
      goals: goalSetupDefinitions.map(({ nutrientCode }) => ({ nutrientCode, mode: 'none' })),
    },
    now,
  );

  assert.equal(savedPreferences[0]?.massUnit, 'g');
});

test('skip stores neutral preferences and informational goals, then completes onboarding', async () => {
  let preferences: UserPreferences | null = null;
  let complete = false;
  const savedGoals: NutritionGoal[] = [];
  const preferenceRepo: UserPreferencesRepository = {
    async get() {
      return preferences;
    },
    async save(value) {
      preferences = value;
    },
    async isOnboardingComplete() {
      return complete;
    },
    async markOnboardingComplete() {
      complete = true;
    },
  };
  const goalRepo: GoalRepository = {
    async save(goal) {
      savedGoals.push(goal);
    },
    async listActive() {
      return savedGoals;
    },
  };

  await new OnboardingSetupService(preferenceRepo, goalRepo).skip(now);

  assert.deepEqual(preferences, defaultUserPreferences);
  assert.equal(savedGoals.length, 5);
  assert.ok(savedGoals.every((goal) => goal.target.mode === 'none'));
  assert.equal(complete, true);
});
