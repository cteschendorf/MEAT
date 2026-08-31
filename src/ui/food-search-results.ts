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

const TIER_ORDER: readonly FoodResultTierId[] = ['yours', 'common', 'branded'];

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

function rowFor(
  candidate: FoodCandidate,
  terms: readonly string[],
  favorites: ReadonlySet<FoodId>,
): FoodResultRow {
  const portion = defaultPortionFor(candidate);
  const name = candidate.food.brand
    ? `${candidate.food.brand} ${candidate.food.name}`
    : candidate.food.name;
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

  return TIER_ORDER.map((id) => {
    const candidates = dedupeWithinFamily(byTier.get(id) ?? []);
    return {
      id,
      title: TIER_TITLES[id],
      rows: candidates.map((candidate) => rowFor(candidate, terms, favorites)),
      notes: notes.get(id) ?? [],
      loading: loading.has(id),
    };
  }).filter((tier) => tier.rows.length > 0 || tier.notes.length > 0 || tier.loading);
}
