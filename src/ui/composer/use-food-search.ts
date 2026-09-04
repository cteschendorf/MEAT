import { useEffect, useMemo, useRef, useState } from 'react';

import type { FoodSearchGroup, FoodSourceId } from '@/domain/food/source';
import { foodSourceIds } from '@/domain/food/source';
import type { FoodId } from '@/domain/shared/ids';
import type { AppServices } from '@/services';
import { buildFoodResultTiers, type FoodResultTier } from '@/ui/food-search-results';
import { foodSourceDefinitions, foodSourceNames } from '@/ui/composer/food-sources';

/** Long enough that a fast typist issues one request, short enough to feel live. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Below this a query is not a mistake, it is simply not a search yet. */
const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 80;

type SearchServices = Pick<AppServices, 'discovery' | 'preferences'>;

type Groups = Partial<Record<FoodSourceId, FoodSearchGroup>>;

export interface FoodSearchController {
  readonly query: string;
  readonly setQuery: (next: string) => void;
  /** The query the visible results actually answer, which lags `query`. */
  readonly submittedQuery: string;
  readonly tiers: readonly FoodResultTier[];
  /** Skips the remaining debounce, for the keyboard's Search key. */
  readonly searchNow: () => void;
}

/**
 * Everything the search field owns.
 *
 * Lifted out of the composer screen whole (THI-316). The screen kept six
 * pieces of state, two refs and a debounce for this alone, and every one of
 * them was reachable by the twelve unrelated concerns sharing that component.
 *
 * The generation counter is the reason results never contradict the box above
 * them: a response from a query the user has since edited is dropped rather
 * than rendered under the newer heading, which is how tapping a result used to
 * add the wrong food.
 */
export function useFoodSearch(
  services: SearchServices | null,
  favoriteIds: ReadonlySet<FoodId>,
  onError: (message: string) => void,
  /**
   * Called the moment a request is actually issued — after the debounce, not on
   * every keystroke. A new search invalidates whatever the last one prompted:
   * an open detail sheet is about a food the user has moved on from, and a
   * message about the previous query outlives its own cause.
   */
  onSearchStarted: () => void = () => {},
): FoodSearchController {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [groups, setGroups] = useState<Groups>({});
  const [enabledSources, setEnabledSources] = useState<ReadonlySet<FoodSourceId>>(
    () => new Set(foodSourceDefinitions.map((source) => source.id)),
  );
  // Pressing Search skips the remaining wait. The counter is bumped on every
  // press and consumed by the effect that reads it, which is what makes the
  // shortcut work twice on the same text — a failed source is retried by
  // pressing Search again, and that has to issue a request even though nothing
  // was typed — and what stops it from disabling the debounce afterwards.
  const [flush, setFlush] = useState(0);
  const consumedFlush = useRef(0);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const report = useRef(onError);
  const started = useRef(onSearchStarted);
  // Written in an effect, not during render: a ref assignment in a render body
  // is a write the compiler cannot see, and it lints as one.
  useEffect(() => {
    report.current = onError;
    started.current = onSearchStarted;
  }, [onError, onSearchStarted]);

  useEffect(() => {
    if (!services) return;
    const normalized = query.trim();
    const immediate = flush > consumedFlush.current;
    consumedFlush.current = flush;
    const timer = setTimeout(() => {
      if (normalized.length < MIN_QUERY_LENGTH) {
        // Clearing the field clears the results on the same beat a search would
        // have run, so the list never outlives the query it answered.
        generation.current += 1;
        controller.current?.abort();
        setSubmittedQuery('');
        setGroups({});
        return;
      }
      void runSearch(normalized);
    }, immediate ? 0 : SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);

    async function runSearch(term: string): Promise<void> {
      if (!services || term.length > MAX_QUERY_LENGTH) return;
      const ticket = generation.current + 1;
      generation.current = ticket;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setSubmittedQuery(term);
      started.current();

      const preferences = await services.preferences.list();
      if (ticket !== generation.current) return;
      const enabled = new Set(
        preferences.filter((preference) => preference.enabled).map((preference) => preference.sourceId),
      );
      setEnabledSources(enabled);

      const pending: Groups = {};
      for (const source of foodSourceDefinitions) {
        if (enabled.has(source.id)) {
          pending[source.id] = { sourceId: source.id, query: term, state: 'loading' };
        }
      }
      setGroups(pending);

      try {
        const results = await services.discovery.search(term, {
          limit: 12,
          signal: abort.signal,
          onGroup: (group) => {
            if (ticket === generation.current) {
              setGroups((current) => ({ ...current, [group.sourceId]: group }));
            }
          },
        });
        if (ticket !== generation.current) return;
        const resolved: Groups = {};
        results.forEach((group) => {
          resolved[group.sourceId] = group;
        });
        // A source that was asked and said nothing at all is not the same as a
        // source that returned no matches, and the difference belongs on screen.
        for (const source of foodSourceDefinitions) {
          if (enabled.has(source.id) && !resolved[source.id]) {
            resolved[source.id] = {
              sourceId: source.id,
              query: term,
              state: 'error',
              candidates: [],
              issue: {
                kind: 'error',
                code: 'source-unavailable',
                message: `${foodSourceNames[source.id]} did not return a search status.`,
              },
            };
          }
        }
        setGroups(resolved);
      } catch (error) {
        if (ticket !== generation.current) return;
        report.current(error instanceof Error ? error.message : 'Search could not start.');
      }
    }
    // `runSearch` is declared inside the effect, so the query, the services and
    // the flush are the whole of what decides whether a new request is owed.
  }, [query, services, flush]);

  useEffect(
    () => () => {
      generation.current += 1;
      controller.current?.abort();
    },
    [],
  );

  const tiers = useMemo(
    () =>
      buildFoodResultTiers({
        groups: Object.values(groups).filter((group): group is FoodSearchGroup => Boolean(group)),
        query: submittedQuery,
        favoriteIds: [...favoriteIds],
        disabledSources: foodSourceIds.filter((id) => !enabledSources.has(id)),
      }),
    [groups, submittedQuery, favoriteIds, enabledSources],
  );

  return {
    query,
    setQuery,
    submittedQuery,
    tiers,
    searchNow: () => setFlush((count) => count + 1),
  };
}
