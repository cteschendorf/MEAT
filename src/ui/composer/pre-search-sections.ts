import type { FoodLoggingContext } from '@/services/logging/food-suggestions';
import { getFoodLoggingContext } from '@/services/logging/food-suggestions';
import { presetMealNames } from '@/ui/composer/meal-context';

/**
 * What the Search tab shows before anyone types.
 *
 * The reference app heads this strip with the literal clock hour — "7 AM
 * Picks" — which changes every sixty minutes and explains nothing about why
 * those foods are there. We already rank suggestions by time of day
 * (`getFoodLoggingContext`), so the heading names *that* instead: the label
 * and the ranking behind it are then the same fact, and it stays put for the
 * length of a meal.
 */
export const contextHeadings: Readonly<Record<FoodLoggingContext, string>> = {
  morning: 'Morning picks',
  midday: 'Midday picks',
  evening: 'Evening picks',
  overnight: 'Late picks',
};

/** The meal name this hour usually goes by, for pre-selecting the slot. */
const contextMealNames: Readonly<Record<FoodLoggingContext, (typeof presetMealNames)[number]>> = {
  morning: 'Breakfast',
  midday: 'Lunch',
  evening: 'Dinner',
  overnight: 'Snack',
};

export interface PreSearchSections {
  readonly context: FoodLoggingContext;
  /** Heading over the time-ranked suggestions. */
  readonly picksTitle: string;
  /** Heading over the most recently logged foods. */
  readonly latestTitle: string;
  /**
   * The meal name this hour suggests.
   *
   * Offered, never applied. A meal's name is a claim about what the meal was,
   * and the clock is not entitled to make it — someone eating dinner at 3am
   * has not eaten a snack. The chip is pre-highlighted; nothing is written
   * until it is tapped.
   */
  readonly suggestedMealName: (typeof presetMealNames)[number];
}

export function preSearchSections(now: Date = new Date()): PreSearchSections {
  const context = getFoodLoggingContext(now);
  return {
    context,
    picksTitle: contextHeadings[context],
    latestTitle: 'Latest',
    suggestedMealName: contextMealNames[context],
  };
}
