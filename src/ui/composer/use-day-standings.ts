import { useEffect, useMemo, useState } from 'react';

import type { MassUnitPreference, NutritionFacts } from '@/domain';
import type { AppServices } from '@/services';
import { buildTodaySnapshot, type TodayMetric } from '@/services/today/snapshot';
import type { DayStanding } from '@/ui/food-detail-model';
import { buildDayStandings } from '@/ui/composer/day-standings';
import { buildRunningTotal, type RunningTotal } from '@/ui/composer/running-total';

type StandingsServices = Pick<AppServices, 'foods' | 'meals' | 'goals' | 'userPreferences'>;

export interface DayStandingsController {
  readonly standings: readonly DayStanding[];
  readonly runningTotal: RunningTotal;
  /** Which unit a typed amount starts in. Grams until Settings says otherwise. */
  readonly massUnit: MassUnitPreference;
}

/**
 * What the day already holds, so the composer can answer "does this fit"
 * before a food is committed rather than after (THI-307).
 *
 * Both loads fail quietly on purpose. A missing day total falls back to "no
 * data yet" and a missing unit preference falls back to grams; neither is a
 * reason to stop someone logging a meal, and an error banner over the
 * composer would suggest otherwise.
 */
export function useDayStandings(
  services: StandingsServices | null,
  draftFacts: NutritionFacts | null,
  unsavedItemCount: number,
): DayStandingsController {
  const [dayMetrics, setDayMetrics] = useState<readonly TodayMetric[]>([]);
  const [massUnit, setMassUnit] = useState<MassUnitPreference>('g');

  useEffect(() => {
    if (!services) return;
    let active = true;
    void services.userPreferences
      .get()
      .then((preferences) => {
        if (active && preferences) setMassUnit(preferences.massUnit);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [services]);

  useEffect(() => {
    if (!services) return;
    let active = true;
    void buildTodaySnapshot(new Date(), {
      foods: services.foods,
      meals: services.meals,
      goals: services.goals,
    })
      .then((snapshot) => {
        if (active) setDayMetrics(snapshot.metrics);
      })
      .catch(() => {
        if (active) setDayMetrics([]);
      });
    return () => {
      active = false;
    };
  }, [services]);

  const standings = useMemo(
    () => buildDayStandings(dayMetrics, draftFacts),
    [dayMetrics, draftFacts],
  );

  const runningTotal = useMemo(
    () => buildRunningTotal(standings, unsavedItemCount),
    [standings, unsavedItemCount],
  );

  return { standings, runningTotal, massUnit };
}
