import type { Food, Meal } from '@/domain';
import type { FoodId, ISODateTime } from '@/domain/shared/ids';
import type { FavoriteFoodRepository, FoodRepository } from '@/data/repositories/contracts';

export type FoodLoggingContext = 'morning' | 'midday' | 'evening' | 'overnight';

export interface RecentMealReader {
  listRecent(limit?: number): Promise<readonly Meal[]>;
}

export interface RankedFoodUsage {
  foodId: FoodId;
  favorite: boolean;
  logCount: number;
  contextLogCount: number;
  lastLoggedAt?: ISODateTime;
  lastGramWeight?: number;
  score: number;
}

export interface FoodSuggestion extends RankedFoodUsage {
  food: Food;
  suggestedGramWeight: number;
}

interface MutableFoodUsage {
  foodId: FoodId;
  logCount: number;
  contextLogCount: number;
  lastLoggedAt?: ISODateTime;
  lastGramWeight?: number;
}

function contextForHour(hour: number): FoodLoggingContext {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 16) return 'midday';
  if (hour >= 16 && hour < 22) return 'evening';
  return 'overnight';
}

export function getFoodLoggingContext(date: Date): FoodLoggingContext {
  return contextForHour(date.getHours());
}

export function rankFoodUsage(
  meals: readonly Meal[],
  favoriteIds: readonly FoodId[],
  now: ISODateTime,
  limit = 50,
): readonly RankedFoodUsage[] {
  const currentContext = getFoodLoggingContext(new Date(now));
  const usageByFood = new Map<FoodId, MutableFoodUsage>();

  for (const meal of meals) {
    const mealContext = getFoodLoggingContext(new Date(meal.occurredAt));
    for (const item of meal.items) {
      const existing = usageByFood.get(item.foodId) ?? {
        foodId: item.foodId,
        logCount: 0,
        contextLogCount: 0,
      };
      existing.logCount += 1;
      if (mealContext === currentContext) existing.contextLogCount += 1;
      if (!existing.lastLoggedAt || meal.occurredAt > existing.lastLoggedAt) {
        existing.lastLoggedAt = meal.occurredAt;
        if (item.portion.gramWeight !== undefined) existing.lastGramWeight = item.portion.gramWeight;
      }
      usageByFood.set(item.foodId, existing);
    }
  }

  const favorites = new Set(favoriteIds);
  for (const foodId of favorites) {
    if (!usageByFood.has(foodId)) {
      usageByFood.set(foodId, { foodId, logCount: 0, contextLogCount: 0 });
    }
  }

  const nowMs = new Date(now).getTime();
  const ranked = [...usageByFood.values()].map<RankedFoodUsage>((usage) => {
    const favorite = favorites.has(usage.foodId);
    const lastMs = usage.lastLoggedAt ? new Date(usage.lastLoggedAt).getTime() : Number.NaN;
    const ageDays = Number.isFinite(lastMs) ? Math.max(0, (nowMs - lastMs) / 86_400_000) : Number.POSITIVE_INFINITY;
    const favoriteScore = favorite ? 1_000 : 0;
    const recencyScore = Number.isFinite(ageDays) ? Math.max(0, 300 - ageDays * 12) : 0;
    const frequencyScore = Math.min(usage.logCount, 30) * 15;
    const contextScore = Math.min(usage.contextLogCount, 10) * 25;

    return {
      ...usage,
      favorite,
      score: favoriteScore + recencyScore + frequencyScore + contextScore,
    };
  });

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    const lastComparison = (b.lastLoggedAt ?? '').localeCompare(a.lastLoggedAt ?? '');
    if (lastComparison !== 0) return lastComparison;
    return String(a.foodId).localeCompare(String(b.foodId));
  });

  return ranked.slice(0, limit);
}

export class FoodSuggestionsService {
  constructor(
    private readonly mealHistory: RecentMealReader,
    private readonly foods: FoodRepository,
    private readonly favorites: FavoriteFoodRepository,
  ) {}

  async listSuggestions(now: ISODateTime, limit = 8): Promise<readonly FoodSuggestion[]> {
    const [meals, favoriteIds] = await Promise.all([
      this.mealHistory.listRecent(250),
      this.favorites.listFavoriteIds(),
    ]);
    const ranked = rankFoodUsage(meals, favoriteIds, now, Math.max(limit * 4, 24));
    const resolved = await Promise.all(
      ranked.map(async (usage): Promise<FoodSuggestion | null> => {
        const food = await this.foods.getById(usage.foodId);
        if (!food) return null;
        const defaultServing = food.servings.find((serving) => serving.isDefault) ?? food.servings[0];
        return {
          ...usage,
          food,
          suggestedGramWeight: usage.lastGramWeight ?? defaultServing?.gramWeight ?? 100,
        };
      }),
    );

    return resolved.filter((suggestion): suggestion is FoodSuggestion => suggestion !== null).slice(0, limit);
  }

  async setFavorite(food: Food, favorite: boolean, now: ISODateTime): Promise<void> {
    await this.foods.save(food);
    await this.favorites.setFavorite(food.id, favorite, now);
  }
}
