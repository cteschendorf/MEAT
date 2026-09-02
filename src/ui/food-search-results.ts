import type { Food, FoodCandidate, FoodSearchGroup, FoodSourceId } from '@/domain';
import type { FoodId, FoodServingId } from '@/domain/shared/ids';
import { scaleNutritionFacts } from '@/services/nutrition/engine';
import { formatCoreMetrics, type CoreMetric } from '@/ui/core-metrics';

/**
 * Turns provider-grouped search results into one unified, ranked list.
 *
 * Results used to be presented as four boxes, one per database, each headed by
 * a paragraph of provenance prose. That answers "what does each database think"
 * when the user asked "which chicken breast is this one" (THI-313).
 *
 * Grouping moves to a food-category axis instead, and provenance moves onto
 * every row. This does not merge databases: each row keeps its source-scoped
 * ID and shows where it came from. What is unified is the presentation.
 */

export type FoodResultTierId = 'yours' | 'common' | 'branded';

const TIER_FOR_SOURCE: Readonly<Record<FoodSourceId, FoodResultTierId>> = {
  personal: 'yours',
  'usda-core': 'common',
  'usda-fdc': 'common',
  'open-food-facts': 'branded',
};

export const SOURCE_LABELS: Readonly<Record<FoodSourceId, string>> = {
  personal: 'Your foods',
  'usda-core': 'USDA',
  'usda-fdc': 'USDA',
  'open-food-facts': 'Open Food Facts',
};

export const TIER_TITLES: Readonly<Record<FoodResultTierId, string>> = {
  yours: 'Your foods',
  common: 'Common',
  branded: 'Branded',
};

/**
 * The order sections fall back to when nothing separates them on relevance.
 *
 * `yours` is PINNED here rather than ranked: a food you created and kept is a
 * decision you already made about it, so when your own library answers the
 * query at all it answers first. Common and Branded compete (Charles, 1 Sep).
 */
const TIER_ORDER: readonly FoodResultTierId[] = ['yours', 'common', 'branded'];
const PINNED_TIER: FoodResultTierId = 'yours';

/** Word characters only — punctuation in “Chicken breast, roasted” is not a word. */
function words(text: string): readonly string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

/**
 * How well a name answers the query, 0–1.
 *
 * WHY THERE IS A SCORE AT ALL: providers rank internally and those ranks are
 * not comparable — USDA’s FTS rank and Open Food Facts’ relevance are
 * different scales measuring different corpora. Asking “which section holds
 * the best answer” requires one yardstick, so this is it, computed locally
 * from the query and the name and nothing else.
 *
 * THREE AXES, in strict priority:
 *
 *   1. COVERAGE. A result missing a query term is a worse answer than any
 *      result containing all of them, however good its individual matches
 *      are. The partial branch tops out below the full branch’s floor, so
 *      that ordering can never invert.
 *   2. QUALITY. A whole word equal to the term beats a word starting with it,
 *      which beats a word merely containing it.
 *   3. POSITION. “Chicken breast” answers “chicken” better than “Soup,
 *      cream of chicken” does.
 *
 * WHAT IS DELIBERATELY NOT AN AXIS: name length. A first draft rewarded
 * brevity, and on the single-term query “chicken” that made “Chicken strips”
 * beat “Chicken breast, roasted” on nothing but word count — an arbitrary
 * winner presented as a judgement. Where this function cannot tell two
 * results apart it returns the same number, the sort is stable, and the
 * provider’s own ordering survives. Ties are the honest outcome, not a
 * failure to decide.
 */
export function matchScore(name: string, terms: readonly string[]): number {
  const wanted = terms.map((term) => term.toLowerCase()).filter(Boolean);
  if (!wanted.length) return 0;
  const nameWords = words(name);
  if (!nameWords.length) return 0;

  // The name IS the query. Nothing can answer better than that.
  if (nameWords.join(' ') === wanted.join(' ')) return 1;

  let matched = 0;
  let quality = 0;
  let positions = 0;

  for (const term of wanted) {
    let best = 0;
    let bestIndex = 0;
    nameWords.forEach((word, index) => {
      const value = word === term ? 1 : word.startsWith(term) ? 0.8 : word.includes(term) ? 0.4 : 0;
      if (value > best) {
        best = value;
        bestIndex = index;
      }
    });
    if (best > 0) {
      matched += 1;
      quality += best;
      positions += bestIndex;
    }
  }
  if (!matched) return 0;

  const averageQuality = quality / matched;
  const coverage = matched / wanted.length;
  // Ceiling 0.4 here, floor 0.6 below: no partial match can outrank a full one.
  if (coverage < 1) return 0.4 * coverage * averageQuality;

  const position = 1 / (1 + positions / matched);
  return 0.6 + 0.3 * averageQuality + 0.1 * position;
}

export type FoodResultMetric = CoreMetric;

export interface FoodResultRow {
  readonly key: string;
  readonly candidate: FoodCandidate;
  readonly name: string;
  /** Segments of the name, flagged where they match the query. */
  readonly nameSegments: readonly { readonly text: string; readonly matched: boolean }[];
  readonly metrics: readonly FoodResultMetric[];
  /** "1 breast (140 g)" — the household measure first, weight in parentheses. */
  readonly portionLabel: string;
  readonly sourceLabel: string;
  readonly favorite: boolean;
  readonly servingId?: FoodServingId;
  readonly gramWeight: number;
}

export interface FoodResultTier {
  readonly id: FoodResultTierId;
  readonly title: string;
  readonly rows: readonly FoodResultRow[];
  /** Sources in this tier that returned nothing usable, for a one-line note. */
  readonly notes: readonly string[];
  readonly loading: boolean;
}

/** The portion a row is added at when the user taps the add control. */
export function defaultPortionFor(candidate: FoodCandidate): {
  servingId?: FoodServingId;
  gramWeight: number;
  label: string;
} {
  const usable = candidate.portions.filter((portion) => (portion.gramWeight ?? 0) > 0);
  const preferred = usable.find((portion) => portion.isDefault) ?? usable[0];
  if (!preferred) return { gramWeight: 100, label: '100 g' };

  const grams = preferred.gramWeight ?? 100;
  const rounded = Math.round(grams * 10) / 10;
  const label = preferred.label.trim();
  // A label that is already just a weight should not be repeated in parentheses.
  const looksLikeWeight = /^[\d.]+\s*g$/i.test(label);
  return {
    servingId: preferred.id as FoodServingId,
    gramWeight: grams,
    label: !label || looksLikeWeight ? `${rounded} g` : `${label} (${rounded} g)`,
  };
}

/** Scales a food's nutrition to the given weight and formats the five metrics. */
export function metricsForPortion(food: Food, gramWeight: number): readonly FoodResultMetric[] {
  try {
    return formatCoreMetrics(scaleNutritionFacts(food.nutrition, gramWeight));
  } catch {
    // A food without a usable basis cannot be scaled; every metric is unknown
    // rather than an invented zero.
    return formatCoreMetrics(null);
  }
}

function splitOnQuery(
  name: string,
  terms: readonly string[],
): readonly { text: string; matched: boolean }[] {
  if (!terms.length) return [{ text: name, matched: false }];
  const pattern = terms
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean)
    .join('|');
  if (!pattern) return [{ text: name, matched: false }];

  const segments: { text: string; matched: boolean }[] = [];
  const regex = new RegExp(`(${pattern})`, 'ig');
  let lastIndex = 0;
  for (const match of name.matchAll(regex)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: name.slice(lastIndex, index), matched: false });
    segments.push({ text: match[0], matched: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < name.length) segments.push({ text: name.slice(lastIndex), matched: false });
  return segments.length ? segments : [{ text: name, matched: false }];
}

/** What the row prints, and therefore what the query is scored against. */
function nameFor(candidate: FoodCandidate): string {
  return candidate.food.brand
    ? `${candidate.food.brand} ${candidate.food.name}`
    : candidate.food.name;
}

function rowFor(
  candidate: FoodCandidate,
  terms: readonly string[],
  favorites: ReadonlySet<FoodId>,
): FoodResultRow {
  const portion = defaultPortionFor(candidate);
  const name = nameFor(candidate);
  return {
    key: candidate.food.id,
    candidate,
    name,
    nameSegments: splitOnQuery(name, terms),
    metrics: metricsForPortion(candidate.food, portion.gramWeight),
    portionLabel: portion.label,
    sourceLabel: SOURCE_LABELS[candidate.ref.sourceId],
    favorite: favorites.has(candidate.food.id),
    ...(portion.servingId ? { servingId: portion.servingId } : {}),
    gramWeight: portion.gramWeight,
  };
}

/**
 * Collapses rows that are literally the same record seen twice.
 *
 * A food present in both the offline USDA core and USDA online is the same FDC
 * record from the same authority, carrying the same recordId. Showing it twice
 * is noise, and preferring the offline copy keeps the row usable without a
 * network. Dedup never crosses provider families: a USDA record and an Open
 * Food Facts record are different records even when they describe the same
 * product, and merging them is exactly what the architecture forbids.
 */
const PROVIDER_FAMILY: Readonly<Record<FoodSourceId, string>> = {
  personal: 'personal',
  'usda-core': 'usda',
  'usda-fdc': 'usda',
  'open-food-facts': 'open-food-facts',
};

const FAMILY_PREFERENCE: Readonly<Record<FoodSourceId, number>> = {
  personal: 0,
  'usda-core': 0,
  'usda-fdc': 1,
  'open-food-facts': 0,
};

function dedupeWithinFamily(candidates: readonly FoodCandidate[]): readonly FoodCandidate[] {
  const best = new Map<string, FoodCandidate>();
  for (const candidate of candidates) {
    const key = `${PROVIDER_FAMILY[candidate.ref.sourceId]}:${candidate.ref.recordId}`;
    const existing = best.get(key);
    if (
      !existing ||
      FAMILY_PREFERENCE[candidate.ref.sourceId] < FAMILY_PREFERENCE[existing.ref.sourceId]
    ) {
      best.set(key, candidate);
    }
  }
  return [...best.values()];
}

export interface BuildFoodResultsOptions {
  readonly groups: readonly FoodSearchGroup[];
  readonly query: string;
  readonly favoriteIds?: readonly FoodId[];
  /** Sources the user has switched off, so their absence can be explained once. */
  readonly disabledSources?: readonly FoodSourceId[];
}

export function buildFoodResultTiers({
  groups,
  query,
  favoriteIds = [],
  disabledSources = [],
}: BuildFoodResultsOptions): readonly FoodResultTier[] {
  const terms = query.trim().split(/\s+/).filter(Boolean);
  const favorites = new Set(favoriteIds);
  const disabled = new Set(disabledSources);

  const byTier = new Map<FoodResultTierId, FoodCandidate[]>();
  const notes = new Map<FoodResultTierId, string[]>();
  const loading = new Set<FoodResultTierId>();

  for (const group of groups) {
    const tier = TIER_FOR_SOURCE[group.sourceId];
    if (disabled.has(group.sourceId)) continue;

    if (group.state === 'loading') {
      loading.add(tier);
      continue;
    }

    const candidates = 'candidates' in group ? group.candidates : [];
    if (candidates.length) {
      byTier.set(tier, [...(byTier.get(tier) ?? []), ...candidates]);
    }

    // Only a failure the user can act on earns a line. An empty result inside a
    // tier that has other rows needs no explanation at all.
    if (group.state === 'offline' || group.state === 'error') {
      const existing = notes.get(tier) ?? [];
      notes.set(tier, [...existing, `${SOURCE_LABELS[group.sourceId]} is unavailable right now.`]);
    }
  }

  const built = TIER_ORDER.map((id) => {
    const candidates = dedupeWithinFamily(byTier.get(id) ?? []);
    // Scored once, here, so the row order and the section order are decided by
    // the same number rather than by two rules that could disagree.
    const scored = candidates
      .map((candidate) => ({
        candidate,
        score: matchScore(nameFor(candidate), terms),
      }))
      // Stable: an equal score leaves the provider's own ordering untouched,
      // which is the right answer when nothing here can tell two rows apart.
      .sort((left, right) => right.score - left.score);

    return {
      tier: {
        id,
        title: TIER_TITLES[id],
        rows: scored.map(({ candidate }) => rowFor(candidate, terms, favorites)),
        notes: notes.get(id) ?? [],
        loading: loading.has(id),
      },
      best: scored[0]?.score ?? 0,
    };
  }).filter(({ tier }) => tier.rows.length > 0 || tier.notes.length > 0 || tier.loading);

  // SECTIONS ARE RANKED ONLY ONCE EVERY SOURCE HAS SETTLED.
  //
  // Results stream in per provider — `onGroup` fires as each one lands — so
  // ranking eagerly would re-order the headings under the user's thumb two or
  // three times per search. Holding the declared order until the last source
  // reports costs one re-order at the end instead of one per provider.
  //
  // Rows inside a section are sorted immediately, because a row settling into
  // place within its own heading is ordinary; a heading moving is not.
  if (built.some(({ tier }) => tier.loading)) return built.map(({ tier }) => tier);

  return [...built]
    .sort((left, right) => {
      const pinned =
        Number(right.tier.id === PINNED_TIER) - Number(left.tier.id === PINNED_TIER);
      return pinned !== 0 ? pinned : right.best - left.best;
    })
    .map(({ tier }) => tier);
}
