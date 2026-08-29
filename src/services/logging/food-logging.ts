import type { Food, Meal, NutrientDefinition, NutrientValue } from '@/domain';
import { foodIdForRef } from '@/domain/food/source';
import type { FoodServingId, ISODateTime, MealId, MealItemId, SourceRecordId } from '@/domain/shared/ids';
import type { FoodRepository, MealRepository } from '@/data/repositories/contracts';

export interface ManualFoodInput {
  name: string;
  brand?: string;
  servingLabel?: string;
  servingGrams: number;
  calories?: number;
  protein?: number;
  carbohydrate?: number;
  fat?: number;
  fiber?: number;
}

type ManualNutrientKey = keyof Pick<
  ManualFoodInput,
  'calories' | 'protein' | 'carbohydrate' | 'fat' | 'fiber'
>;

const definitions: readonly [string, string, 'kcal' | 'g', ManualNutrientKey][] = [
  ['energy-kcal', 'Calories', 'kcal', 'calories'],
  ['protein-g', 'Protein', 'g', 'protein'],
  ['carbohydrate-g', 'Carbohydrates', 'g', 'carbohydrate'],
  ['fat-g', 'Fat', 'g', 'fat'],
  ['fiber-g', 'Fiber', 'g', 'fiber'],
];

function requireFinitePositive(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message);
}

export class FoodLoggingService {
  constructor(
    private readonly foods: FoodRepository,
    private readonly meals: MealRepository,
    private readonly idFactory: (prefix: string) => string,
  ) {}

  async createManualFood(input: ManualFoodInput, now: ISODateTime): Promise<Food> {
    if (!input.name.trim()) throw new Error('Food name is required.');
    requireFinitePositive(input.servingGrams, 'Serving grams must be a finite number greater than zero.');
    for (const [, name, , key] of definitions) {
      const value = input[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${name} must be a finite nonnegative number.`);
      }
    }

    const scale = 100 / input.servingGrams;
    const nutrients: NutrientValue[] = definitions.map(([code, name, unit, key]) => {
      const definition: NutrientDefinition = { code, name, unit };
      const supplied = input[key];
      return supplied === undefined
        ? { nutrient: definition, state: 'unknown' }
        : {
            nutrient: definition,
            state: 'known',
            value: supplied * scale,
            source: { kind: 'user-entered', provider: 'MEAT manual food' },
          };
    });
    const recordId = this.idFactory('food') as SourceRecordId;
    const id = foodIdForRef({ sourceId: 'personal', recordId });
    const food: Food = {
      id,
      kind: 'custom',
      name: input.name.trim(),
      ...(input.brand?.trim() ? { brand: input.brand.trim() } : {}),
      nutrition: { basisGrams: 100, nutrients },
      servings: [
        {
          id: this.idFactory('serving') as FoodServingId,
          foodId: id,
          label: input.servingLabel?.trim() || 'serving',
          gramWeight: input.servingGrams,
          quantity: 1,
          unit: 'serving',
          isDefault: true,
        },
      ],
      primarySource: { kind: 'user-entered', provider: 'MEAT personal food', recordId },
      createdAt: now,
      updatedAt: now,
    };
    await this.foods.save(food);
    return food;
  }

  async logFood(food: Food, gramWeight: number, occurredAt: ISODateTime): Promise<Meal> {
    requireFinitePositive(gramWeight, 'Portion must be a finite number greater than zero grams.');
    const meal: Meal = {
      id: this.idFactory('meal') as MealId,
      occurredAt,
      items: [
        {
          id: this.idFactory('item') as MealItemId,
          foodId: food.id,
          portion: { quantity: 1, gramWeight },
        },
      ],
      mediaIds: [],
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    // Search-corpus foods must be retained locally once used so history can resolve them offline.
    await this.foods.save(food);
    await this.meals.save(meal);
    return meal;
  }

  async updateMealItemPortion(
    meal: Meal,
    itemId: MealItemId,
    gramWeight: number,
    now: ISODateTime,
  ): Promise<Meal> {
    requireFinitePositive(gramWeight, 'Portion must be a finite number greater than zero grams.');
    const items = meal.items.map((item) =>
      item.id === itemId ? { ...item, portion: { ...item.portion, gramWeight } } : item,
    );
    const updated = { ...meal, items, updatedAt: now };
    await this.meals.save(updated);
    return updated;
  }

  async deleteMealItem(meal: Meal, itemId: MealItemId, now: ISODateTime): Promise<Meal | null> {
    const items = meal.items.filter((item) => item.id !== itemId);
    if (items.length === 0) {
      await this.meals.delete(meal.id);
      return null;
    }
    const updated = { ...meal, items, updatedAt: now };
    await this.meals.save(updated);
    return updated;
  }
}

export const defaultLocalIdFactory = (prefix: string) =>
  `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
