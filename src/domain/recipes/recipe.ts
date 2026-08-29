import type { FoodId, ISODateTime, RecipeId } from '@/domain/shared/ids';

export interface RecipeIngredient {
  foodId: FoodId;
  quantity: number;
  gramWeight?: number;
  note?: string;
}

export interface Recipe {
  id: RecipeId;
  name: string;
  ingredients: ReadonlyArray<RecipeIngredient>;
  yieldServings: number;
  totalYieldGrams?: number;
  instructions?: string;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
