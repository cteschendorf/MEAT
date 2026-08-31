import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, Meal, MediaAsset, NutritionGoal, Recipe, SavedMeal, UserPreferences } from '@/domain';
import type { FoodId, ISODateTime, MealId, MediaId, RecipeId, SavedMealId } from '@/domain/shared/ids';
import type {
  ComposerDraftRecord,
  ComposerDraftRepository,
  FavoriteFoodRepository,
  FoodReferenceRepository,
  FoodRepository,
  GoalRepository,
  MealRepository,
  MediaRepository,
  PrivateDataRepository,
  RecipeRepository,
  SavedMealRepository,
  UserPreferencesRepository,
} from '@/data/repositories/contracts';

type PayloadRow = { payload: string };
type FavoriteRow = { food_id: FoodId; updated_at: string };
type PreferencesRow = { payload: string; onboarding_completed: number; updated_at: string };
type MediaRow = {
  id: MediaId;
  meal_id: MealId | null;
  kind: MediaAsset['kind'];
  storage: MediaAsset['storage'];
  uri: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: number;
  created_at: ISODateTime;
  updated_at: ISODateTime;
};

function parsePayload<T>(row: PayloadRow | null): T | null {
  return row ? (JSON.parse(row.payload) as T) : null;
}

function mediaAssetFromRow(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    kind: row.kind,
    storage: row.storage,
    uri: row.uri,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: row.byte_size,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function placeholders(length: number): string {
  return new Array(length).fill('?').join(', ');
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

  async search(query: string, limit = 30): Promise<readonly Food[]> {
    const terms = query
      .trim()
      .toLocaleLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (terms.length === 0) return [];
    const foods = await this.list(Math.max(limit * 20, 500));
    return foods
      .filter((food) => {
        const haystack = `${food.name} ${food.brand ?? ''} ${food.barcode ?? ''}`.toLocaleLowerCase();
        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, limit);
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
      `SELECT payload FROM meals
       WHERE occurred_at >= ? AND occurred_at < ?
       ORDER BY occurred_at ASC, json_extract(payload, '$.createdAt') ASC, id ASC`,
      start,
      end,
    );
    return rows.map((row) => JSON.parse(row.payload) as Meal);
  }

  async listRecent(limit = 250): Promise<readonly Meal[]> {
    const rows = await this.db.getAllAsync<PayloadRow>(
      `SELECT payload FROM meals
       ORDER BY occurred_at DESC, json_extract(payload, '$.createdAt') DESC, id DESC
       LIMIT ?`,
      limit,
    );
    return rows.map((row) => JSON.parse(row.payload) as Meal);
  }
}

export class SqliteMediaRepository implements MediaRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async getById(id: MediaId): Promise<MediaAsset | null> {
    const row = await this.db.getFirstAsync<MediaRow>('SELECT * FROM media_assets WHERE id = ?', id);
    return row ? mediaAssetFromRow(row) : null;
  }

  async list(limit = 1_000): Promise<readonly MediaAsset[]> {
    const rows = await this.db.getAllAsync<MediaRow>(
      'SELECT * FROM media_assets ORDER BY created_at ASC, id ASC LIMIT ?',
      limit,
    );
    return rows.map(mediaAssetFromRow);
  }

  async listByIds(ids: readonly MediaId[]): Promise<readonly MediaAsset[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.getAllAsync<MediaRow>(
      `SELECT * FROM media_assets WHERE id IN (${placeholders(ids.length)})`,
      ...ids,
    );
    const byId = new Map(rows.map((row) => [row.id, mediaAssetFromRow(row)]));
    return ids.flatMap((id) => {
      const asset = byId.get(id);
      return asset ? [asset] : [];
    });
  }

  async listByMealId(mealId: MealId): Promise<readonly MediaAsset[]> {
    const rows = await this.db.getAllAsync<MediaRow>(
      'SELECT * FROM media_assets WHERE meal_id = ? ORDER BY created_at ASC, id ASC',
      mealId,
    );
    return rows.map(mediaAssetFromRow);
  }

  async listUnattachedBefore(cutoff: ISODateTime, limit = 100): Promise<readonly MediaAsset[]> {
    const rows = await this.db.getAllAsync<MediaRow>(
      `SELECT * FROM media_assets
       WHERE meal_id IS NULL AND created_at < ?
       ORDER BY created_at ASC, id ASC LIMIT ?`,
      cutoff,
      limit,
    );
    return rows.map(mediaAssetFromRow);
  }

  async save(asset: MediaAsset): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO media_assets (
         id, meal_id, kind, storage, uri, mime_type, width, height, byte_size, created_at, updated_at
       ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         storage = excluded.storage,
         uri = excluded.uri,
         mime_type = excluded.mime_type,
         width = excluded.width,
         height = excluded.height,
         byte_size = excluded.byte_size,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`,
      asset.id,
      asset.kind,
      asset.storage,
      asset.uri,
      asset.mimeType,
      asset.width,
      asset.height,
      asset.byteSize,
      asset.createdAt,
      asset.updatedAt,
    );
  }

  async saveMany(assets: readonly MediaAsset[]): Promise<void> {
    for (const asset of assets) await this.save(asset);
  }

  async attachToMeal(ids: readonly MediaId[], mealId: MealId, updatedAt: ISODateTime): Promise<void> {
    if (ids.length === 0) return;
    const rows = await this.db.getAllAsync<{ id: MediaId; meal_id: MealId | null }>(
      `SELECT id, meal_id FROM media_assets WHERE id IN (${placeholders(ids.length)})`,
      ...ids,
    );
    const byId = new Map(rows.map((row) => [row.id, row.meal_id]));
    for (const id of ids) {
      if (!byId.has(id)) throw new Error(`Media asset ${id} does not exist.`);
      const owner = byId.get(id);
      if (owner && owner !== mealId) throw new Error(`Media asset ${id} belongs to another meal.`);
    }
    await this.db.runAsync(
      `UPDATE media_assets SET meal_id = ?, updated_at = ?
       WHERE id IN (${placeholders(ids.length)}) AND (meal_id IS NULL OR meal_id = ?)`,
      mealId,
      updatedAt,
      ...ids,
      mealId,
    );
    const attached = await this.db.getAllAsync<{ id: MediaId; meal_id: MealId | null }>(
      `SELECT id, meal_id FROM media_assets WHERE id IN (${placeholders(ids.length)})`,
      ...ids,
    );
    if (attached.some((row) => row.meal_id !== mealId)) {
      throw new Error('One or more media assets could not be attached to this meal.');
    }
  }

  async detachFromMeal(ids: readonly MediaId[], mealId: MealId, updatedAt: ISODateTime): Promise<void> {
    if (ids.length === 0) return;
    await this.db.runAsync(
      `UPDATE media_assets SET meal_id = NULL, updated_at = ?
       WHERE meal_id = ? AND id IN (${placeholders(ids.length)})`,
      updatedAt,
      mealId,
      ...ids,
    );
  }

  async delete(id: MediaId): Promise<void> {
    await this.db.runAsync('DELETE FROM media_assets WHERE id = ?', id);
  }

  async deleteMany(ids: readonly MediaId[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.runAsync(
      `DELETE FROM media_assets WHERE id IN (${placeholders(ids.length)})`,
      ...ids,
    );
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
      'SELECT food_id, updated_at FROM favorite_food_refs ORDER BY updated_at DESC, food_id ASC',
    );
    return rows.map((row) => row.food_id);
  }

  async setFavorite(foodId: FoodId, favorite: boolean, updatedAt: string): Promise<void> {
    if (!favorite) {
      await this.db.runAsync('DELETE FROM favorite_food_refs WHERE food_id = ?', foodId);
      return;
    }

    await this.db.runAsync(
      `INSERT INTO favorite_food_refs (food_id, updated_at) VALUES (?, ?)
       ON CONFLICT(food_id) DO UPDATE SET updated_at = excluded.updated_at`,
      foodId,
      updatedAt,
    );
  }
}

export class SqliteFoodReferenceRepository implements FoodReferenceRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async listKnownIds(limit = 200): Promise<readonly FoodId[]> {
    const rows = await this.db.getAllAsync<{ food_id: FoodId }>(
      'SELECT food_id FROM known_food_refs ORDER BY updated_at DESC, food_id ASC LIMIT ?',
      limit,
    );
    return rows.map((row) => row.food_id);
  }

  async touch(foodId: FoodId, updatedAt: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO known_food_refs (food_id, updated_at) VALUES (?, ?)
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
    const [foods, meals, mediaAssets, savedMeals, recipes, goals, favoriteFoods, knownFoodRefs, preferences] = await Promise.all([
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM foods'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM meals'),
      this.db.getAllAsync<MediaRow>('SELECT * FROM media_assets ORDER BY created_at ASC, id ASC'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM saved_meals'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM recipes'),
      this.db.getAllAsync<PayloadRow>('SELECT payload FROM goals'),
      this.db.getAllAsync<FavoriteRow>('SELECT food_id, updated_at FROM favorite_food_refs ORDER BY updated_at DESC'),
      this.db.getAllAsync<FavoriteRow>('SELECT food_id, updated_at FROM known_food_refs ORDER BY updated_at DESC'),
      this.db.getFirstAsync<PreferencesRow>(
        'SELECT payload, onboarding_completed, updated_at FROM user_preferences WHERE singleton_id = 1',
      ),
    ]);

    return JSON.stringify({
      foods: foods.map((row) => JSON.parse(row.payload)),
      meals: meals.map((row) => JSON.parse(row.payload)),
      mediaAssets: mediaAssets.map(mediaAssetFromRow),
      savedMeals: savedMeals.map((row) => JSON.parse(row.payload)),
      recipes: recipes.map((row) => JSON.parse(row.payload)),
      goals: goals.map((row) => JSON.parse(row.payload)),
      favoriteFoods,
      knownFoodRefs,
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
        'DELETE FROM composer_drafts; DELETE FROM favorite_food_refs; DELETE FROM known_food_refs; DELETE FROM media_assets; DELETE FROM meals; DELETE FROM saved_meals; DELETE FROM recipes; DELETE FROM goals; DELETE FROM foods; DELETE FROM user_preferences;',
      );
    });
  }
}

type ComposerDraftRow = { id: string; payload: string; updated_at: string };

export class SqliteComposerDraftRepository implements ComposerDraftRepository {
  constructor(private readonly db: SQLiteDatabase) {}

  async list(): Promise<readonly ComposerDraftRecord[]> {
    const rows = await this.db.getAllAsync<ComposerDraftRow>(
      'SELECT id, payload, updated_at FROM composer_drafts ORDER BY updated_at DESC',
    );
    return rows.map((row) => ({ id: row.id, payload: row.payload, updatedAt: row.updated_at }));
  }

  async save(record: ComposerDraftRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO composer_drafts (id, payload, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      record.id,
      record.payload,
      record.updatedAt,
    );
  }

  async delete(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM composer_drafts WHERE id = ?', id);
  }

  async deleteAll(): Promise<void> {
    await this.db.execAsync('DELETE FROM composer_drafts;');
  }
}
