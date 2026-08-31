import type {
  CoreNutrientCode,
  Food,
  FoodCandidate,
  GoalTarget,
  MassUnitPreference,
  MeasurementUnit,
  NutritionFacts,
} from '@/domain';
import {
  coreNutrientDisplayOrder,
  densityFromPortions,
  gramsForAmount,
  measurementUnitLabel,
  volumeUnits,
} from '@/domain';
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

/**
 * One entry in the "how much" picker.
 *
 * A named serving and a measurement unit are the same shape deliberately: both
 * answer "how much is one of these in grams", so the amount field means the same
 * thing whichever is chosen. Only a serving carries a `servingId`, because
 * typing 150 g is not a claim about a serving and must not be recorded as one.
 */
export type PortionChoice =
  | {
      readonly kind: 'serving';
      /** Stable identity for selection; a serving id is never reused as a unit key. */
      readonly key: string;
      readonly servingId: FoodServingId;
      readonly label: string;
      /** Grams in one of these. */
      readonly gramWeight: number;
    }
  | {
      readonly kind: 'unit';
      readonly key: string;
      readonly unit: MeasurementUnit;
      readonly label: string;
      readonly gramWeight: number;
    };

/** The serving id to record, which only a named serving has. */
export function servingIdForChoice(choice: PortionChoice): FoodServingId | undefined {
  return choice.kind === 'serving' ? choice.servingId : undefined;
}

/**
 * Grams per millilitre for this food, from its own portions.
 *
 * USDA states volume in the portion label — "1 cup", "8 fl oz" — so a food that
 * describes itself volumetrically tells us its own density. A food that does not
 * gets none, and volume units are then simply not offered for it rather than
 * converted through an invented figure.
 */
export function densityForCandidate(candidate: FoodCandidate): number | null {
  return densityFromPortions(
    candidate.portions.flatMap((portion) =>
      portion.gramWeight !== undefined && portion.gramWeight > 0
        ? [{ label: portion.label, gramWeight: portion.gramWeight }]
        : [],
    ),
  );
}

function servingChoices(candidate: FoodCandidate): readonly PortionChoice[] {
  return candidate.portions.flatMap((portion): PortionChoice[] => {
    const gramWeight = portion.gramWeight ?? 0;
    if (gramWeight <= 0) return [];
    return [{
      kind: 'serving',
      key: `serving:${portion.id}`,
      servingId: portion.id as FoodServingId,
      label: portion.label.trim() || `${Math.round(gramWeight)} g`,
      gramWeight,
    }];
  });
}

/**
 * The units offered for this food.
 *
 * Mass always, because every food has a weight. Volume only when the food's own
 * data yielded a density — offering "fl oz" on a food we cannot convert would
 * either fail or lie, and a fluid ounce of oil against one of honey differs by
 * more than half.
 */
export function unitChoicesFor(
  density: number | null,
  preferred: MassUnitPreference = 'g',
): readonly PortionChoice[] {
  const ordered: MeasurementUnit[] = preferred === 'oz'
    ? ['oz', 'g', 'lb', 'kg']
    : ['g', 'oz', 'kg', 'lb'];
  if (density !== null) ordered.push(...volumeUnits);

  return ordered.flatMap((unit): PortionChoice[] => {
    const gramWeight = gramsForAmount(1, unit, density ?? undefined);
    if (gramWeight === null || gramWeight <= 0) return [];
    return [{
      kind: 'unit',
      key: `unit:${unit}`,
      unit,
      label: measurementUnitLabel(unit),
      gramWeight,
    }];
  });
}

/** Named servings first, then units, because a serving is what people ate. */
export function portionChoicesFor(
  candidate: FoodCandidate,
  preferred: MassUnitPreference = 'g',
): readonly PortionChoice[] {
  return [
    ...servingChoices(candidate),
    ...unitChoicesFor(densityForCandidate(candidate), preferred),
  ];
}

/**
 * What the picker opens on.
 *
 * The package's own serving wins whenever the provider marked one, which is the
 * whole point: a scanned product should open on "1 bar (40 g)", not on a
 * synthesized 100 g that nobody weighs out. Only a food that names no usable
 * serving falls through to a plain unit.
 */
export function defaultPortionChoice(
  candidate: FoodCandidate,
  preferred: MassUnitPreference = 'g',
): PortionChoice {
  const choices = portionChoicesFor(candidate, preferred);
  const servings = choices.filter((choice) => choice.kind === 'serving');
  const marked = candidate.portions.find(
    (portion) => portion.isDefault && (portion.gramWeight ?? 0) > 0,
  );
  const preferredServing = marked
    ? servings.find((choice) => choice.key === `serving:${marked.id}`)
    : undefined;
  return (
    preferredServing ??
    servings[0] ??
    choices[0] ?? {
      kind: 'unit',
      key: 'unit:g',
      unit: 'g',
      label: 'g',
      gramWeight: 1,
    }
  );
}

/** Total weight for an amount of a chosen portion. */
export function gramsForChoice(choice: PortionChoice, amount: number): number {
  return choice.gramWeight * amount;
}

/**
 * "2 × 1 medium breast · 280 g", or "6 oz · 170.1 g".
 *
 * A unit choice already states its own weight in its label, so the grams are
 * shown alongside rather than the label being repeated.
 */
export function portionSummary(choice: PortionChoice, amount: number): string {
  const grams = Math.round(gramsForChoice(choice, amount) * 10) / 10;
  if (choice.kind === 'unit') {
    return choice.unit === 'g' ? `${grams} g` : `${amount} ${choice.label} · ${grams} g`;
  }
  return amount === 1
    ? `${choice.label} · ${grams} g`
    : `${amount} × ${choice.label} · ${grams} g`;
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
