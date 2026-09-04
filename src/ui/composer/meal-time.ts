import type { ISODateTime } from '@/domain/shared/ids';

/**
 * Applies one half of a date-time picker's answer to the meal's timestamp.
 *
 * The picker is opened for a date or a time, never both, so the other half of
 * the existing timestamp has to survive untouched. Seconds are cleared on a
 * time change because the user chose a minute; carrying the old seconds
 * forward would record a precision they did not express.
 */
export function combineDatePart(current: Date, selected: Date, part: 'date' | 'time'): Date {
  const next = new Date(current);
  if (part === 'date') {
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
  } else {
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }
  return next;
}

/**
 * Whether a chosen meal time is one the log can accept.
 *
 * A meal is a record of something that happened. A future timestamp is not a
 * plan the log can hold, so it is refused at the picker rather than written
 * and reconciled later.
 */
export function isAcceptableMealTime(candidate: Date, now: Date = new Date()): boolean {
  return Number.isFinite(candidate.getTime()) && candidate.getTime() <= now.getTime();
}

export function currentIso(): ISODateTime {
  return new Date().toISOString() as ISODateTime;
}

/** An error's own words when it has them, and a plain sentence when it does not. */
export function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
