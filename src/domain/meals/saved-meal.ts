import type { FoodId, ISODateTime, RecipeId, SavedMealId } from '@/domain/shared/ids';
import type { PortionSelection } from '@/domain/meals/meal';

export interface SavedMealItem {
  foodId: FoodId;
  portion: PortionSelection;
  recipeId?: RecipeId;
  note?: string;
}

export interface SavedMeal {
  id: SavedMealId;
  name: string;
  items: readonly SavedMealItem[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}
