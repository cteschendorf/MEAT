import { roundCoreMetric } from '@/ui/core-metrics';
import type { DayStanding } from '@/ui/food-detail-model';

/**
 * The line pinned above the composer: what the day stands at, with the
 * unsaved draft folded in.
 *
 * Protein leads because this is a protein-first tracker. The reference app
 * puts calories here; that is its answer to a different question.
 *
 * Extracted from the screen so the wording can be tested without mounting a
 * composer — the phrasing is the whole feature, and it was previously only
 * reachable through a render (THI-316).
 */
export interface RunningTotal {
  readonly headline: string;
  readonly detail: string;
  readonly accessibilityLabel: string;
}

export function buildRunningTotal(
  standings: readonly DayStanding[],
  unsavedItemCount: number,
): RunningTotal {
  const protein = standings.find((standing) => standing.code === 'protein-g');
  const value = protein?.current;
  // An uncomputable day total prints as a dash. Showing 0 would claim the user
  // has eaten no protein today, which is a different statement from "we could
  // not work it out".
  const headline = value === null || value === undefined
    ? '— g protein'
    : `${roundCoreMetric('protein-g', value)} g protein`;

  const target = protein?.target;
  const goalText = target && target.mode === 'minimum' && target.minimum
    ? ` of ${target.minimum} g`
    : target && target.mode === 'maximum' && target.maximum
      ? ` of ${target.maximum} g limit`
      : '';

  const detail = unsavedItemCount
    ? `today, including ${unsavedItemCount} food${unsavedItemCount === 1 ? '' : 's'} not yet saved`
    : 'today';

  return {
    headline: `${headline}${goalText}`,
    detail,
    accessibilityLabel: `${headline}${goalText} ${detail}.`,
  };
}
