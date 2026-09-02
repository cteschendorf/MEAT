import type { Food } from '@/domain';
import type { FoodSourceId } from '@/domain/food/source';
import { sourceIdFromFoodId } from '@/domain/food/source';

/**
 * The four food sources, named once.
 *
 * These names were declared twice inside the composer screen — a list of
 * `{ id, name, detail }` for the provider cards, and a separate lookup map for
 * row captions — which is how the two drifted apart. Sources are a property of
 * the app, not of a screen, so they live here and every surface reads the same
 * copy (THI-316).
 */
export interface FoodSourceDefinition {
  readonly id: FoodSourceId;
  readonly name: string;
  readonly detail: string;
}

export const foodSourceDefinitions: readonly FoodSourceDefinition[] = [
  {
    id: 'personal',
    name: 'My Foods',
    detail: 'Foods you created and retained in your own library.',
  },
  {
    id: 'usda-core',
    name: 'USDA Core',
    detail: 'Foundation, FNDDS, and SR Legacy foods stored on this device.',
  },
  {
    id: 'usda-fdc',
    name: 'USDA Online',
    detail: 'Independent FoodData Central results from the MEAT proxy.',
  },
  {
    id: 'open-food-facts',
    name: 'Open Food Facts',
    detail: 'Independent packaged-food records from Open Food Facts.',
  },
];

export const foodSourceNames: Readonly<Record<FoodSourceId, string>> = Object.freeze(
  Object.fromEntries(
    foodSourceDefinitions.map((source) => [source.id, source.name]),
  ) as Record<FoodSourceId, string>,
);

/**
 * Which source a food came from, read off its own id.
 *
 * A food id is provider-scoped by construction (`usda-core:…`), so this is a
 * decode rather than a guess. Anything unprefixed was created here, which is
 * what `personal` means.
 */
export function sourceForFood(food: Pick<Food, 'id'>): FoodSourceId {
  return sourceIdFromFoodId(food.id) ?? 'personal';
}
