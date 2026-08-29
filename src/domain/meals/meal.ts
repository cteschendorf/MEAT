import type { FoodId, FoodServingId, ISODateTime, MealId, MealItemId, MediaId, RecipeId } from '@/domain/shared/ids';
import type { FoodRef } from '@/domain/food/source';

export interface PortionSelection {
  servingId?: FoodServingId;
  quantity: number;
  gramWeight?: number;
}

export interface MealItem {
  id: MealItemId;
  foodId: FoodId;
  /** Provider identity retained when this item came from a source-aware flow. */
  foodRef?: FoodRef;
  portion: PortionSelection;
  recipeId?: RecipeId;
  note?: string;
}

export interface Meal {
  id: MealId;
  occurredAt: ISODateTime;
  items: readonly MealItem[];
  mediaIds: readonly MediaId[];
  title?: string;
  caption?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
