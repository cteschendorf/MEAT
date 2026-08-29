import type { Food, Meal, Recipe, SavedMeal, SavedMealItem } from '@/domain';
import type {
  FoodId,
  FoodServingId,
  ISODateTime,
  MealId,
  MealItemId,
  RecipeId,
  SavedMealId,
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

export function recipeFoodId(recipeId: RecipeId): FoodId {
  return `recipe:${recipeId}` as FoodId;
}

export function recipeServingId(recipeId: RecipeId): FoodServingId {
  return `recipe-serving:${recipeId}` as FoodServingId;
}

export function recipeServingGrams(recipe: Recipe): number {
  requirePositive(recipe.yieldServings, 'Recipe yield');
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

export function materializeRecipeFood(recipe: Recipe, foods: ReadonlyMap<string, Food>): Food {
  const servingGrams = recipeServingGrams(recipe);
  const perServing = nutritionPerRecipeServing(recipe, foods);
  const id = recipeFoodId(recipe.id);
  return {
    id,
    kind: 'recipe',
    name: recipe.name,
    nutrition: { ...perServing, basisGrams: servingGrams },
    servings: [
      {
        id: recipeServingId(recipe.id),
        foodId: id,
        label: 'serving',
        gramWeight: servingGrams,
        quantity: 1,
        unit: 'serving',
        isDefault: true,
      },
    ],
    primarySource: { kind: 'user-entered', provider: 'MEAT recipe' },
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

export class RecipeService {
  constructor(
    private readonly recipes: RecipeRepository,
    private readonly foods: FoodRepository,
  ) {}

  async save(recipe: Recipe): Promise<Food> {
    requirePositive(recipe.yieldServings, 'Recipe yield');
    if (!recipe.name.trim()) throw new Error('Recipe name is required.');
    if (recipe.ingredients.length === 0) throw new Error('Recipe must contain at least one ingredient.');

    const ingredientFoods = new Map<string, Food>();
    for (const ingredient of recipe.ingredients) {
      const food = await this.foods.getById(ingredient.foodId);
      if (!food) throw new Error(`Missing ingredient food ${ingredient.foodId}.`);
      ingredientFoods.set(food.id, food);
    }

    const recipeFood = materializeRecipeFood(recipe, ingredientFoods);
    await this.recipes.save(recipe);
    await this.foods.save(recipeFood);
    return recipeFood;
  }

  async delete(recipeId: RecipeId): Promise<void> {
    await this.recipes.delete(recipeId);
    await this.foods.delete(recipeFoodId(recipeId));
  }
}

export class SavedMealService {
  constructor(
    private readonly savedMeals: SavedMealRepository,
    private readonly meals: MealRepository,
    private readonly idFactory: (prefix: string) => string,
  ) {}

  async save(savedMeal: SavedMeal): Promise<void> {
    if (!savedMeal.name.trim()) throw new Error('Saved meal name is required.');
    if (savedMeal.items.length === 0) throw new Error('Saved meal must contain at least one item.');
    for (const item of savedMeal.items) requirePositive(item.portion.quantity, 'Saved meal item quantity');
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
      items: savedMeal.items.map((item) => ({ ...item, portion: { ...item.portion } })),
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
      foodId: item.foodId,
      portion: { ...item.portion },
      ...(item.recipeId ? { recipeId: item.recipeId } : {}),
      ...(item.note ? { note: item.note } : {}),
    };
  }
}
