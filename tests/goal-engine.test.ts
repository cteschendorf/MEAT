import assert from 'node:assert/strict';
import test from 'node:test';

import type { NutritionGoal } from '../src/domain/goals/goal';
import type { GoalId, ISODateTime } from '../src/domain/shared/ids';
import { evaluateGoal, validateGoalTarget } from '../src/services/goals/engine';

const effectiveFrom = '2026-08-29T00:00:00.000Z' as ISODateTime;
function goal(target: NutritionGoal['target'], nutrientCode: NutritionGoal['nutrientCode'] = 'protein-g'): NutritionGoal {
  return { id: 'goal-1' as GoalId, nutrientCode, target, effectiveFrom };
}

test('minimum goals report remaining amount until met', () => {
  const result = evaluateGoal(goal({ mode: 'minimum', minimum: 150 }), 120);
  assert.equal(result.status, 'below'); assert.equal(result.remaining, 30); assert.equal(result.ratio, 0.8);
  assert.equal(evaluateGoal(goal({ mode: 'minimum', minimum: 150 }), 155).status, 'met');
});
test('maximum goals distinguish within from exceeded', () => {
  const calories = goal({ mode: 'maximum', maximum: 2000 }, 'energy-kcal');
  assert.equal(evaluateGoal(calories, 1800).status, 'within'); assert.equal(evaluateGoal(calories, 2200).status, 'exceeded');
});
test('range goals distinguish below within and exceeded', () => {
  const carbs = goal({ mode: 'range', minimum: 150, maximum: 220 }, 'carbohydrate-g');
  assert.equal(evaluateGoal(carbs, 120).status, 'below'); assert.equal(evaluateGoal(carbs, 180).status, 'within'); assert.equal(evaluateGoal(carbs, 240).status, 'exceeded');
});
test('no goal stays informational', () => {
  const result = evaluateGoal(goal({ mode: 'none' }, 'fat-g'), 70); assert.equal(result.status, 'informational'); assert.equal(result.ratio, null);
});
test('invalid range targets are rejected', () => assert.throws(() => validateGoalTarget({ mode: 'range', minimum: 200, maximum: 100 })));
