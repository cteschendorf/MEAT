import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, Meal, NutritionGoal, Recipe } from '@/domain';
import type { FoodId, MealId, RecipeId } from '@/domain/shared/ids';
import type {
  FoodRepository,
  GoalRepository,
  MealRepository,
  PrivateDataRepository,
  RecipeRepository,
} from '@/data/repositories/contracts';

type PayloadRow = { payload: string };

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

  async list(limit = 100): Promise<ReadonlyArray<Food>> {
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

  async listByDateRange(start: string, end: string): Promise<ReadonlyArray<Meal>> {
    const rows = await this.db.getAllAsync<PayloadRow>(
      'SELECT payload FROM meals WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at DESC',
      start,
      end,
    );
    return rows.map((row) => JSON.parse(row.payload) as Meal);
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

  async list(): Promise<ReadonlyArray<Recipe>> {
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

  async listActive(at: string): Promise<ReadonlyArray<NutritionGoal>> {
    const rows = await this.db.getAllAsync<PayloadRow>('SELECT payload FROM goals ORDER BY updated_at DESC');
    return rows
      .map((row) => JSON.parse(row.payload) as NutritionGoal)
      .filter((goal) => goal.effectiveFrom <= at && (!goal.effectiveUntil || goal.effectiveUntil > at));
  }
}

export class SqlitePrivateDataRepository implements PrivateDataRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async exportJson(): Promise<string> {
    const [foods, meals, recipes, goals] = await Promise.all([
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM foods'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM meals'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM recipes'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM goals'),
    ]);

    return JSON.stringify({
      foods: foods.map((row) => JSON.parse(row.payload)),
      meals: meals.map((row) => JSON.parse(row.payload)),
      recipes: recipes.map((row) => JSON.parse(row.payload)),
      goals: goals.map((row) => JSON.parse(row.payload)),
    });
  }

  async deleteAllPrivateData(): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await this.db.execAsync('DELETE FROM meals; DELETE FROM recipes; DELETE FROM goals; DELETE FROM foods;');
    });
  }
}
