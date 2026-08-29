import type { Food, NutrientDefinition, NutrientValue, NutritionSource } from '@/domain';
import type { FoodId, FoodServingId, ISODateTime, SourceRecordId } from '@/domain/shared/ids';

export type UsdaDataType = 'Foundation' | 'Survey (FNDDS)' | 'SR Legacy' | 'Branded';

export interface UsdaNutrientRecord { nutrient: { id?: number; name: string; unitName: string }; amount?: number }
export interface UsdaFoodRecord {
  fdcId: number; description: string; dataType: UsdaDataType | string; brandOwner?: string; brandName?: string;
  gtinUpc?: string; servingSize?: number; servingSizeUnit?: string; foodNutrients?: ReadonlyArray<UsdaNutrientRecord>;
}

const nutrientCodeOverrides: Readonly<Record<string, string>> = {
  'Energy|KCAL': 'energy-kcal', 'Protein|G': 'protein-g', 'Carbohydrate, by difference|G': 'carbohydrate-g',
  'Total lipid (fat)|G': 'fat-g', 'Fiber, total dietary|G': 'fiber-g',
};

function nutrientDefinition(record: UsdaNutrientRecord): NutrientDefinition {
  const unit = record.nutrient.unitName.toLowerCase();
  const override = nutrientCodeOverrides[`${record.nutrient.name}|${record.nutrient.unitName.toUpperCase()}`];
  const fallbackId = record.nutrient.id ? `usda-${record.nutrient.id}` : record.nutrient.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { code: override ?? `${fallbackId}-${unit}`, name: record.nutrient.name, unit };
}

export function normalizeUsdaFood(record: UsdaFoodRecord, now: ISODateTime): Food {
  const source: NutritionSource = { kind: 'usda', provider: 'USDA FoodData Central', recordId: String(record.fdcId) as SourceRecordId };
  const nutrients: NutrientValue[] = (record.foodNutrients ?? []).map((entry) => ({
    nutrient: nutrientDefinition(entry), state: entry.amount === undefined ? 'unknown' : 'known',
    ...(entry.amount === undefined ? {} : { value: entry.amount }), source,
  }));
  const id = `usda:${record.fdcId}` as FoodId;
  const servingGrams = record.servingSizeUnit?.toLowerCase() === 'g' ? record.servingSize : undefined;
  return {
    id, kind: record.dataType === 'Branded' ? 'branded' : 'generic', name: record.description,
    ...(record.brandName || record.brandOwner ? { brand: record.brandName ?? record.brandOwner } : {}),
    ...(record.gtinUpc ? { barcode: record.gtinUpc } : {}),
    nutrition: { basisGrams: 100, nutrients },
    servings: servingGrams ? [{ id: `${id}:serving` as FoodServingId, foodId: id, label: 'serving', gramWeight: servingGrams, quantity: 1, unit: record.servingSizeUnit ?? 'g', isDefault: true }] : [],
    primarySource: source, createdAt: now, updatedAt: now,
  };
}

export function sourcePriority(dataType: string): number {
  switch (dataType) { case 'Foundation': return 4; case 'Survey (FNDDS)': return 3; case 'SR Legacy': return 2; case 'Branded': return 1; default: return 0; }
}
