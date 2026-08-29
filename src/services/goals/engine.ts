import type { GoalTarget, NutritionGoal } from '@/domain';

export type GoalProgressStatus = 'informational' | 'below' | 'within' | 'met' | 'exceeded';

export interface GoalProgress {
  goal: NutritionGoal;
  current: number;
  status: GoalProgressStatus;
  ratio: number | null;
  remaining: number | null;
}

export function validateGoalTarget(target: GoalTarget): void {
  if (target.mode === 'none') return;

  if (target.mode === 'minimum') {
    if (target.minimum === undefined || target.minimum < 0) throw new Error('Minimum goal requires a non-negative minimum.');
    return;
  }

  if (target.mode === 'maximum') {
    if (target.maximum === undefined || target.maximum < 0) throw new Error('Maximum goal requires a non-negative maximum.');
    return;
  }

  if (target.minimum === undefined || target.maximum === undefined) {
    throw new Error('Range goal requires both minimum and maximum.');
  }
  if (target.minimum < 0 || target.maximum < target.minimum) {
    throw new Error('Range goal requires 0 <= minimum <= maximum.');
  }
}

export function evaluateGoal(goal: NutritionGoal, current: number): GoalProgress {
  if (current < 0) throw new Error('Current nutrition value cannot be negative.');
  validateGoalTarget(goal.target);

  const target = goal.target;
  if (target.mode === 'none') {
    return { goal, current, status: 'informational', ratio: null, remaining: null };
  }

  if (target.mode === 'minimum') {
    const minimum = target.minimum ?? 0;
    return {
      goal,
      current,
      status: current >= minimum ? 'met' : 'below',
      ratio: minimum === 0 ? 1 : current / minimum,
      remaining: Math.max(0, minimum - current),
    };
  }

  if (target.mode === 'maximum') {
    const maximum = target.maximum ?? 0;
    return {
      goal,
      current,
      status: current <= maximum ? 'within' : 'exceeded',
      ratio: maximum === 0 ? (current === 0 ? 0 : Number.POSITIVE_INFINITY) : current / maximum,
      remaining: Math.max(0, maximum - current),
    };
  }

  const minimum = target.minimum ?? 0;
  const maximum = target.maximum ?? minimum;
  const status: GoalProgressStatus = current < minimum ? 'below' : current > maximum ? 'exceeded' : 'within';

  return {
    goal,
    current,
    status,
    ratio: maximum === 0 ? 0 : current / maximum,
    remaining: current < minimum ? minimum - current : current <= maximum ? maximum - current : 0,
  };
}
