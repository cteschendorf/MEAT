import type { FoodId, FoodServingId, ISODateTime, MealId, MealItemId, MediaId, RecipeId } from '@/domain/shared/ids';

export interface PortionSelection {
  servingId?: FoodServingId;
  quantity: number;
  gramWeight?: number;
}

export interface MealItem {
  id: MealItemId;
  foodId: FoodId;
  portion: PortionSelection;
  recipeId?: RecipeId;
  note?: string;
}

export interface Meal {
  id: MealId;
  occurredAt: ISODateTime;
  items: ReadonlyArray<MealItem>;
  mediaIds: ReadonlyArray<MediaId>;
  title?: string;
  caption?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
