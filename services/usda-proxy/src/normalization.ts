import {
  USDA_PROVIDER,
  USDA_SOURCE,
  type CanonicalFood,
  type CanonicalNutrient,
  type CanonicalPortion,
} from './contracts.ts';
import { UpstreamShapeError } from './errors.ts';

type UnknownRecord = Record<string, unknown>;

const nutrientCodeOverrides: Readonly<Record<string, string>> = {
  'Energy|KCAL': 'energy-kcal',
  'Protein|G': 'protein-g',
  'Carbohydrate, by difference|G': 'carbohydrate-g',
  'Total lipid (fat)|G': 'fat-g',
  'Fiber, total dietary|G': 'fiber-g',
};

const energyNutrientPriority = [1008, 2047, 2048] as const;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): UnknownRecord {
  if (!isRecord(value)) throw new UpstreamShapeError();
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new UpstreamShapeError();
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new UpstreamShapeError();
  return value;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const parsed = optionalFiniteNumber(value);
  if (parsed === undefined) return undefined;
  if (parsed <= 0) throw new UpstreamShapeError();
  return parsed;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new UpstreamShapeError();
  }
  return value;
}

function requiredPositiveInteger(value: unknown): number {
  const parsed = optionalInteger(value);
  if (parsed === undefined || parsed <= 0) throw new UpstreamShapeError();
  return parsed;
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return normalized || 'unknown';
}

function normalizeUnit(rawUnit: string): string {
  const upper = rawUnit.trim().replace(/[µμ]/g, 'U').toUpperCase();
  switch (upper) {
    case 'KCAL':
      return 'kcal';
    case 'KJ':
      return 'kJ';
    case 'G':
      return 'g';
    case 'MG':
      return 'mg';
    case 'UG':
    case 'MCG':
      return 'mcg';
    case 'IU':
      return 'IU';
    default:
      return rawUnit.trim();
  }
}

function normalizeNutrient(value: unknown, fdcId: number): CanonicalNutrient {
  const entry = asRecord(value);
  const nested = isRecord(entry.nutrient) ? entry.nutrient : entry;
  const id = optionalInteger(nested.id ?? entry.nutrientId);
  const number = optionalString(nested.number ?? entry.nutrientNumber);
  const name = requiredString(nested.name ?? entry.nutrientName);
  const rawUnit = requiredString(nested.unitName ?? entry.unitName);
  const unit = normalizeUnit(rawUnit);
  const rawAmount = optionalFiniteNumber(entry.amount ?? entry.value);
  // USDA occasionally publishes negative analytical placeholders. They are
  // not meaningful nutrition quantities, so preserve them as unknown.
  const amount = rawAmount !== undefined && rawAmount >= 0 ? rawAmount : undefined;

  const derivation = isRecord(entry.foodNutrientDerivation)
    ? optionalString(entry.foodNutrientDerivation.code)
    : optionalString(entry.derivationCode);
  const override = nutrientCodeOverrides[`${name}|${rawUnit.toUpperCase()}`];
  const code = override ?? `${id === undefined ? slug(name) : `usda-${id}`}-${slug(unit)}`;

  return {
    ...(id === undefined ? {} : { id }),
    ...(number === undefined ? {} : { number }),
    code,
    name,
    unit,
    state: amount === undefined ? 'unknown' : 'known',
    ...(amount === undefined ? {} : { amount }),
    provenance: {
      source: USDA_SOURCE,
      provider: USDA_PROVIDER,
      fdcId,
      ...(id === undefined ? {} : { nutrientId: id }),
      ...(derivation === undefined ? {} : { derivationCode: derivation }),
    },
  };
}

function normalizeNutrients(values: readonly unknown[], fdcId: number): CanonicalNutrient[] {
  const nutrients = values.map((nutrient) => normalizeNutrient(nutrient, fdcId));
  const energy = energyNutrientPriority
    .map((id) => nutrients.find((nutrient) => nutrient.id === id && nutrient.state === 'known'))
    .find((nutrient) => nutrient !== undefined)
    ?? energyNutrientPriority
      .map((id) => nutrients.find((nutrient) => nutrient.id === id))
      .find((nutrient) => nutrient !== undefined)
    ?? nutrients.find((nutrient) => nutrient.code === 'energy-kcal');

  const remaining = nutrients.filter(
    (nutrient) =>
      !energyNutrientPriority.includes(nutrient.id as (typeof energyNutrientPriority)[number])
      && nutrient.code !== 'energy-kcal',
  );
  if (!energy) return remaining;
  if (energy.unit !== 'kcal') throw new UpstreamShapeError();
  return [{ ...energy, code: 'energy-kcal' }, ...remaining];
}

function normalizePortion(value: unknown, fdcId: number, index: number): CanonicalPortion {
  const portion = asRecord(value);
  const measureUnit = isRecord(portion.measureUnit) ? portion.measureUnit : undefined;
  const rawId = portion.id;
  const portionId =
    typeof rawId === 'number' && Number.isSafeInteger(rawId)
      ? String(rawId)
      : typeof rawId === 'string' && rawId.trim()
        ? rawId.trim()
        : String(index + 1);
  const amount = optionalPositiveNumber(portion.amount) ?? 1;
  const gramWeight = optionalPositiveNumber(portion.gramWeight);
  const description = optionalString(
    portion.portionDescription ?? portion.disseminationText ?? portion.modifier,
  );
  const unit =
    optionalString(measureUnit?.abbreviation ?? measureUnit?.name) ??
    optionalString(portion.measureUnitAbbreviation ?? portion.measureUnitName) ??
    optionalString(portion.modifier) ??
    'serving';

  return {
    id: `usda:${fdcId}:portion:${portionId}`,
    amount,
    unit,
    ...(gramWeight === undefined ? {} : { gramWeight }),
    ...(description === undefined ? {} : { description }),
  };
}

function normalizePortions(food: UnknownRecord, fdcId: number): CanonicalPortion[] {
  const rawPortions = food.foodPortions;
  const rawMeasures = food.foodMeasures;
  if (rawPortions !== undefined && !Array.isArray(rawPortions)) throw new UpstreamShapeError();
  if (rawMeasures !== undefined && !Array.isArray(rawMeasures)) throw new UpstreamShapeError();

  // Detail responses use `foodPortions`; search responses, especially FNDDS,
  // commonly expose the equivalent gram weights as `foodMeasures`.
  const portionValues = rawPortions?.length ? rawPortions : (rawMeasures ?? []);
  const portions = portionValues.map((portion, index) => normalizePortion(portion, fdcId, index));
  if (portions.length > 0) return portions;

  const servingSize = optionalPositiveNumber(food.servingSize);
  const servingUnit = optionalString(food.servingSizeUnit);
  if (servingSize === undefined || servingUnit === undefined) return [];

  const description = optionalString(food.householdServingFullText);
  const unitIsGrams = servingUnit.toLowerCase() === 'g';
  return [
    {
      id: `usda:${fdcId}:portion:serving`,
      amount: servingSize,
      unit: servingUnit,
      ...(unitIsGrams ? { gramWeight: servingSize } : {}),
      ...(description === undefined ? {} : { description }),
    },
  ];
}

export function normalizeUsdaFood(
  value: unknown,
  retrievedAt: string,
  expectedFdcId?: number,
): CanonicalFood {
  const food = asRecord(value);
  const fdcId = requiredPositiveInteger(food.fdcId);
  if (expectedFdcId !== undefined && fdcId !== expectedFdcId) throw new UpstreamShapeError();

  const dataType = requiredString(food.dataType);
  const name = requiredString(food.description);
  const rawNutrients = food.foodNutrients;
  if (rawNutrients !== undefined && !Array.isArray(rawNutrients)) throw new UpstreamShapeError();

  const brand = optionalString(food.brandName) ?? optionalString(food.brandOwner);
  const barcode = optionalString(food.gtinUpc);
  const nutrients = normalizeNutrients(rawNutrients ?? [], fdcId);

  return {
    id: `usda:${fdcId}`,
    fdcId,
    dataType,
    kind: dataType === 'Branded' ? 'branded' : 'generic',
    name,
    ...(brand === undefined ? {} : { brand }),
    ...(barcode === undefined ? {} : { barcode }),
    nutrition: { basisGrams: 100, nutrients },
    portions: normalizePortions(food, fdcId),
    provenance: {
      source: USDA_SOURCE,
      provider: USDA_PROVIDER,
      sourceRecordId: String(fdcId),
      fdcId,
      dataType,
      license: 'CC0-1.0',
      retrievedAt,
    },
  };
}

export function normalizeUsdaSearch(
  value: unknown,
  retrievedAt: string,
): { foods: CanonicalFood[]; totalHits?: number } {
  const payload = asRecord(value);
  if (!Array.isArray(payload.foods)) throw new UpstreamShapeError();
  const totalHits = optionalInteger(payload.totalHits);
  return {
    foods: payload.foods.map((food) => normalizeUsdaFood(food, retrievedAt)),
    ...(totalHits === undefined ? {} : { totalHits }),
  };
}
