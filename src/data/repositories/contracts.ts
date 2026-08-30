import type { Food, Meal, MediaAsset, NutritionGoal, Recipe, SavedMeal, UserPreferences } from '@/domain';
import type { FoodId, ISODateTime, MealId, MediaId, RecipeId, SavedMealId } from '@/domain/shared/ids';

export interface FoodRepository {
  getById(id: FoodId): Promise<Food | null>;
  save(food: Food): Promise<void>;
  delete(id: FoodId): Promise<void>;
  list(limit?: number): Promise<readonly Food[]>;
}

export interface TransactionRunner {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface MealRepository {
  getById(id: MealId): Promise<Meal | null>;
  save(meal: Meal): Promise<void>;
  delete(id: MealId): Promise<void>;
  listByDateRange(start: string, end: string): Promise<readonly Meal[]>;
  listRecent(limit?: number): Promise<readonly Meal[]>;
}

export interface MediaRepository {
  getById(id: MediaId): Promise<MediaAsset | null>;
  list(limit?: number): Promise<readonly MediaAsset[]>;
  listByIds(ids: readonly MediaId[]): Promise<readonly MediaAsset[]>;
  listByMealId(mealId: MealId): Promise<readonly MediaAsset[]>;
  listUnattachedBefore(cutoff: ISODateTime, limit?: number): Promise<readonly MediaAsset[]>;
  save(asset: MediaAsset): Promise<void>;
  saveMany(assets: readonly MediaAsset[]): Promise<void>;
  attachToMeal(ids: readonly MediaId[], mealId: MealId, updatedAt: ISODateTime): Promise<void>;
  detachFromMeal(ids: readonly MediaId[], mealId: MealId, updatedAt: ISODateTime): Promise<void>;
  delete(id: MediaId): Promise<void>;
  deleteMany(ids: readonly MediaId[]): Promise<void>;
}

export interface SavedMealRepository {
  getById(id: SavedMealId): Promise<SavedMeal | null>;
  save(savedMeal: SavedMeal): Promise<void>;
  delete(id: SavedMealId): Promise<void>;
  list(): Promise<readonly SavedMeal[]>;
}

export interface RecipeRepository {
  getById(id: RecipeId): Promise<Recipe | null>;
  save(recipe: Recipe): Promise<void>;
  delete(id: RecipeId): Promise<void>;
  list(): Promise<readonly Recipe[]>;
}

export interface GoalRepository {
  save(goal: NutritionGoal): Promise<void>;
  listActive(at: string): Promise<readonly NutritionGoal[]>;
}

export interface FavoriteFoodRepository {
  listFavoriteIds(): Promise<readonly FoodId[]>;
  setFavorite(foodId: FoodId, favorite: boolean, updatedAt: string): Promise<void>;
}

export interface FoodReferenceRepository {
  listKnownIds(limit?: number): Promise<readonly FoodId[]>;
  touch(foodId: FoodId, updatedAt: string): Promise<void>;
}

export interface UserPreferencesRepository {
  get(): Promise<UserPreferences | null>;
  save(preferences: UserPreferences, updatedAt: string): Promise<void>;
  isOnboardingComplete(): Promise<boolean>;
  markOnboardingComplete(updatedAt: string): Promise<void>;
}

export interface PrivateDataRepository {
  exportJson(): Promise<string>;
  deleteAllPrivateData(): Promise<void>;
}
