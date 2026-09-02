import type { Food, FoodServing, NutrientValue, NutritionSource } from '@/domain';
import type { FoodCandidate, FoodPortion, FoodSourceId } from '@/domain/food/source';
import { foodIdForRef } from '@/domain/food/source';
import type { FoodServingId, ISODateTime, SourceRecordId } from '@/domain/shared/ids';
import { gramsForAmount, type MassUnit } from '@/domain/nutrition/measurement';
import { ApiError } from '@/data/providers/api-error';
import {
  assumedGramsForMillilitres,
  servingMeasureFromText,
} from '@/data/providers/serving-size-text';

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numeric(value: unknown): number | undefined {
  const converted = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(converted) ? converted : undefined;
}

function nonnegativeNumeric(value: unknown): number | undefined {
  const converted = numeric(value);
  return converted !== undefined && converted >= 0 ? converted : undefined;
}

function asRecordId(value: unknown): SourceRecordId | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value) as SourceRecordId;
  return nonEmptyString(value) as SourceRecordId | undefined;
}

/**
 * Provider spellings for the mass units a serving can be stated in.
 *
 * A package's own serving size is the portion people actually eat, so losing it
 * sends them to a synthesized "100 g" that nobody weighs out. Only a literal
 * "g" used to be recognised, which quietly discarded every serving expressed in
 * ounces or kilograms. Volume spellings are deliberately absent: converting
 * those needs the food's density, and inventing one is not on offer (THI-317).
 */
const massUnitSpellings: Readonly<Record<string, MassUnit>> = {
  g: 'g',
  gr: 'g',
  gram: 'g',
  grams: 'g',
  gramme: 'g',
  grammes: 'g',
  grm: 'g',
  kg: 'kg',
  kilogram: 'kg',
  kilograms: 'kg',
  oz: 'oz',
  ounce: 'oz',
  ounces: 'oz',
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
};

/** Grams for a serving stated in a mass unit, or undefined when it is not one. */
function servingGramWeight(amount: number | undefined, unit: string | undefined): number | undefined {
  if (amount === undefined || !unit) return undefined;
  const massUnit = massUnitSpellings[unit.trim().toLowerCase()];
  if (!massUnit) return undefined;
  return gramsForAmount(amount, massUnit) ?? undefined;
}

function portionFromServing(serving: FoodServing): FoodPortion {
  return {
    id: serving.id,
    label: serving.label,
    quantity: serving.quantity,
    unit: serving.unit,
    ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
    ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
  };
}

function portionsFor(food: Food): readonly FoodPortion[] {
  if (food.servings.length) return food.servings.map(portionFromServing);
  return [{ id: `${food.id}:100g`, label: '100 g', quantity: 100, unit: 'g', gramWeight: 100, isDefault: true }];
}

function coreNutrition(
  values: readonly {
    code: string;
    name: string;
    unit: 'kcal' | 'g';
    value?: number;
  }[],
  source: NutritionSource,
): readonly NutrientValue[] {
  return values.map(({ code, name, unit, value }) =>
    value === undefined
      ? { nutrient: { code, name, unit }, state: 'unknown', source }
      : { nutrient: { code, name, unit }, state: 'known', value, source },
  );
}

function usdaNutrientCode(name: string, unit: string, id?: number): string {
  const key = `${name}|${unit.toUpperCase()}`;
  const overrides: Readonly<Record<string, string>> = {
    'Energy|KCAL': 'energy-kcal',
    'Protein|G': 'protein-g',
    'Carbohydrate, by difference|G': 'carbohydrate-g',
    'Total lipid (fat)|G': 'fat-g',
    'Fiber, total dietary|G': 'fiber-g',
  };
  if (overrides[key]) return overrides[key];
  const base = id === undefined ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : `usda-${id}`;
  return `${base}-${unit.toLowerCase()}`;
}

function parseUsdaNutrients(value: unknown, source: NutritionSource): readonly NutrientValue[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ApiError('invalid-response', 'USDA foodNutrients must be an array.');
  return value.flatMap((entry): NutrientValue[] => {
    if (!isObject(entry) || !isObject(entry.nutrient)) return [];
    const name = nonEmptyString(entry.nutrient.name);
    const unitName = nonEmptyString(entry.nutrient.unitName);
    if (!name || !unitName) return [];
    const amount = nonnegativeNumeric(entry.amount);
    const nutrientId = numeric(entry.nutrient.id);
    const nutrient = {
      code: usdaNutrientCode(name, unitName, nutrientId),
      name,
      unit: unitName.toLowerCase(),
    };
    return [amount === undefined
      ? { nutrient, state: 'unknown', source }
      : { nutrient, state: 'known', value: amount, source }];
  });
}

function canonicalUsdaRecord(value: unknown, fallbackNow: ISODateTime): FoodCandidate | null {
  if (!isObject(value) || !isObject(value.nutrition)) return null;
  const recordId = asRecordId(value.fdcId);
  const name = nonEmptyString(value.name);
  if (!recordId || !name) return null;
  if (!Array.isArray(value.nutrition.nutrients) || !Array.isArray(value.portions)) {
    throw new ApiError('invalid-response', 'USDA proxy food is missing nutrition or portions.');
  }
  const ref = { sourceId: 'usda-fdc' as const, recordId };
  const foodId = foodIdForRef(ref);
  const retrievedAtRaw = isObject(value.provenance)
    ? nonEmptyString(value.provenance.retrievedAt)
    : undefined;
  const retrievedAt = retrievedAtRaw && Number.isFinite(Date.parse(retrievedAtRaw))
    ? (new Date(retrievedAtRaw).toISOString() as ISODateTime)
    : fallbackNow;
  const source: NutritionSource = {
    kind: 'usda',
    provider: 'USDA FoodData Central',
    recordId,
    retrievedAt,
  };
  const nutrients = value.nutrition.nutrients.flatMap((entry): NutrientValue[] => {
    if (!isObject(entry)) return [];
    const code = nonEmptyString(entry.code);
    const nutrientName = nonEmptyString(entry.name);
    const unit = nonEmptyString(entry.unit);
    if (!code || !nutrientName || !unit) return [];
    const amount = nonnegativeNumeric(entry.amount);
    return [amount === undefined || entry.state === 'unknown'
      ? { nutrient: { code, name: nutrientName, unit }, state: 'unknown', source }
      : { nutrient: { code, name: nutrientName, unit }, state: 'known', value: amount, source }];
  });
  const servings = value.portions.flatMap((portion, index): FoodServing[] => {
    if (!isObject(portion)) return [];
    const quantity = numeric(portion.amount);
    const unit = nonEmptyString(portion.unit);
    if (quantity === undefined || quantity <= 0 || !unit) return [];
    const gramWeight = numeric(portion.gramWeight);
    const label = nonEmptyString(portion.description) ?? `${quantity} ${unit}`;
    return [{
      id: `${foodId}:portion:${index + 1}` as FoodServingId,
      foodId,
      label,
      quantity,
      unit,
      ...(gramWeight === undefined ? {} : { gramWeight }),
      ...(index === 0 ? { isDefault: true } : {}),
    }];
  });
  const brand = nonEmptyString(value.brand);
  const barcode = nonEmptyString(value.barcode);
  const dataType = nonEmptyString(value.dataType);
  const food: Food = {
    id: foodId,
    kind: value.kind === 'branded' ? 'branded' : 'generic',
    name,
    ...(brand === undefined ? {} : { brand }),
    ...(barcode === undefined ? {} : { barcode }),
    nutrition: { basisGrams: 100, nutrients },
    servings,
    primarySource: source,
    createdAt: retrievedAt,
    updatedAt: retrievedAt,
  };
  return {
    ref,
    food,
    portions: portionsFor(food),
    provenance: {
      provider: 'usda-fdc',
      recordId,
      license: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      dataset: dataType ? `USDA FoodData Central — ${dataType}` : 'USDA FoodData Central',
      retrievedAt,
      recordUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${encodeURIComponent(recordId)}/nutrients`,
    },
  };
}

function usdaRecord(value: unknown, now: ISODateTime): FoodCandidate | null {
  if (!isObject(value)) return null;
  const canonical = canonicalUsdaRecord(value, now);
  if (canonical) return canonical;
  const recordId = asRecordId(value.fdcId ?? value.id);
  const name = nonEmptyString(value.description ?? value.name);
  if (!recordId || !name) return null;

  const ref = { sourceId: 'usda-fdc' as const, recordId };
  const foodId = foodIdForRef(ref);
  const source: NutritionSource = {
    kind: 'usda',
    provider: 'USDA FoodData Central',
    recordId,
    retrievedAt: now,
  };
  const servingSize = numeric(value.servingSize);
  const servingUnit = nonEmptyString(value.servingSizeUnit);
  const brand = nonEmptyString(value.brandName ?? value.brandOwner);
  const barcode = nonEmptyString(value.gtinUpc ?? value.barcode);
  const servingGrams = servingGramWeight(servingSize, servingUnit);
  const servings: FoodServing[] = servingGrams === undefined
    ? []
    : [{
        id: `${foodId}:serving` as FoodServingId,
        foodId,
        label: nonEmptyString(value.householdServingFullText) ?? 'serving',
        gramWeight: servingGrams,
        quantity: 1,
        unit: servingUnit ?? 'g',
        isDefault: true,
      }];
  const dataType = nonEmptyString(value.dataType);
  const food: Food = {
    id: foodId,
    kind: dataType === 'Branded' ? 'branded' : 'generic',
    name,
    ...(brand === undefined ? {} : { brand }),
    ...(barcode === undefined ? {} : { barcode }),
    nutrition: { basisGrams: 100, nutrients: parseUsdaNutrients(value.foodNutrients, source) },
    servings,
    primarySource: source,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ref,
    food,
    portions: portionsFor(food),
    provenance: {
      provider: 'usda-fdc',
      recordId,
      license: { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
      dataset: 'USDA FoodData Central',
      retrievedAt: now,
      recordUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${encodeURIComponent(recordId)}/nutrients`,
    },
  };
}

export function parseUsdaSearchResponse(value: unknown, now: ISODateTime): readonly FoodCandidate[] {
  if (!isObject(value)) throw new ApiError('invalid-response', 'USDA search response must be an object.');
  const envelopeData = isObject(value.data) ? value.data : undefined;
  const foods = envelopeData?.foods ?? value.foods ?? value.items;
  if (!Array.isArray(foods)) throw new ApiError('invalid-response', 'USDA search response is missing foods.');
  return foods.flatMap((item) => {
    const candidate = usdaRecord(item, now);
    return candidate ? [candidate] : [];
  });
}

export function parseUsdaFoodResponse(value: unknown, now: ISODateTime): FoodCandidate | null {
  if (!isObject(value)) throw new ApiError('invalid-response', 'USDA food response must be an object.');
  const envelopeData = isObject(value.data) ? value.data : undefined;
  const foodValue = envelopeData?.food ?? value.food ?? value.item ?? value;
  const candidate = usdaRecord(foodValue, now);
  if (!candidate && foodValue !== null) {
    throw new ApiError('invalid-response', 'USDA food response is missing a valid food.');
  }
  return candidate;
}

/**
 * The package's own serving, in grams.
 *
 * Three fields can carry it and Open Food Facts populates them unevenly, so
 * they are tried in order of how little has to be assumed (THI-338):
 *
 * 1. `serving_quantity` with a mass `serving_quantity_unit` — stated outright.
 * 2. A mass inside `serving_size`, the label text: "1 bar (40 g)". Also stated
 *    outright; we were using this field as a caption and discarding the number.
 * 3. `serving_quantity` with no unit at all. OFF normalises that number to
 *    grams or millilitres, and under the assumption below both land on the same
 *    figure — so the missing unit stops mattering rather than being guessed at.
 * 4. A volume, from either field, converted at 1 g/ml. This is the one
 *    assumption, and `serving-size-text.ts` says what it costs.
 *
 * Before this, 1, 2 and 3 all required `serving_quantity_unit` to be present —
 * a late addition to the schema that many products predate — so every one of
 * them fell through to a synthesized 100 g.
 */
function offServingGrams(value: JsonObject): number | undefined {
  const quantity = numeric(value.serving_quantity);
  const unit = nonEmptyString(value.serving_quantity_unit);
  const stated = servingGramWeight(quantity, unit);
  if (stated !== undefined) return stated;

  const fromText = servingMeasureFromText(nonEmptyString(value.serving_size));
  if (fromText?.grams !== undefined) return fromText.grams;

  if (quantity !== undefined && quantity > 0 && !unit) return quantity;

  if (fromText?.millilitres !== undefined) {
    return assumedGramsForMillilitres(fromText.millilitres);
  }
  if (quantity !== undefined && quantity > 0 && unit) {
    const millilitres = servingMeasureFromText(`${quantity} ${unit}`)?.millilitres;
    if (millilitres !== undefined) return assumedGramsForMillilitres(millilitres);
  }
  return undefined;
}

function offServing(value: JsonObject, sourceId: FoodSourceId, recordId: SourceRecordId): readonly FoodServing[] {
  const grams = offServingGrams(value);
  if (grams === undefined || grams <= 0) return [];

  const quantity = numeric(value.serving_quantity);
  const unit = nonEmptyString(value.serving_quantity_unit);
  const ref = { sourceId, recordId };
  const foodId = foodIdForRef(ref);
  // The label keeps the product's own wording, including when that wording is a
  // volume. "250 ml" on screen beside an assumed weight is the assumption made
  // visible; rewriting it to "250 g" would hide it.
  const label = nonEmptyString(value.serving_size)
    ?? (quantity !== undefined && unit ? `${quantity} ${unit}` : `${Math.round(grams * 10) / 10} g`);
  return [{
    id: `${foodId}:serving` as FoodServingId,
    foodId,
    label,
    quantity: 1,
    unit: unit ?? 'g',
    gramWeight: grams,
    isDefault: true,
  }];
}

function offRecord(value: unknown, now: ISODateTime): FoodCandidate | null {
  if (!isObject(value)) return null;
  const recordId = asRecordId(value.code ?? value._id ?? value.id);
  const name = nonEmptyString(
    value.product_name ?? value.product_name_en ?? value.abbreviated_product_name ?? value.generic_name,
  );
  if (!recordId || !name) return null;
  const ref = { sourceId: 'open-food-facts' as const, recordId };
  const foodId = foodIdForRef(ref);
  const source: NutritionSource = {
    kind: 'external-api',
    provider: 'Open Food Facts',
    recordId,
    retrievedAt: now,
  };
  if (value.nutriments !== undefined && !isObject(value.nutriments)) {
    throw new ApiError('invalid-response', 'Open Food Facts nutriments must be an object.');
  }
  const nutriments = isObject(value.nutriments) ? value.nutriments : {};
  const energyKcal = nonnegativeNumeric(nutriments['energy-kcal_100g']);
  const energyKj = nonnegativeNumeric(nutriments['energy-kj_100g']);
  const protein = nonnegativeNumeric(nutriments.proteins_100g);
  const carbohydrate = nonnegativeNumeric(nutriments.carbohydrates_100g);
  const fat = nonnegativeNumeric(nutriments.fat_100g);
  const fiber = nonnegativeNumeric(nutriments.fiber_100g);
  const nutrition = coreNutrition([
    { code: 'energy-kcal', name: 'Energy', unit: 'kcal', ...(energyKcal === undefined && energyKj === undefined ? {} : { value: energyKcal ?? energyKj! / 4.184 }) },
    { code: 'protein-g', name: 'Protein', unit: 'g', ...(protein === undefined ? {} : { value: protein }) },
    { code: 'carbohydrate-g', name: 'Carbohydrate', unit: 'g', ...(carbohydrate === undefined ? {} : { value: carbohydrate }) },
    { code: 'fat-g', name: 'Fat', unit: 'g', ...(fat === undefined ? {} : { value: fat }) },
    { code: 'fiber-g', name: 'Fiber', unit: 'g', ...(fiber === undefined ? {} : { value: fiber }) },
  ], source);
  const servings = offServing(value, 'open-food-facts', recordId);
  const brand = nonEmptyString(value.brands);
  const food: Food = {
    id: foodId,
    kind: 'branded',
    name,
    ...(brand === undefined ? {} : { brand }),
    barcode: recordId,
    nutrition: { basisGrams: 100, nutrients: nutrition },
    servings,
    primarySource: source,
    createdAt: now,
    updatedAt: now,
  };
  return {
    ref,
    food,
    portions: portionsFor(food),
    provenance: {
      provider: 'open-food-facts',
      recordId,
      license: { name: 'ODbL 1.0', url: 'https://opendatacommons.org/licenses/odbl/1-0/' },
      dataset: 'Open Food Facts',
      retrievedAt: now,
      recordUrl: `https://world.openfoodfacts.org/product/${encodeURIComponent(recordId)}`,
    },
  };
}

export function parseOpenFoodFactsSearchResponse(value: unknown, now: ISODateTime): readonly FoodCandidate[] {
  if (!isObject(value) || !Array.isArray(value.products)) {
    throw new ApiError('invalid-response', 'Open Food Facts search response is missing products.');
  }
  return value.products.flatMap((item) => {
    const candidate = offRecord(item, now);
    return candidate ? [candidate] : [];
  });
}

export function parseOpenFoodFactsProductResponse(value: unknown, now: ISODateTime): FoodCandidate | null {
  if (!isObject(value)) throw new ApiError('invalid-response', 'Open Food Facts product response must be an object.');
  if (value.status === 'failure' || value.status === 0 || value.product === null) return null;
  const candidate = offRecord(value.product ?? value, now);
  if (!candidate) throw new ApiError('invalid-response', 'Open Food Facts product response is missing a valid product.');
  return candidate;
}
