import type { TodayMetric, TodayMetricCode } from '@/services/today/snapshot';
import { goalImpact, type GoalImpact } from '@/ui/goal-impact';

export const dashboardMetricLabels: Readonly<Record<TodayMetricCode, string>> = {
  'energy-kcal': 'Calories',
  'protein-g': 'Protein',
  'carbohydrate-g': 'Carbs',
  'fat-g': 'Fat',
  'fiber-g': 'Fiber',
};

export function emptyTodayMetric(code: TodayMetricCode): TodayMetric {
  return { code, value: null, state: 'unknown', goal: null };
}

export function metricForCode(
  metrics: readonly TodayMetric[],
  code: TodayMetricCode,
): TodayMetric {
  return metrics.find((metric) => metric.code === code) ?? emptyTodayMetric(code);
}

function roundedMetricValue(metric: TodayMetric): number | null {
  if (metric.value === null || !Number.isFinite(metric.value) || metric.value < 0) return null;
  return metric.code === 'energy-kcal'
    ? Math.round(metric.value)
    : Math.round(metric.value * 10) / 10;
}

export function metricValueText(metric: TodayMetric): string {
  const rounded = roundedMetricValue(metric);
  return rounded === null ? '—' : String(rounded);
}

export function metricUnit(metric: TodayMetric): 'kcal' | 'g' {
  return metric.code === 'energy-kcal' ? 'kcal' : 'g';
}

function amountText(metric: TodayMetric, value: number): string {
  const rounded = metric.code === 'energy-kcal'
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded} ${metricUnit(metric)}`;
}

export function metricGoalText(metric: TodayMetric): string {
  if (roundedMetricValue(metric) === null) return 'No data yet';

  const estimatePrefix = metric.state === 'estimated' ? 'Estimated · ' : '';
  const progress = metric.goal;
  if (!progress) return `${estimatePrefix}No goal set`;

  switch (progress.status) {
    case 'met':
      return `${estimatePrefix}Goal met`;
    case 'below':
      return `${estimatePrefix}${amountText(metric, progress.remaining ?? 0)} to goal`;
    case 'within':
      return `${estimatePrefix}Within target`;
    case 'exceeded': {
      // A cap that has been passed should say by how much. "Above target" alone
      // reads the same whether you are 5 kcal over or 500.
      const over = metricGoalImpact(metric).overBy;
      return over === null
        ? `${estimatePrefix}Above target`
        : `${estimatePrefix}Above target by ${amountText(metric, over)}`;
    }
    default:
      return `${estimatePrefix}Tracking only`;
  }
}

/**
 * The dashboard's reading of one metric, through the same rules the food detail
 * sheet uses (THI-333).
 *
 * The cards keep their own visual identity; what is shared is the *semantics* —
 * which shape the target has, and whether a filled bar is an achievement or an
 * overrun. Without this the dashboard had its own clamping (an infinite ratio
 * became a full bar) and no way to tell a cleared floor from a passed ceiling.
 */
export function metricGoalImpact(metric: TodayMetric): GoalImpact {
  return goalImpact({
    code: metric.code,
    current: metric.state === 'unknown' ? null : metric.value,
    target: metric.goal?.goal.target ?? null,
  });
}

export function metricProgress(metric: TodayMetric): number | null {
  const impact = metricGoalImpact(metric);
  return impact.shape === 'untargeted' ? null : impact.currentFraction;
}

export function metricAccessibilityLabel(metric: TodayMetric): string {
  const value = roundedMetricValue(metric);
  const valueLabel = value === null ? 'no data' : `${value} ${metricUnit(metric)}`;
  return `${dashboardMetricLabels[metric.code]}, ${valueLabel}. ${metricGoalText(metric)}`;
}
