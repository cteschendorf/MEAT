import type { Food, PortionSelection } from '@/domain';
import type { FoodServingId } from '@/domain/shared/ids';

/**
 * Builds the portion recorded against a meal item.
 *
 * Two shapes are possible and the difference matters:
 *
 * - `{ servingId, quantity }` — "2 × 1 medium breast". Grams are derived by the
 *   nutrition engine from the serving, so the household measure the user
 *   actually chose survives into history and can be re-rendered later.
 * - `{ quantity: 1, gramWeight }` — an explicit weight the user typed.
 *
 * Every entry point previously wrote the second shape with `quantity` pinned to
 * 1, which made the engine's `serving.gramWeight × quantity` path unreachable
 * and left "2 chicken breasts" impossible to express (THI-308).
 */

/** A serving can only carry a portion if the food actually defines it with a weight. */
export function resolvableServing(
  food: Food,
  servingId: FoodServingId | undefined,
): FoodServingId | undefined {
  if (!servingId) return undefined;
  const serving = food.servings.find((candidate) => candidate.id === servingId);
  // Some providers synthesize a "100 g" portion that has no matching serving on
  // the food. Referencing it would leave the engine unable to resolve grams.
  if (!serving?.gramWeight || !Number.isFinite(serving.gramWeight) || serving.gramWeight <= 0) {
    return undefined;
  }
  return servingId;
}

/**
 * Prefers the named serving so quantity means something, and falls back to an
 * explicit weight when the serving cannot be resolved.
 */
export function portionForSelection(
  food: Food,
  servingId: FoodServingId | undefined,
  quantity: number,
  fallbackGramWeight: number,
): PortionSelection {
  const resolved = resolvableServing(food, servingId);
  if (resolved && Number.isFinite(quantity) && quantity > 0) {
    return { servingId: resolved, quantity };
  }
  return { quantity: 1, gramWeight: fallbackGramWeight };
}

/**
 * Replaces the weight with one the user typed.
 *
 * The serving reference is dropped deliberately: once someone overrides the
 * weight by hand, the stored portion no longer describes that serving, and
 * keeping the id would assert that "1 cup" weighs whatever they typed.
 */
export function portionWithGramWeight(
  portion: PortionSelection,
  gramWeight: number,
): PortionSelection {
  const { servingId: _dropped, ...rest } = portion;
  return { ...rest, quantity: 1, gramWeight };
}

/** Changes how many of the chosen serving were eaten, keeping the serving. */
export function portionWithQuantity(
  portion: PortionSelection,
  quantity: number,
): PortionSelection {
  if (!portion.servingId) {
    // Without a serving there is nothing to multiply; the weight is absolute.
    return portion;
  }
  return { servingId: portion.servingId, quantity };
}
