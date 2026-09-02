import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import type { FoodSearchGroup, FoodSourceId } from '../src/domain/food/source';
import type { FoodId } from '../src/domain/shared/ids';
import { useFoodSearch, SEARCH_DEBOUNCE_MS } from '../src/ui/composer/use-food-search';

/**
 * The search field's own behaviour, without a composer around it.
 *
 * Extracting this hook out of the screen (THI-316) is what makes these
 * assertions possible at all: the debounce, the Search key and the generation
 * counter used to be reachable only by mounting 1,340 lines and four services.
 */

const enabled = [
  { sourceId: 'personal' as FoodSourceId, enabled: true },
  { sourceId: 'usda-core' as FoodSourceId, enabled: true },
  { sourceId: 'usda-fdc' as FoodSourceId, enabled: true },
  { sourceId: 'open-food-facts' as FoodSourceId, enabled: true },
];

function group(sourceId: FoodSourceId, query: string): FoodSearchGroup {
  return { sourceId, query, state: 'empty', freshness: 'fresh-cache' };
}

function fakeServices() {
  const searched: string[] = [];
  return {
    searched,
    preferences: { list: async () => enabled },
    discovery: {
      search: async (term: string) => {
        searched.push(term);
        return enabled.map((source) => group(source.sourceId, term));
      },
    },
  };
}

type SearchServices = Parameters<typeof useFoodSearch>[0];

const noFavorites: ReadonlySet<FoodId> = new Set();

let controller: ReturnType<typeof useFoodSearch> | null = null;

function Harness({ services }: { services: ReturnType<typeof fakeServices> }) {
  const search = useFoodSearch(services as unknown as SearchServices, noFavorites, () => {});
  // Published from an effect rather than during render: the assertions want the
  // controller as of the last committed render, which is what an effect sees.
  useEffect(() => {
    controller = search;
  });
  return null;
}

/**
 * Waits `ms` of real time and lets the search's awaits finish.
 *
 * Real timers on purpose. Jest's fake clock stops React's own scheduler from
 * draining between tests in this suite, so the second render never happens and
 * every assertion after it passes vacuously — a test that cannot fail is worse
 * than a slow one. The debounce is 300 ms; the whole file costs about two
 * seconds.
 */
async function settle(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms + 20));
  });
}

describe('composer search', () => {
  beforeEach(() => {
    controller = null;
  });

  it('waits out the debounce, so a fast typist issues one request', async () => {
    const services = fakeServices();
    await act(async () => {
      render(<Harness services={services} />);
    });

    await act(async () => {
      controller?.setQuery('c');
    });
    await act(async () => {
      controller?.setQuery('ch');
    });
    await act(async () => {
      controller?.setQuery('chicken');
    });
    expect(services.searched).toEqual([]);

    await settle(SEARCH_DEBOUNCE_MS);
    expect(services.searched).toEqual(['chicken']);
  });

  it('a single character is not a search yet, and clearing the field clears the results', async () => {
    const services = fakeServices();
    await act(async () => {
      render(<Harness services={services} />);
    });

    await act(async () => {
      controller?.setQuery('c');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    expect(services.searched).toEqual([]);

    await act(async () => {
      controller?.setQuery('chicken');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    expect(controller?.submittedQuery).toBe('chicken');

    await act(async () => {
      controller?.setQuery('');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    // The list must never outlive the query it answered.
    expect(controller?.submittedQuery).toBe('');
    expect(controller?.tiers).toEqual([]);
  });

  it('the Search key retries the same text, which is the only way back from a failed source', async () => {
    const services = fakeServices();
    await act(async () => {
      render(<Harness services={services} />);
    });

    await act(async () => {
      controller?.setQuery('chicken');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    expect(services.searched).toEqual(['chicken']);

    // Nothing was typed. A press must still issue a request, or a source that
    // failed can only be retried by editing the query.
    await act(async () => {
      controller?.searchNow();
    });
    await settle(0);
    expect(services.searched).toEqual(['chicken', 'chicken']);

    await act(async () => {
      controller?.searchNow();
    });
    await settle(0);
    expect(services.searched).toEqual(['chicken', 'chicken', 'chicken']);
  });

  it('pressing Search does not permanently disable the debounce', async () => {
    const services = fakeServices();
    await act(async () => {
      render(<Harness services={services} />);
    });

    await act(async () => {
      controller?.setQuery('chicken');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    await act(async () => {
      controller?.searchNow();
    });
    await settle(0);
    expect(services.searched).toHaveLength(2);

    // Typing again must wait the full delay, not fire on the keystroke.
    await act(async () => {
      controller?.setQuery('chicken t');
    });
    await settle(SEARCH_DEBOUNCE_MS / 3);
    expect(services.searched).toHaveLength(2);

    await settle(SEARCH_DEBOUNCE_MS);
    expect(services.searched).toEqual(['chicken', 'chicken', 'chicken t']);
  });

  it('a query the user has edited away from does not come back', async () => {
    // The generation counter exists for this: a slow response under a newer
    // heading is how tapping a result used to add the wrong food.
    const services = fakeServices();
    await act(async () => {
      render(<Harness services={services} />);
    });

    await act(async () => {
      controller?.setQuery('chicken');
    });
    await settle(SEARCH_DEBOUNCE_MS);
    await act(async () => {
      controller?.setQuery('salmon');
    });
    await settle(SEARCH_DEBOUNCE_MS);

    expect(controller?.submittedQuery).toBe('salmon');
    expect(controller?.tiers.every((tier) => tier.rows.length === 0)).toBe(true);
  });
});
