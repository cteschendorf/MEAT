import { useCallback, useEffect, useRef, useState } from 'react';

import type { FoodId } from '@/domain/shared/ids';
import type { AppServices } from '@/services';
import type { FoodSuggestion } from '@/services/logging/food-suggestions';
import { currentIso } from '@/ui/composer/meal-time';

type SuggestionServices = Pick<AppServices, 'suggestions' | 'favorites'>;

export interface FoodSuggestionsController {
  readonly suggestions: readonly FoodSuggestion[];
  readonly favoriteIds: ReadonlySet<FoodId>;
  readonly refresh: (services: SuggestionServices) => Promise<void>;
}

/**
 * What the composer offers before anyone types, and which foods are starred.
 *
 * These two travel together because starring a food changes what gets
 * suggested: the ranking reads favorites, so a stale favorite set produces a
 * strip that contradicts the star the user just tapped.
 */
export function useFoodSuggestions(): FoodSuggestionsController {
  const [suggestions, setSuggestions] = useState<readonly FoodSuggestion[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<ReadonlySet<FoodId>>(new Set());
  // A refresh started before the composer closed must not land after it did.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async (services: SuggestionServices): Promise<void> => {
    const [nextSuggestions, nextFavorites] = await Promise.all([
      services.suggestions.listSuggestions(currentIso()),
      services.favorites.listFavoriteIds(),
    ]);
    if (!mounted.current) return;
    setSuggestions(nextSuggestions);
    setFavoriteIds(new Set(nextFavorites));
  }, []);

  return { suggestions, favoriteIds, refresh };
}
