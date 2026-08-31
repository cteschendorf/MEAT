import type { CoreNutrientCode, GoalTarget } from '@/domain';
import { roundCoreMetric } from '@/ui/core-metrics';
import { dashboardMetricLabels } from '@/ui/nutrition-dashboard-model';

/**
 * What a nutrient's target looks like, and what adding a food would do to it.
 *
 * A single progress ring is the obvious way to show "how am I doing", and it is
 * wrong here. MEAT's `GoalTarget` has four modes chosen per nutrient, and two of
 * them mean opposite things: filling a protein *minimum* is success, filling a
 * fat *maximum* is overrun. Rendering both as the same filling circle inverts
 * the meaning of one of them (THI-333).
 *
 * Three further cases have to survive contact with real data:
 *
 * - `mode: 'none'` is the *default* for all five nutrients, so a user who
 *   skipped goal setup has no targets at all. That reads "no target set", never
 *   0%, because zero percent of nothing is a number nobody asked for.
 * - A `maximum` of zero makes the engine's ratio infinite. Nothing may hand
 *   that to a layout.
 * - An unknown contribution stays unknown. A food missing fibre does not
 *   contribute zero fibre; it contributes an amount nobody knows.
 */

export type GoalImpactShape = 'progress' | 'cap' | 'band' | 'untargeted';

/**
 * Colour intent, kept separate from the accent so severity is not decoration.
 * `good` means the target is satisfied — which for a cap means still under it.
 */
export type GoalImpactTone = 'neutral' | 'good' | 'caution' | 'over';

export interface GoalImpactInput {
  readonly code: CoreNutrientCode;
  /** What the day already holds, or null when it could not be computed. */
  readonly current: number | null;
  /** What the food under consideration would add. `null` means unknown. */
  readonly pending?: number | null;
  readonly target: GoalTarget | null;
}

export interface GoalImpact {
  readonly code: CoreNutrientCode;
  readonly label: string;
  readonly shape: GoalImpactShape;
  readonly tone: GoalImpactTone;
  /** Fraction of the track the day already fills, 0–1. */
  readonly currentFraction: number;
  /** Further fraction the pending food would fill, 0–1, on top of the above. */
  readonly pendingFraction: number;
  /** Where the acceptable zone sits on the track, for a range goal only. */
  readonly band: { readonly start: number; readonly end: number } | null;
  /** "127 of 180 g minimum", "No target set". */
  readonly summary: string;
  /** "+31 g", or "+? g" when the food's contribution for this nutrient is unknown. */
  readonly delta: string | null;
  /** How far past the target the projection lands, so a full bar can say so. */
  readonly overBy: number | null;
}

/** A cap this close to its limit is worth flagging before it is passed. */
const cautionThreshold = 0.85;

function unitFor(code: CoreNutrientCode): 'kcal' | 'g' {
  return code === 'energy-kcal' ? 'kcal' : 'g';
}

function amountText(code: CoreNutrientCode, value: number): string {
  return `${roundCoreMetric(code, value)} ${unitFor(code)}`;
}

function usableAmount(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** A denominator has to be a positive finite number to divide by. */
function usableLimit(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}

function untargeted(code: CoreNutrientCode, summary: string, delta: string | null): GoalImpact {
  return {
    code,
    label: dashboardMetricLabels[code],
    shape: 'untargeted',
    tone: 'neutral',
    currentFraction: 0,
    pendingFraction: 0,
    band: null,
    summary,
    delta,
    overBy: null,
  };
}

export function goalImpact({ code, current, pending, target }: GoalImpactInput): GoalImpact {
  const label = dashboardMetricLabels[code];
  const currentValue = usableAmount(current);
  const pendingValue = usableAmount(pending);
  // `pending` was passed but is not a usable number: the food has no value for
  // this nutrient, which is different from contributing none of it.
  const pendingUnknown = pending !== undefined && pendingValue === null;
  const delta = pendingUnknown
    ? `+? ${unitFor(code)}`
    : pendingValue === null
      ? null
      : `+${amountText(code, pendingValue)}`;

  if (!target || target.mode === 'none') {
    return untargeted(code, 'No target set', delta);
  }
  if (currentValue === null) {
    return untargeted(code, 'No data yet', delta);
  }

  const projected = currentValue + (pendingValue ?? 0);

  if (target.mode === 'minimum') {
    const minimum = usableLimit(target.minimum);
    // A floor of zero is cleared by definition, so there is no progress to show.
    if (minimum === null) return untargeted(code, 'No target set', delta);
    return {
      code,
      label,
      shape: 'progress',
      tone: projected >= minimum ? 'good' : 'neutral',
      currentFraction: clampFraction(currentValue / minimum),
      pendingFraction: clampFraction(projected / minimum) - clampFraction(currentValue / minimum),
      band: null,
      summary: `${roundCoreMetric(code, projected)} of ${amountText(code, minimum)} minimum`,
      delta,
      overBy: null,
    };
  }

  if (target.mode === 'maximum') {
    const maximum = usableLimit(target.maximum);
    // A cap of zero divides to infinity in the engine; there is no bar for it.
    if (maximum === null) return untargeted(code, 'No target set', delta);
    const ratio = projected / maximum;
    return {
      code,
      label,
      shape: 'cap',
      tone: ratio > 1 ? 'over' : ratio >= cautionThreshold ? 'caution' : 'good',
      currentFraction: clampFraction(currentValue / maximum),
      pendingFraction: clampFraction(ratio) - clampFraction(currentValue / maximum),
      band: null,
      summary: `${roundCoreMetric(code, projected)} of ${amountText(code, maximum)} limit`,
      delta,
      overBy: projected > maximum ? projected - maximum : null,
    };
  }

  const minimum = usableLimit(target.minimum) ?? 0;
  const maximum = usableLimit(target.maximum);
  if (maximum === null || maximum < minimum) return untargeted(code, 'No target set', delta);

  // The track has to extend past the ceiling, or landing above the range would
  // be indistinguishable from landing exactly on it.
  const scale = Math.max(maximum, projected) || 1;
  return {
    code,
    label,
    shape: 'band',
    tone: projected > maximum ? 'over' : projected >= minimum ? 'good' : 'neutral',
    currentFraction: clampFraction(currentValue / scale),
    pendingFraction: clampFraction(projected / scale) - clampFraction(currentValue / scale),
    band: { start: clampFraction(minimum / scale), end: clampFraction(maximum / scale) },
    summary: `${roundCoreMetric(code, projected)} of ${roundCoreMetric(code, minimum)}–${amountText(code, maximum)}`,
    delta,
    overBy: projected > maximum ? projected - maximum : null,
  };
}

/** Screen-reader sentence for one row, since the bar itself carries no text. */
export function goalImpactAccessibilityLabel(impact: GoalImpact): string {
  const parts = [impact.label, impact.summary];
  if (impact.delta) parts.push(`this food adds ${impact.delta.replace('+', '')}`);
  if (impact.overBy !== null) {
    parts.push(`over by ${amountText(impact.code, impact.overBy)}`);
  }
  return `${parts.join(', ')}.`;
}
