import type { FoodId, ISODateTime, RecipeId, SavedMealId } from '@/domain/shared/ids';
import type { FoodRef } from '@/domain/food/source';
import type { PortionSelection } from '@/domain/meals/meal';

export interface SavedMealItem {
  foodId: FoodId;
  /** Provider identity retained alongside foodId. Absent on legacy records. */
  foodRef?: FoodRef;
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
