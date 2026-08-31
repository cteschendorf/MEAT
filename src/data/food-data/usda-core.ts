import type { SQLiteDatabase } from 'expo-sqlite';

import type { Food, NutrientDefinition, NutrientValue } from '@/domain';
import type {
  FoodCandidate,
  FoodProvenance,
  FoodRef,
  FoodSearchGroup,
} from '@/domain/food/source';
import { foodIdForRef } from '@/domain/food/source';
import type { FoodServingId, ISODateTime, SourceRecordId } from '@/domain/shared/ids';
import type {
  FoodLookupResult,
  FoodProvider,
  FoodProviderCapabilities,
  FoodSearchOptions,
} from '@/data/providers/contracts';

export const USDA_CORE_DATABASE_NAME = 'meat-usda-core.sqlite';
export const USDA_CORE_RELEASE_LABEL = 'Foundation 2026-04-30 · FNDDS 2024-10-31 · SR Legacy 2018-04';

const coreNutrients: readonly NutrientDefinition[] = [
  { code: 'energy-kcal', name: 'Energy', unit: 'kcal' },
  { code: 'protein-g', name: 'Protein', unit: 'g' },
  { code: 'carbohydrate-g', name: 'Carbohydrate', unit: 'g' },
  { code: 'fat-g', name: 'Fat', unit: 'g' },
  { code: 'fiber-g', name: 'Fiber', unit: 'g' },
];

interface CoreFoodRow {
  fdc_id: number;
  description: string;
  data_type: string;
  dataset_id: string;
  publication_date: string | null;
  release: string;
}

interface CoreNutrientRow {
  fdc_id: number;
  nutrient_code: string;
  nutrient_name: string;
  unit: string;
  amount_per_100g: number;
}

interface CorePortionRow {
  fdc_id: number;
  portion_index: number;
  amount: number | null;
  gram_weight: number;
  measure_unit: string | null;
  modifier: string | null;
  description: string | null;
}

export interface UsdaCoreDatabase {
  getAllAsync<T>(sql: string, ...params: (string | number)[]): Promise<T[]>;
}

let databasePromise: Promise<SQLiteDatabase> | null = null;

export function openUsdaCoreDatabase(): Promise<SQLiteDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = (async () => {
    // Keep the provider/parser usable in Node-based behavioral tests. The
    // native SQLite runtime is loaded only when the app opens the asset.
    const { importDatabaseFromAssetAsync, openDatabaseAsync } = await import('expo-sqlite');
    await importDatabaseFromAssetAsync(USDA_CORE_DATABASE_NAME, {
      // Metro resolves the bundled database as an opaque native asset.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      assetId: require('../../../assets/usda/meat-usda-core.sqlite') as number,
    });
    const db = await openDatabaseAsync(USDA_CORE_DATABASE_NAME, { useNewConnection: true });
    await db.execAsync('PRAGMA query_only = ON;');
    return db;
  })().catch((error: unknown) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

/** Shortest stem worth searching; below this a prefix matches far too much. */
const MINIMUM_STEM_LENGTH = 3;
/** Terms shorter than this are left alone; "is" or "as" carry no plural signal. */
const MINIMUM_PLURAL_LENGTH = 4;

/**
 * Terms are matched as prefixes, so a plural can never reach its singular:
 * "breasts"* does not match "breast". Pair each plural with a singular stem so
 * "chicken breasts" finds what "chicken breast" finds.
 *
 * Over-stemming is safe here and under-stemming is not: every stem is searched
 * as a prefix alongside the original term, so a shorter stem only widens the
 * match, while a missing stem loses results entirely.
 */
export function singularStem(term: string): string | null {
  const lower = term.toLowerCase();
  if (lower.length < MINIMUM_PLURAL_LENGTH || !lower.endsWith('s')) return null;
  // "grass" and "swiss" are not plurals.
  if (lower.endsWith('ss')) return null;

  const stem = lower.endsWith('ies')
    ? `${term.slice(0, -3)}y`
    : /(?:ch|sh|s|x|z|o)es$/.test(lower)
      ? term.slice(0, -2)
      : term.slice(0, -1);

  if (stem.length < MINIMUM_STEM_LENGTH || stem === term) return null;
  return stem;
}

function ftsPrefix(term: string): string {
  return `"${term.replaceAll('"', '""')}"*`;
}

export function ftsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => {
      const stem = singularStem(term);
      return stem ? `(${ftsPrefix(term)} OR ${ftsPrefix(stem)})` : ftsPrefix(term);
    })
    .join(' AND ');
}

function releaseTimestamp(release: string): ISODateTime {
  const date = /^\d{4}-\d{2}$/.test(release) ? `${release}-01` : release;
  return `${date}T00:00:00.000Z` as ISODateTime;
}

function portionLabel(portion: CorePortionRow): string {
  return (
    portion.description?.trim() ||
    portion.modifier?.trim() ||
    [portion.amount, portion.measure_unit].filter((value) => value !== null && value !== '').join(' ') ||
    'serving'
  );
}

function candidateForRows(
  row: CoreFoodRow,
  nutrients: readonly CoreNutrientRow[],
  portions: readonly CorePortionRow[],
): FoodCandidate {
  const recordId = String(row.fdc_id) as SourceRecordId;
  const ref: FoodRef = { sourceId: 'usda-core', recordId };
  const id = foodIdForRef(ref);
  const retrievedAt = releaseTimestamp(row.release);
  const source = {
    kind: 'usda' as const,
    provider: 'USDA FoodData Central — on device',
    recordId,
    retrievedAt,
  };
  const byCode = new Map(nutrients.map((nutrient) => [nutrient.nutrient_code, nutrient]));
  const nutrientValues: NutrientValue[] = coreNutrients.map((definition) => {
    const value = byCode.get(definition.code);
    return value
      ? { nutrient: definition, state: 'known', value: value.amount_per_100g, source }
      : { nutrient: definition, state: 'unknown', source };
  });
  const sourcePortions = portions.map((portion, index) => ({
    id: `${id}:portion:${portion.portion_index}` as FoodServingId,
    foodId: id,
    label: portionLabel(portion),
    gramWeight: portion.gram_weight,
    quantity: portion.amount ?? 1,
    unit: portion.measure_unit?.trim() || 'serving',
    isDefault: index === 0,
  }));
  const servings = sourcePortions.length
    ? sourcePortions
    : [
        {
          id: `${id}:portion:100g` as FoodServingId,
          foodId: id,
          label: '100 g',
          gramWeight: 100,
          quantity: 100,
          unit: 'g',
          isDefault: true,
        },
      ];
  const food: Food = {
    id,
    kind: 'generic',
    name: row.description,
    nutrition: { basisGrams: 100, nutrients: nutrientValues },
    servings,
    primarySource: source,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  };
  const provenance: FoodProvenance = {
    provider: 'usda-core',
    recordId,
    license: { name: 'CC0 1.0 Universal', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
    dataset: row.dataset_id,
    release: row.release,
    retrievedAt,
    recordUrl: `https://fdc.nal.usda.gov/food-details/${row.fdc_id}/nutrients`,
  };
  return {
    ref,
    food,
    portions: servings.map((serving) => ({
      id: serving.id,
      label: serving.label,
      quantity: serving.quantity,
      unit: serving.unit,
      ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
      ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
    })),
    provenance,
  };
}

async function hydrateCandidates(db: UsdaCoreDatabase, foods: readonly CoreFoodRow[]): Promise<readonly FoodCandidate[]> {
  if (foods.length === 0) return [];
  const placeholders = foods.map(() => '?').join(',');
  const ids = foods.map((food) => food.fdc_id);
  const [nutrients, portions] = await Promise.all([
    db.getAllAsync<CoreNutrientRow>(
      `SELECT fdc_id, nutrient_code, nutrient_name, unit, amount_per_100g
       FROM nutrient_values WHERE fdc_id IN (${placeholders})`,
      ...ids,
    ),
    db.getAllAsync<CorePortionRow>(
      `SELECT fdc_id, portion_index, amount, gram_weight, measure_unit, modifier, description
       FROM portions WHERE fdc_id IN (${placeholders})
       ORDER BY fdc_id, portion_index`,
      ...ids,
    ),
  ]);
  return foods.map((food) =>
    candidateForRows(
      food,
      nutrients.filter((nutrient) => nutrient.fdc_id === food.fdc_id),
      portions.filter((portion) => portion.fdc_id === food.fdc_id),
    ),
  );
}

export class UsdaCoreFoodProvider implements FoodProvider {
  readonly id = 'usda-core' as const;
  readonly capabilities: FoodProviderCapabilities = {
    search: true,
    getById: true,
    lookupBarcode: false,
    persist: false,
  };

  constructor(private readonly db: UsdaCoreDatabase) {}

  async search(query: string, options: FoodSearchOptions = {}): Promise<FoodSearchGroup> {
    const normalized = query.trim();
    if (!normalized) return { sourceId: this.id, query: normalized, state: 'empty', freshness: 'fresh-cache' };
    const limit = Math.min(30, Math.max(1, options.limit ?? 25));
    const rows = await this.db.getAllAsync<CoreFoodRow>(
      `SELECT f.fdc_id, f.description, f.data_type, f.dataset_id, f.publication_date, f.release
       FROM foods_fts
       JOIN foods f ON f.fdc_id = foods_fts.rowid
       WHERE foods_fts MATCH ?
       ORDER BY bm25(foods_fts), f.fdc_id
       LIMIT ?`,
      ftsQuery(normalized),
      limit,
    );
    const candidates = await hydrateCandidates(this.db, rows);
    return candidates.length
      ? { sourceId: this.id, query: normalized, state: 'ready', candidates, freshness: 'fresh-cache' }
      : { sourceId: this.id, query: normalized, state: 'empty', freshness: 'fresh-cache' };
  }

  async getById(ref: FoodRef): Promise<FoodLookupResult> {
    if (ref.sourceId !== this.id || !/^\d+$/.test(ref.recordId)) {
      return { candidate: null, freshness: 'fresh-cache' };
    }
    const rows = await this.db.getAllAsync<CoreFoodRow>(
      `SELECT fdc_id, description, data_type, dataset_id, publication_date, release
       FROM foods WHERE fdc_id = ? LIMIT 1`,
      Number(ref.recordId),
    );
    const candidates = await hydrateCandidates(this.db, rows);
    return { candidate: candidates[0] ?? null, freshness: 'fresh-cache' };
  }
}

export async function createUsdaCoreFoodProvider(): Promise<UsdaCoreFoodProvider> {
  return new UsdaCoreFoodProvider(await openUsdaCoreDatabase());
}
