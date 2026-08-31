import type { CoreNutrientCode, NutritionFacts } from '@/domain';
import { coreNutrientDisplayOrder } from '@/domain';

/**
 * Formats the five core metrics for compact display.
 *
 * One module so search rows, draft item rows and draft totals cannot drift into
 * three different orders or three different rounding rules — which is exactly
 * how this codebase ended up with three rounding policies for the dashboard.
 */

/** Compact labels for a metric line, in canonical protein-first order. */
export const CORE_METRIC_LABELS: Readonly<Record<CoreNutrientCode, string>> = {
  'protein-g': 'P',
  'energy-kcal': 'kcal',
  'carbohydrate-g': 'C',
  'fat-g': 'F',
  'fiber-g': 'fiber',
};

export const EM_DASH = '—';

export interface CoreMetric {
  readonly code: CoreNutrientCode;
  readonly label: string;
  /** Formatted amount, or an em dash when the nutrient is unknown. */
  readonly text: string;
  readonly known: boolean;
}

export function roundCoreMetric(code: CoreNutrientCode, value: number): number {
  return code === 'energy-kcal' ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * `null` facts mean "could not be computed", which is reported as unknown for
 * every metric. Unknown is never rendered as zero: a compact line is exactly
 * where a fabricated zero would be least noticeable and most misleading.
 */
export function formatCoreMetrics(facts: NutritionFacts | null): readonly CoreMetric[] {
  return coreNutrientDisplayOrder.map((code) => {
    const entry = facts?.nutrients.find((nutrient) => nutrient.nutrient.code === code);
    const known = entry?.state !== 'unknown' && entry?.value !== undefined;
    return {
      code,
      label: CORE_METRIC_LABELS[code],
      known,
      text: known ? String(roundCoreMetric(code, entry.value as number)) : EM_DASH,
    };
  });
}

/** "43.4 P · 231 kcal · 0 C · 5 F · — fiber" */
export function coreMetricLine(metrics: readonly CoreMetric[]): string {
  return metrics.map((metric) => `${metric.text} ${metric.label}`).join(' · ');
}

/**
 * The raw amount for one nutrient, or `null` when it is unknown.
 *
 * `formatCoreMetrics` is for display and deliberately collapses unknown into an
 * em dash. Anything that has to do arithmetic — goal impact, projections —
 * needs the number and the absence kept apart.
 */
export function coreMetricAmount(
  facts: NutritionFacts | null,
  code: CoreNutrientCode,
): number | null {
  const entry = facts?.nutrients.find((nutrient) => nutrient.nutrient.code === code);
  if (!entry || entry.state === 'unknown' || entry.value === undefined) return null;
  return Number.isFinite(entry.value) && entry.value >= 0 ? entry.value : null;
}
