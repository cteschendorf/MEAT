import type { CoreNutrientCode } from '@/domain/nutrition/nutrients';
import type { GoalId, ISODateTime } from '@/domain/shared/ids';

export type GoalMode = 'minimum' | 'maximum' | 'range' | 'none';

export interface GoalTarget {
  mode: GoalMode;
  minimum?: number;
  maximum?: number;
}

export interface NutritionGoal {
  id: GoalId;
  nutrientCode: CoreNutrientCode;
  target: GoalTarget;
  effectiveFrom: ISODateTime;
  effectiveUntil?: ISODateTime;
}
