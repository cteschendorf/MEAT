import type { Food, Meal, Recipe, SavedMeal, SavedMealItem } from '@/domain';
import { foodIdForRef, sourceIdFromFoodId, type FoodRef } from '@/domain/food/source';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  RecipeId,
  SavedMealId,
  SourceRecordId,
} from '@/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  RecipeRepository,
  SavedMealRepository,
} from '@/data/repositories/contracts';
import { nutritionPerRecipeServing } from '@/services/nutrition/engine';

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
}

function defaultIdFactory(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

export function foodRefForFoodId(foodId: FoodId): FoodRef {
  const sourceId = sourceIdFromFoodId(foodId);
  if (!sourceId) {
    return { sourceId: 'personal', recordId: String(foodId) as SourceRecordId };
  }
  const separator = foodId.indexOf(':');
  const encoded = separator < 0 ? String(foodId) : foodId.slice(separator + 1);
  try {
    return { sourceId, recordId: decodeURIComponent(encoded) as SourceRecordId };
  } catch {
    return { sourceId, recordId: encoded as SourceRecordId };
  }
}

export function resolvedFoodId(value: { foodId: FoodId; foodRef?: FoodRef }): FoodId {
  if (!value.foodRef) return value.foodId;
  // Build 1 personal records used unscoped `food:*` IDs. A source-aware edit
  // may add a personal FoodRef, but the repository and historical meals must
  // continue to address the original ID rather than a newly encoded alias.
  if (value.foodRef.sourceId === 'personal' && sourceIdFromFoodId(value.foodId) === null) {
    return value.foodId;
  }
  return foodIdForRef(value.foodRef);
}

/** Legacy unversioned ID retained for resolving build-1 recipe history. */
export function recipeFoodId(recipeId: RecipeId): FoodId {
  return `recipe:${recipeId}` as FoodId;
}

/** Legacy unversioned serving ID retained for compatibility. */
export function recipeServingId(recipeId: RecipeId): FoodServingId {
  return `recipe-serving:${recipeId}` as FoodServingId;
}

function recipeRevisionFingerprint(recipe: Recipe): string {
  const payload = JSON.stringify({
    name: recipe.name,
    ingredients: recipe.ingredients.map((ingredient) => ({
      foodId: ingredient.foodId,
      foodRef: ingredient.foodRef
        ? [ingredient.foodRef.sourceId, ingredient.foodRef.recordId]
        : null,
      quantity: ingredient.quantity,
      gramWeight: ingredient.gramWeight ?? null,
      note: ingredient.note ?? null,
    })),
    yieldServings: recipe.yieldServings,
    totalYieldGrams: recipe.totalYieldGrams ?? null,
    instructions: recipe.instructions ?? null,
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Stable identity for one immutable materialized revision of a recipe. */
export function recipeRevisionFoodId(recipe: Recipe): FoodId {
  return `recipe-snapshot:v1:${encodeURIComponent(recipe.id)}:${encodeURIComponent(recipe.updatedAt)}:${recipeRevisionFingerprint(recipe)}` as FoodId;
}

export function recipeRevisionServingId(recipe: Recipe): FoodServingId {
  return `recipe-serving-snapshot:v1:${encodeURIComponent(recipe.id)}:${encodeURIComponent(recipe.updatedAt)}:${recipeRevisionFingerprint(recipe)}` as FoodServingId;
}

export function recipeServingGrams(recipe: Recipe): number {
  requirePositive(recipe.yieldServings, 'Recipe yield');
  for (const ingredient of recipe.ingredients) {
    requirePositive(ingredient.quantity, 'Recipe ingredient quantity');
    if (ingredient.gramWeight !== undefined) {
      requirePositive(ingredient.gramWeight, 'Recipe ingredient gram weight');
    }
  }
  const totalGrams =
    recipe.totalYieldGrams ??
    (recipe.ingredients.every((ingredient) => ingredient.gramWeight !== undefined)
      ? recipe.ingredients.reduce((sum, ingredient) => sum + (ingredient.gramWeight ?? 0), 0)
      : undefined);
  if (totalGrams === undefined || totalGrams <= 0) {
    throw new Error('Recipe requires total yield grams or gram weights for every ingredient before logging.');
  }
  return totalGrams / recipe.yieldServings;
}

export function recipeGramsForServings(recipe: Recipe, servings: number): number {
  requirePositive(servings, 'Recipe servings to log');
  return recipeServingGrams(recipe) * servings;
}

function foodForIngredient(
  ingredient: Recipe['ingredients'][number],
  foods: ReadonlyMap<string, Food>,
): Food | undefined {
  return foods.get(resolvedFoodId(ingredient)) ?? foods.get(ingredient.foodId);
}

export function materializeRecipeFood(recipe: Recipe, foods: ReadonlyMap<string, Food>): Food {
  const servingGrams = recipeServingGrams(recipe);
  const calculationFoods = new Map<string, Food>();
  const calculationRecipe: Recipe = {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => {
      const food = foodForIngredient(ingredient, foods);
      if (!food) throw new Error(`Missing ingredient food ${resolvedFoodId(ingredient)}.`);
      calculationFoods.set(food.id, food);
      return { ...ingredient, foodId: food.id };
    }),
  };
  const perServing = nutritionPerRecipeServing(calculationRecipe, calculationFoods);
  const id = recipeRevisionFoodId(recipe);
  return {
    id,
    kind: 'recipe',
    name: recipe.name,
    nutrition: { ...perServing, basisGrams: servingGrams },
    servings: [
      {
        id: recipeRevisionServingId(recipe),
        foodId: id,
        label: 'serving',
        gramWeight: servingGrams,
        quantity: 1,
        unit: 'serving',
        isDefault: true,
      },
    ],
    primarySource: {
      kind: 'user-entered',
      provider: 'MEAT recipe snapshot v1',
      recordId: String(id) as SourceRecordId,
    },
    createdAt: recipe.updatedAt,
    updatedAt: recipe.updatedAt,
  };
}

export class RecipeService {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly foods: FoodRepository,
    private readonly idFactory: (prefix: string) => string = defaultIdFactory,
  ) {}

  async getById(recipeId: RecipeId): Promise<Recipe | null> {
    return this.recipes.getById(recipeId);
  }

  async list(): Promise<readonly Recipe[]> {
    return this.recipes.list();
  }

  private validate(recipe: Recipe): void {
    requirePositive(recipe.yieldServings, 'Recipe yield');
    if (!recipe.name.trim()) throw new Error('Recipe name is required.');
    if (recipe.ingredients.length === 0) throw new Error('Recipe must contain at least one ingredient.');
    if (recipe.totalYieldGrams !== undefined) requirePositive(recipe.totalYieldGrams, 'Recipe total yield');

    for (const ingredient of recipe.ingredients) {
      requirePositive(ingredient.quantity, 'Recipe ingredient quantity');
      if (ingredient.gramWeight === undefined) {
        throw new Error(`Recipe ingredient ${resolvedFoodId(ingredient)} requires gram weight.`);
      }
      requirePositive(ingredient.gramWeight, 'Recipe ingredient gram weight');
    }
  }

  private async materialize(recipe: Recipe): Promise<Food> {
    const ingredientFoods = new Map<string, Food>();
    for (const ingredient of recipe.ingredients) {
      const requestedId = resolvedFoodId(ingredient);
      const food =
        (await this.foods.getById(requestedId)) ??
        (requestedId === ingredient.foodId ? null : await this.foods.getById(ingredient.foodId));
      if (!food) throw new Error(`Missing ingredient food ${requestedId}.`);
      ingredientFoods.set(food.id, food);
      ingredientFoods.set(ingredient.foodId, food);
      ingredientFoods.set(requestedId, food);
    }

    return materializeRecipeFood(recipe, ingredientFoods);
  }

  async save(recipe: Recipe): Promise<Food> {
    this.validate(recipe);
    const revisionId = recipeRevisionFoodId(recipe);
    const existing = await this.foods.getById(revisionId);
    const recipeFood = existing ?? (await this.materialize(recipe));
    if (!existing) await this.foods.save(recipeFood);
    // Publish recipe metadata only after its immutable logging snapshot exists.
    await this.recipes.save(recipe);
    return recipeFood;
  }

  async resolveRevisionFood(recipe: Recipe): Promise<Food> {
    const revisionId = recipeRevisionFoodId(recipe);
    const existing = await this.foods.getById(revisionId);
    if (existing) return existing;

    this.validate(recipe);
    const recipeFood = await this.materialize(recipe);
    await this.foods.save(recipeFood);
    return recipeFood;
  }

  duplicate(recipe: Recipe, now: ISODateTime, name = `${recipe.name} copy`): Recipe {
    return {
      ...recipe,
      id: this.idFactory('recipe') as RecipeId,
      name,
      ingredients: recipe.ingredients.map((ingredient) => ({
        ...ingredient,
        ...(ingredient.foodRef ? { foodRef: { ...ingredient.foodRef } } : {}),
      })),
      createdAt: now,
      updatedAt: now,
    };
  }

  async delete(recipeId: RecipeId): Promise<void> {
    await this.recipes.delete(recipeId);
    // Recipe foods are immutable history records. This intentionally retains
    // both revisioned snapshots and the legacy unversioned `recipe:<id>` food.
  }
}

export class SavedMealService {
  constructor(
    private readonly savedMeals: SavedMealRepository,
    private readonly meals: MealRepository,
    private readonly idFactory: (prefix: string) => string,
  ) {}

  async getById(savedMealId: SavedMealId): Promise<SavedMeal | null> {
    return this.savedMeals.getById(savedMealId);
  }

  async list(): Promise<readonly SavedMeal[]> {
    return this.savedMeals.list();
  }

  async save(savedMeal: SavedMeal): Promise<void> {
    if (!savedMeal.name.trim()) throw new Error('Saved meal name is required.');
    if (savedMeal.items.length === 0) throw new Error('Saved meal must contain at least one item.');
    for (const item of savedMeal.items) {
      requirePositive(item.portion.quantity, 'Saved meal item quantity');
      if (item.portion.gramWeight !== undefined) {
        requirePositive(item.portion.gramWeight, 'Saved meal item gram weight');
      }
    }
    await this.savedMeals.save(savedMeal);
  }

  async delete(savedMealId: SavedMealId): Promise<void> {
    await this.savedMeals.delete(savedMealId);
  }

  duplicate(savedMeal: SavedMeal, now: ISODateTime, name = `${savedMeal.name} copy`): SavedMeal {
    return {
      ...savedMeal,
      id: this.idFactory('saved-meal') as SavedMealId,
      name,
      items: savedMeal.items.map((item) => ({
        ...item,
        ...(item.foodRef ? { foodRef: { ...item.foodRef } } : {}),
        portion: { ...item.portion },
      })),
      createdAt: now,
      updatedAt: now,
    };
  }

  instantiate(savedMeal: SavedMeal, occurredAt: ISODateTime): Meal {
    return {
      id: this.idFactory('meal') as MealId,
      title: savedMeal.name,
      occurredAt,
      items: savedMeal.items.map((item) => this.instantiateItem(item)),
      mediaIds: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  }

  async log(savedMeal: SavedMeal, occurredAt: ISODateTime): Promise<Meal> {
    const meal = this.instantiate(savedMeal, occurredAt);
    await this.meals.save(meal);
    return meal;
  }

  private instantiateItem(item: SavedMealItem) {
    return {
      id: this.idFactory('item') as MealItemId,
      foodId: resolvedFoodId(item),
      ...(item.foodRef ? { foodRef: { ...item.foodRef } } : {}),
      portion: { ...item.portion },
      ...(item.recipeId ? { recipeId: item.recipeId } : {}),
      ...(item.note ? { note: item.note } : {}),
    };
  }
}
