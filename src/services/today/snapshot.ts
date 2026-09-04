import { coreNutrientDisplayOrder } from '@/domain';
import type { Food, Meal, NutrientValue, NutritionGoal } from '@/domain';
import type { FoodRepository, GoalRepository, MealRepository } from '@/data';
import { evaluateGoal, type GoalProgress } from '@/services/goals/engine';
import {
  aggregateNutritionFacts,
  gramsForFoodPortion,
  scaleNutritionFacts,
} from '@/services/nutrition/engine';

/** Re-exported from the domain so every surface shares one ordering. */
export const todayMetricCodes = coreNutrientDisplayOrder;

export type TodayMetricCode = (typeof todayMetricCodes)[number];

export interface TodayMetric {
  code: TodayMetricCode;
  value: number | null;
  state: 'known' | 'unknown' | 'estimated';
  goal: GoalProgress | null;
}

export interface TodaySnapshot {
  dateKey: string;
  meals: readonly Meal[];
  metrics: readonly TodayMetric[];
  unavailableItems: readonly TodayUnavailableItem[];
}

export interface TodayUnavailableItem {
  mealId: Meal['id'];
  itemId: Meal['items'][number]['id'];
  foodId: Meal['items'][number]['foodId'];
}

export function localDayRange(date: Date): { start: string; end: string; dateKey: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const dateKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  return { start: start.toISOString(), end: end.toISOString(), dateKey };
}

async function foodsForMeals(meals: readonly Meal[], repo: FoodRepository): Promise<Map<string, Food>> {
  const ids = [...new Set(meals.flatMap((meal) => meal.items.map((item) => item.foodId)))];
  const values = await Promise.allSettled(ids.map((id) => repo.getById(id)));
  const map = new Map<string, Food>();
  values.forEach((result, index) => {
    const requestedId = ids[index];
    if (result.status !== 'fulfilled' || !result.value || result.value.id !== requestedId) return;
    map.set(result.value.id, result.value);
  });
  return map;
}

function nutritionForAvailableItems(meals: readonly Meal[], foods: ReadonlyMap<string, Food>) {
  const facts = [];
  const unavailableItems: TodayUnavailableItem[] = [];

  for (const meal of meals) {
    for (const item of meal.items) {
      const food = foods.get(item.foodId);
      if (!food) {
        unavailableItems.push({ mealId: meal.id, itemId: item.id, foodId: item.foodId });
        continue;
      }
      try {
        facts.push(
          scaleNutritionFacts(food.nutrition, gramsForFoodPortion(food, item.portion)),
        );
      } catch {
        unavailableItems.push({ mealId: meal.id, itemId: item.id, foodId: item.foodId });
      }
    }
  }

  return { totals: aggregateNutritionFacts(facts), unavailableItems };
}

export async function buildTodaySnapshot(
  date: Date,
  repos: { meals: MealRepository; foods: FoodRepository; goals: GoalRepository },
): Promise<TodaySnapshot> {
  const range = localDayRange(date);
  const meals = await repos.meals.listByDateRange(range.start, range.end);
  const foods = await foodsForMeals(meals, repos.foods);
  const { totals, unavailableItems } = nutritionForAvailableItems(meals, foods);
  const goals = await repos.goals.listActive(range.end);
  const goalByCode = new Map<string, NutritionGoal>(goals.map((goal) => [goal.nutrientCode, goal]));
  const totalsAreComplete = unavailableItems.length === 0;

  const metrics = todayMetricCodes.map((code) => {
    const entry = totals.nutrients.find((nutrient) => nutrient.nutrient.code === code) as NutrientValue | undefined;
    const value = totalsAreComplete ? (entry?.value ?? null) : null;
    const goal = goalByCode.get(code);
    return {
      code,
      value,
      state: totalsAreComplete ? (entry?.state ?? 'unknown') : 'unknown',
      goal: goal && value !== null ? evaluateGoal(goal, value) : null,
    } satisfies TodayMetric;
  });

  return { dateKey: range.dateKey, meals, metrics, unavailableItems };
}
