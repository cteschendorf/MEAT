import type { NutrientValue } from '@/domain/nutrition/nutrients';
import type { ISODate, MealId } from '@/domain/shared/ids';

export interface DailyNutritionSummary {
  date: ISODate;
  mealIds: ReadonlyArray<MealId>;
  totals: ReadonlyArray<NutrientValue>;
  complete: boolean;
}
