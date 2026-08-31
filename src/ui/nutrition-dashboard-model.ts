import type { TodayMetric, TodayMetricCode } from '@/services/today/snapshot';

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
    case 'exceeded':
      return `${estimatePrefix}Above target`;
    default:
      return `${estimatePrefix}Tracking only`;
  }
}

export function metricProgress(metric: TodayMetric): number | null {
  const ratio = metric.goal?.ratio;
  if (ratio === null || ratio === undefined || Number.isNaN(ratio) || ratio < 0) return null;
  if (!Number.isFinite(ratio)) return 1;
  return Math.min(1, ratio);
}

export function metricAccessibilityLabel(metric: TodayMetric): string {
  const value = roundedMetricValue(metric);
  const valueLabel = value === null ? 'no data' : `${value} ${metricUnit(metric)}`;
  return `${dashboardMetricLabels[metric.code]}, ${valueLabel}. ${metricGoalText(metric)}`;
}
