import type { FoodId, ISODateTime, RecipeId } from '@/domain/shared/ids';
import type { FoodRef } from '@/domain/food/source';

export interface RecipeIngredient {
  foodId: FoodId;
  /** Provider identity retained alongside foodId. Absent on legacy records. */
  foodRef?: FoodRef;
  quantity: number;
  gramWeight?: number;
  note?: string;
}

export interface Recipe {
  id: RecipeId;
  name: string;
  ingredients: readonly RecipeIngredient[];
  yieldServings: number;
  totalYieldGrams?: number;
  instructions?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
