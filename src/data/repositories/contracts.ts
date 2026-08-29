import type { Food, Meal, NutritionGoal, Recipe } from '@/domain';
import type { FoodId, MealId, RecipeId } from '@/domain/shared/ids';

export interface FoodRepository {
  getById(id: FoodId): Promise<Food | null>;
  save(food: Food): Promise<void>;
  delete(id: FoodId): Promise<void>;
  list(limit?: number): Promise<ReadonlyArray<Food>>;
}

export interface MealRepository {
  getById(id: MealId): Promise<Meal | null>;
  save(meal: Meal): Promise<void>;
  delete(id: MealId): Promise<void>;
  listByDateRange(start: string, end: string): Promise<ReadonlyArray<Meal>>;
}

export interface RecipeRepository {
  getById(id: RecipeId): Promise<Recipe | null>;
  save(recipe: Recipe): Promise<void>;
  delete(id: RecipeId): Promise<void>;
  list(): Promise<ReadonlyArray<Recipe>>;
}

export interface GoalRepository {
  save(goal: NutritionGoal): Promise<void>;
  listActive(at: string): Promise<ReadonlyArray<NutritionGoal>>;
}

export interface PrivateDataRepository {
  exportJson(): Promise<string>;
  deleteAllPrivateData(): Promise<void>;
}
