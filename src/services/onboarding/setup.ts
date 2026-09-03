import type {
  CoreNutrientCode,
  GoalMode,
  GoalTarget,
  NutritionGoal,
  UserPreferences,
} from '@/domain';
import type { GoalId, ISODateTime } from '@/domain/shared/ids';
import type { GoalRepository, UserPreferencesRepository } from '@/data';
import { validateGoalTarget } from '@/services/goals/engine';

export const defaultUserPreferences: UserPreferences = {
  massUnit: 'g',
  energyUnit: 'kcal',
  appearance: 'system',
  weekStartsOn: 0,
};

export interface GoalSetupDefinition {
  nutrientCode: CoreNutrientCode;
  label: string;
  unit: 'kcal' | 'g';
}

export const goalSetupDefinitions: readonly GoalSetupDefinition[] = [
  { nutrientCode: 'energy-kcal', label: 'Calories', unit: 'kcal' },
  { nutrientCode: 'protein-g', label: 'Protein', unit: 'g' },
  { nutrientCode: 'carbohydrate-g', label: 'Carbohydrates', unit: 'g' },
  { nutrientCode: 'fat-g', label: 'Fat', unit: 'g' },
  { nutrientCode: 'fiber-g', label: 'Fiber', unit: 'g' },
];

export interface GoalSetupInput {
  nutrientCode: CoreNutrientCode;
  mode: GoalMode;
  minimum?: number;
  maximum?: number;
}

export interface OnboardingSetupInput {
  preferences: UserPreferences;
  goals: readonly GoalSetupInput[];
}

export function buildNutritionGoals(inputs: readonly GoalSetupInput[], now: ISODateTime): readonly NutritionGoal[] {
  const byCode = new Map(inputs.map((input) => [input.nutrientCode, input]));

  return goalSetupDefinitions.map(({ nutrientCode }) => {
    const input = byCode.get(nutrientCode) ?? { nutrientCode, mode: 'none' as const };
    const target: GoalTarget = {
      mode: input.mode,
      ...(input.minimum !== undefined ? { minimum: input.minimum } : {}),
      ...(input.maximum !== undefined ? { maximum: input.maximum } : {}),
    };
    validateGoalTarget(target);
    return {
      id: `goal:${nutrientCode}` as GoalId,
      nutrientCode,
      target,
      effectiveFrom: now,
    };
  });
}

export function setupInputsFromGoals(goals: readonly NutritionGoal[]): readonly GoalSetupInput[] {
  const byCode = new Map(goals.map((goal) => [goal.nutrientCode, goal]));
  return goalSetupDefinitions.map(({ nutrientCode }) => {
    const goal = byCode.get(nutrientCode);
    return {
      nutrientCode,
      mode: goal?.target.mode ?? 'none',
      ...(goal?.target.minimum !== undefined ? { minimum: goal.target.minimum } : {}),
      ...(goal?.target.maximum !== undefined ? { maximum: goal.target.maximum } : {}),
    };
  });
}

export class OnboardingSetupService {
  constructor(
    private readonly preferences: UserPreferencesRepository,
    private readonly goals: GoalRepository,
  ) {}

  async load(now: ISODateTime): Promise<{
    preferences: UserPreferences;
    goals: readonly GoalSetupInput[];
    onboardingComplete: boolean;
  }> {
    const [preferences, goals, onboardingComplete] = await Promise.all([
      this.preferences.get(),
      this.goals.listActive(now),
      this.preferences.isOnboardingComplete(),
    ]);
    return {
      preferences: preferences ?? defaultUserPreferences,
      goals: setupInputsFromGoals(goals),
      onboardingComplete,
    };
  }

  async save(input: OnboardingSetupInput, now: ISODateTime): Promise<void> {
    const goals = buildNutritionGoals(input.goals, now);
    // The unit preference used to be overwritten with 'g' right here, because
    // no logging surface could honour anything else and storing a choice the
    // app would ignore is worse than not offering it. The detail sheet has
    // honoured it since THI-317 — `unitChoicesFor` leads with the chosen unit
    // and `defaultPortionChoice` opens on it — so the override outlived its
    // reason and became a picker that highlights and then silently reverts
    // (THI-340).
    await this.preferences.save(input.preferences, now);
    for (const goal of goals) await this.goals.save(goal);
    await this.preferences.markOnboardingComplete(now);
  }

  async skip(now: ISODateTime): Promise<void> {
    await this.save(
      {
        preferences: defaultUserPreferences,
        goals: goalSetupDefinitions.map(({ nutrientCode }) => ({ nutrientCode, mode: 'none' })),
      },
      now,
    );
  }
}
