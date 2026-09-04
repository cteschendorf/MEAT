import { coreNutrientDisplayOrder } from '@/domain';
import type { NutritionFacts } from '@/domain';
import type { TodayMetric } from '@/services/today/snapshot';
import { coreMetricAmount } from '@/ui/core-metrics';
import type { DayStanding } from '@/ui/food-detail-model';

/**
 * Where the day stands per nutrient, with the unsaved draft counted in.
 *
 * The detail sheet answers "where would this put me", which it cannot do from
 * the saved day alone: foods staged but not yet committed are part of "now"
 * from the user's point of view, even though nothing has been written.
 *
 * The one rule worth stating: **a known draft amount added to an unknown day
 * stays unknown.** A day total that could not be computed is missing
 * information, not zero, and folding a real number into it would manufacture a
 * total nobody can stand behind.
 */
export function buildDayStandings(
  dayMetrics: readonly TodayMetric[],
  draftFacts: NutritionFacts | null,
): readonly DayStanding[] {
  return coreNutrientDisplayOrder.map((code) => {
    const metric = dayMetrics.find((entry) => entry.code === code);
    const logged = metric?.state === 'unknown' ? null : metric?.value ?? null;
    const drafted = coreMetricAmount(draftFacts, code);
    return {
      code,
      current: logged === null ? null : logged + (drafted ?? 0),
      target: metric?.goal?.goal.target ?? null,
    };
  });
}
