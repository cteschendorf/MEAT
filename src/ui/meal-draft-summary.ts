import type { Food, MealItem, NutritionFacts } from '@/domain';
import type { MealItemId } from '@/domain/shared/ids';
import type { MealDraft } from '@/services/meals/meal-composer';
import {
  aggregateNutritionFacts,
  gramsForFoodPortion,
  scaleNutritionFacts,
} from '@/services/nutrition/engine';
import { formatCoreMetrics, type CoreMetric } from '@/ui/core-metrics';

/**
 * What each food in the draft contributes, and what the event adds up to.
 *
 * The composer showed a bare count ("Event foods · 3") and a grams box, so a
 * protein-first tracker asked the user to assemble a meal with no visibility of
 * the number they were assembling it for (THI-307).
 */

export interface DraftItemSummary {
  readonly itemId: MealItemId;
  readonly name: string;
  /** Resolved weight, or null when the portion cannot be resolved at all. */
  readonly gramWeight: number | null;
  readonly metrics: readonly CoreMetric[];
  readonly available: boolean;
}

export interface DraftSummary {
  readonly items: readonly DraftItemSummary[];
  readonly totals: readonly CoreMetric[];
  /** Items whose food or portion could not be resolved. */
  readonly unavailableCount: number;
}

function factsForItem(item: MealItem, food: Food | undefined): NutritionFacts | null {
  if (!food) return null;
  try {
    return scaleNutritionFacts(food.nutrition, gramsForFoodPortion(food, item.portion));
  } catch {
    return null;
  }
}

/** Resolved weight for display, covering serving-based portions with no stored grams. */
export function resolvedGramWeight(item: MealItem, food: Food | undefined): number | null {
  if (food) {
    try {
      return gramsForFoodPortion(food, item.portion);
    } catch {
      return null;
    }
  }
  return item.portion.gramWeight ?? null;
}

export function summarizeDraft(
  draft: MealDraft,
  foodById: ReadonlyMap<string, Food>,
): DraftSummary {
  const resolved: NutritionFacts[] = [];
  let unavailableCount = 0;

  const items = draft.items.map((item): DraftItemSummary => {
    const food = foodById.get(item.foodId);
    const facts = factsForItem(item, food);
    if (facts) {
      resolved.push(facts);
    } else {
      unavailableCount += 1;
    }
    return {
      itemId: item.id,
      name: food?.name ?? 'Unavailable food',
      gramWeight: resolvedGramWeight(item, food),
      metrics: formatCoreMetrics(facts),
      available: facts !== null,
    };
  });

  // Totals cover what could be resolved. The caller surfaces the unavailable
  // count alongside, rather than blanking an otherwise good running total —
  // a partial number with a caveat beats an em dash that hides real progress.
  const totals = formatCoreMetrics(resolved.length ? aggregateNutritionFacts(resolved) : null);
  return { items, totals, unavailableCount };
}
