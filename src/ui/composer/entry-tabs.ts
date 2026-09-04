/**
 * The five ways into a meal, as one list.
 *
 * MEAT has all five today, spread across five routes: search and quick add
 * inline in the composer, scanning at `/scan-barcode`, manual creation at
 * `/manual-food`, saved meals at `/meals-recipes`. Naming them here as peers
 * is the first half of THI-328; the second half is that switching between
 * them mounts a mode rather than pushing a route.
 *
 * That distinction is not cosmetic. A route boundary means the draft has to be
 * handed across it by id and re-resolved on the way back, which is the
 * mechanism behind THI-309 (a stale id silently forks a new draft and orphans
 * the user's foods) and THI-319 (an unrecognised barcode teleports the user
 * into a blank form). A tab switch has no id to lose and nowhere to teleport
 * to, so consolidating removes the bug class rather than its instances.
 */
export type EntryTabId = 'scan' | 'search' | 'ai' | 'quick-add' | 'library';

export interface EntryTab {
  readonly id: EntryTabId;
  /** What the tab is called. Short: five of these share one row. */
  readonly title: string;
  /**
   * SF Symbol name, drawn beside the title.
   *
   * Five terse words in a row are hard to tell apart at a glance; the glyph
   * is what makes the row scannable, and it is the same convention the app's
   * own bottom bar uses.
   */
  readonly icon: string;
  /** Read instead of the title by a screen reader, where the title is terse. */
  readonly accessibilityLabel: string;
  /**
   * Present when the mode has nothing behind it yet.
   *
   * A tab whose feature has not shipped stays visible and says so. Hiding it
   * would make the row's shape depend on which features exist, and a row that
   * changes width between builds is harder to learn than one that is honest.
   */
  readonly pending?: {
    readonly title: string;
    readonly message: string;
  };
}

export const entryTabs: readonly EntryTab[] = [
  {
    id: 'scan',
    title: 'Scan',
    icon: 'barcode.viewfinder',
    accessibilityLabel: 'Scan a barcode',
  },
  {
    id: 'search',
    title: 'Search',
    icon: 'magnifyingglass',
    accessibilityLabel: 'Search for a food',
  },
  {
    id: 'ai',
    title: 'AI',
    icon: 'sparkles',
    accessibilityLabel: 'Describe a meal in your own words',
    pending: {
      title: 'Not built yet',
      message:
        'Describing a meal in plain words is coming. It will run on this device, so what you write stays here.',
    },
  },
  {
    id: 'quick-add',
    title: 'Quick Add',
    icon: 'bolt',
    accessibilityLabel: 'Add a food that is not in any database',
  },
  {
    id: 'library',
    title: 'Library',
    icon: 'books.vertical',
    accessibilityLabel: 'Your foods, saved meals and recipes',
  },
];

/** Where the sheet opens. Search, because most foods are found by name. */
export const defaultEntryTab: EntryTabId = 'search';

export function entryTab(id: EntryTabId): EntryTab {
  const found = entryTabs.find((tab) => tab.id === id);
  // Unreachable by type, but a missing tab must not render an empty row.
  if (!found) throw new Error(`Unknown entry tab: ${id}`);
  return found;
}

/**
 * Whether a tab can accept an entry right now.
 *
 * Only feature readiness, deliberately: a tab is not disabled because a write
 * is in flight. Switching tabs mid-save is harmless — the draft is held by the
 * sheet, not by the mode — and freezing the whole row for the duration of a
 * network call would make the surface feel broken.
 */
export function isEntryTabReady(id: EntryTabId): boolean {
  return entryTab(id).pending === undefined;
}
