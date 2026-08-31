import type { CoreNutrientCode, Food, FoodCandidate, GoalTarget, NutritionFacts } from '@/domain';
import { coreNutrientDisplayOrder } from '@/domain';
import type { FoodServingId } from '@/domain/shared/ids';
import { scaleNutritionFacts } from '@/services/nutrition/engine';
import { coreMetricAmount, formatCoreMetrics, type CoreMetric } from '@/ui/core-metrics';
import { goalImpact, type GoalImpact } from '@/ui/goal-impact';

/**
 * Everything the food detail sheet renders, derived outside the component.
 *
 * The sheet is where a portion is chosen, so its arithmetic is the arithmetic
 * that ends up in someone's day. Keeping it here means it can be tested without
 * mounting a modal (THI-306).
 */

export interface PortionChoice {
  /**
   * Stable identity for selection.
   *
   * Not the serving id: the plain-weight option deliberately has none, so
   * selecting "nothing chosen yet" by an undefined serving id would silently
   * match it and override the food's own preferred serving.
   */
  readonly key: string;
  readonly servingId: FoodServingId | undefined;
  readonly label: string;
  /** Weight of one of these, so quantity means something. */
  readonly gramWeight: number;
}

/** Named servings the food actually defines with a usable weight, plus 100 g. */
export function portionChoicesFor(candidate: FoodCandidate): readonly PortionChoice[] {
  const named = candidate.portions
    .filter((portion) => (portion.gramWeight ?? 0) > 0)
    .map((portion) => ({
      key: String(portion.id),
      servingId: portion.id as FoodServingId,
      label: portion.label.trim() || `${Math.round(portion.gramWeight ?? 0)} g`,
      gramWeight: portion.gramWeight as number,
    }));

  // A plain weight is always offered, because some foods define no serving at
  // all and because "just weigh it" has to stay one tap away.
  const hasHundred = named.some((choice) => Math.round(choice.gramWeight) === 100);
  return hasHundred
    ? named
    : [...named, { key: 'weight', servingId: undefined, label: '100 g', gramWeight: 100 }];
}

export function defaultPortionChoice(candidate: FoodCandidate): PortionChoice {
  const choices = portionChoicesFor(candidate);
  const preferred = candidate.portions.find((portion) => portion.isDefault && (portion.gramWeight ?? 0) > 0);
  const matched = preferred ? choices.find((choice) => choice.key === String(preferred.id)) : undefined;
  return (
    matched ?? choices[0] ?? { key: 'weight', servingId: undefined, label: '100 g', gramWeight: 100 }
  );
}

/** Total weight for a quantity of a chosen portion. */
export function gramsForChoice(choice: PortionChoice, quantity: number): number {
  return choice.gramWeight * quantity;
}

/** "2 × 1 medium breast · 280 g", or just the weight when quantity is one. */
export function portionSummary(choice: PortionChoice, quantity: number): string {
  const grams = Math.round(gramsForChoice(choice, quantity) * 10) / 10;
  const isWeightLabel = /^[\d.]+\s*g$/i.test(choice.label);
  if (isWeightLabel) return `${grams} g`;
  return quantity === 1
    ? `${choice.label} · ${grams} g`
    : `${quantity} × ${choice.label} · ${grams} g`;
}

export function factsForPortion(food: Food, gramWeight: number): NutritionFacts | null {
  try {
    return scaleNutritionFacts(food.nutrition, gramWeight);
  } catch {
    return null;
  }
}

export interface FoodDetailMetrics {
  readonly facts: NutritionFacts | null;
  readonly metrics: readonly CoreMetric[];
}

export function metricsForDetail(food: Food, gramWeight: number): FoodDetailMetrics {
  const facts = factsForPortion(food, gramWeight);
  return { facts, metrics: formatCoreMetrics(facts) };
}

/** What the day already holds for one nutrient, and its target. */
export interface DayStanding {
  readonly code: CoreNutrientCode;
  /** Logged plus everything already in the draft, or null when uncomputable. */
  readonly current: number | null;
  readonly target: GoalTarget | null;
}

/**
 * The "if you add this" block.
 *
 * Every core nutrient gets a row, including ones with no target — an absent
 * target is information, and hiding those rows would make the block's contents
 * change shape depending on how far the user got through goal setup.
 */
export function goalImpactsForDetail(
  standings: readonly DayStanding[],
  pendingFacts: NutritionFacts | null,
): readonly GoalImpact[] {
  return coreNutrientDisplayOrder.map((code) => {
    const standing = standings.find((entry) => entry.code === code);
    return goalImpact({
      code,
      current: standing?.current ?? null,
      pending: coreMetricAmount(pendingFacts, code),
      target: standing?.target ?? null,
    });
  });
}

/** True when at least one nutrient has a target worth showing a bar for. */
export function hasAnyTarget(impacts: readonly GoalImpact[]): boolean {
  return impacts.some((impact) => impact.shape !== 'untargeted');
}

/**
 * Parses the quantity field.
 *
 * Deliberately permissive about an in-progress value — someone typing "1." has
 * not made a mistake yet — but never resolves to a portion of zero.
 */
export function parseQuantity(raw: string): number | null {
  const value = Number(raw.trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
