import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, Meal, NutritionGoal, Recipe, SavedMeal, UserPreferences } from '@/domain';
import type { FoodId, MealId, RecipeId, SavedMealId } from '@/domain/shared/ids';
import type {
  FavoriteFoodRepository,
  FoodRepository,
  GoalRepository,
  MealRepository,
  PrivateDataRepository,
  RecipeRepository,
  SavedMealRepository,
  UserPreferencesRepository,
} from '@/data/repositories/contracts';

type PayloadRow = { payload: string };
type FavoriteRow = { food_id: FoodId; updated_at: string };
type PreferencesRow = { payload: string; onboarding_completed: number; updated_at: string };

function parsePayload<T>(row: PayloadRow | null): T | null {
  return row ? (JSON.parse(row.payload) as T) : null;
}

export class SqliteFoodRepository implements FoodRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getById(id: FoodId): Promise<Food | null> {
    return parsePayload<Food>(await this.db.getFirstAsync<PayloadRow>('SELECT payload FROM foods WHERE id = ?', id));
  }

  async save(food: Food): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO foods (id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      food.id,
      JSON.stringify(food),
      food.updatedAt,
    );
  }

  async delete(id: FoodId): Promise<void> {
    await this.db.runAsync('DELETE FROM foods WHERE id = ?', id);
  }

  async list(limit = 100): Promise<readonly Food[]> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM foods ORDER BY updated_at DESC LIMIT ?', limit);
    return rows.map((row) => JSON.parse(row.payload) as Food);
  }
}

export class SqliteMealRepository implements MealRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getById(id: MealId): Promise<Meal | null> {
    return parsePayload<Meal>(await this.db.getFirstAsync<PayloadRow>('SELECT payload FROM meals WHERE id = ?', id));
  }

  async save(meal: Meal): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO meals (id, occurred_at, payload, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET occurred_at = excluded.occurred_at, payload = excluded.payload, updated_at = excluded.updated_at`,
      meal.id,
      meal.occurredAt,
      JSON.stringify(meal),
      meal.updatedAt,
    );
  }

  async delete(id: MealId): Promise<void> {
    await this.db.runAsync('DELETE FROM meals WHERE id = ?', id);
  }

  async listByDateRange(start: string, end: string): Promise<readonly Meal[]> {
    const rows = await this.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM meals WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',
      start,
      end,
    );
    return rows.map((row) => JSON.parse(row.payload) as Meal);
  }

  async listRecent(limit = 250): Promise<readonly Meal[]> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM meals ORDER BY occurred_at DESC LIMIT ?', limit);
    return rows.map((row) => JSON.parse(row.payload) as Meal);
  }
}

export class SqliteSavedMealRepository implements SavedMealRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getById(id: SavedMealId): Promise<SavedMeal | null> {
    return parsePayload<SavedMeal>(
      await this.db.getFirstAsync<PayloadRow>('SELECT payload FROM saved_meals WHERE id = ?', id),
    );
  }

  async save(savedMeal: SavedMeal): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO saved_meals (id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      savedMeal.id,
      JSON.stringify(savedMeal),
      savedMeal.updatedAt,
    );
  }

  async delete(id: SavedMealId): Promise<void> {
    await this.db.runAsync('DELETE FROM saved_meals WHERE id = ?', id);
  }

  async list(): Promise<readonly SavedMeal[]> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM saved_meals ORDER BY updated_at DESC');
    return rows.map((row) => JSON.parse(row.payload) as SavedMeal);
  }
}

export class SqliteRecipeRepository implements RecipeRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getById(id: RecipeId): Promise<Recipe | null> {
    return parsePayload<Recipe>(await this.db.getFirstAsync<PayloadRow>('SELECT payload FROM recipes WHERE id = ?', id));
  }

  async save(recipe: Recipe): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO recipes (id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      recipe.id,
      JSON.stringify(recipe),
      recipe.updatedAt,
    );
  }

  async delete(id: RecipeId): Promise<void> {
    await this.db.runAsync('DELETE FROM recipes WHERE id = ?', id);
  }

  async list(): Promise<readonly Recipe[]> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM recipes ORDER BY updated_at DESC');
    return rows.map((row) => JSON.parse(row.payload) as Recipe);
  }
}

export class SqliteGoalRepository implements GoalRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async save(goal: NutritionGoal): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO goals (id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      goal.id,
      JSON.stringify(goal),
      goal.effectiveFrom,
    );
  }

  async listActive(at: string): Promise<readonly NutritionGoal[]> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM goals ORDER BY updated_at DESC');
    return rows
      .map((row) => JSON.parse(row.payload) as NutritionGoal)
      .filter((goal) => goal.effectiveFrom <= at && (!goal.effectiveUntil || goal.effectiveUntil > at));
  }
}

export class SqliteFavoriteFoodRepository implements FavoriteFoodRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listFavoriteIds(): Promise<readonly FoodId[]> {
    const rows = await this.db.getAllAsync<FavoriteRow>(
      'SELECT food_id, updated_at FROM favorite_foods ORDER BY updated_at DESC, food_id ASC',
    );
    return rows.map((row) => row.food_id);
  }

  async setFavorite(foodId: FoodId, favorite: boolean, updatedAt: string): Promise<void> {
    if (!favorite) {
      await this.db.runAsync('DELETE FROM favorite_foods WHERE food_id = ?', foodId);
      return;
    }

    await this.db.runAsync(
      `INSERT INTO favorite_foods (food_id, updated_at) VALUES (?, ?)
       ON CONFLICT(food_id) DO UPDATE SET updated_at = excluded.updated_at`,
      foodId,
      updatedAt,
    );
  }
}

export class SqliteUserPreferencesRepository implements UserPreferencesRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async get(): Promise<UserPreferences | null> {
    return parsePayload<UserPreferences>(
      await this.db.getFirstAsync<PayloadRow>('SELECT payload FROM user_preferences WHERE singleton_id = 1'),
    );
  }

  async save(preferences: UserPreferences, updatedAt: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO user_preferences (singleton_id, payload, onboarding_completed, updated_at)
       VALUES (1, ?, 0, ?)
       ON CONFLICT(singleton_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      JSON.stringify(preferences),
      updatedAt,
    );
  }

  async isOnboardingComplete(): Promise<boolean> {
    const row = await this.db.getFirstAsync<PreferencesRow>(
      'SELECT payload, onboarding_completed, updated_at FROM user_preferences WHERE singleton_id = 1',
    );
    return row?.onboarding_completed === 1;
  }

  async markOnboardingComplete(updatedAt: string): Promise<void> {
    await this.db.runAsync(
      'UPDATE user_preferences SET onboarding_completed = 1, updated_at = ? WHERE singleton_id = 1',
      updatedAt,
    );
  }
}

export class SqlitePrivateDataRepository implements PrivateDataRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async exportJson(): Promise<string> {
    const [foods, meals, savedMeals, recipes, goals, favoriteFoods, preferences] = await Promise.all([
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM foods'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM meals'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM saved_meals'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM recipes'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM goals'),
      this.db.getAllAsync<FavoriteRow>('SELECT food_id, updated_at FROM favorite_foods ORDER BY updated_at DESC'),
      this.db.getFirstAsync<PreferencesRow>(
        'SELECT payload, onboarding_completed, updated_at FROM user_preferences WHERE singleton_id = 1',
      ),
    ]);

    return JSON.stringify({
      foods: foods.map((row) => JSON.parse(row.payload)),
      meals: meals.map((row) => JSON.parse(row.payload)),
      savedMeals: savedMeals.map((row) => JSON.parse(row.payload)),
      recipes: recipes.map((row) => JSON.parse(row.payload)),
      goals: goals.map((row) => JSON.parse(row.payload)),
      favoriteFoods,
      preferences: preferences
        ? {
            value: JSON.parse(preferences.payload),
            onboardingCompleted: preferences.onboarding_completed === 1,
            updatedAt: preferences.updated_at,
          }
        : null,
    });
  }

  async deleteAllPrivateData(): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.execAsync(
        'DELETE FROM favorite_foods; DELETE FROM meals; DELETE FROM saved_meals; DELETE FROM recipes; DELETE FROM goals; DELETE FROM foods; DELETE FROM user_preferences;',
      );
    });
  }
}
