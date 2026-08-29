import type { SourceRecordId } from '@/domain/shared/ids';

export type CoreNutrientCode =
  | 'energy-kcal'
  | 'protein-g'
  | 'carbohydrate-g'
  | 'fat-g'
  | 'fiber-g';

export type NutrientCode = CoreNutrientCode | (string & {});

export type NutrientUnit = 'kcal' | 'g' | 'mg' | 'mcg' | 'IU' | (string & {});

export type NutritionSourceKind =
  | 'usda'
  | 'manufacturer'
  | 'nutrition-label'
  | 'user-entered'
  | 'external-api'
  | 'ai-estimate';

export interface NutritionSource {
  kind: NutritionSourceKind;
  provider: string;
  recordId?: SourceRecordId;
  retrievedAt?: string;
}

export interface NutrientDefinition {
  code: NutrientCode;
  name: string;
  unit: NutrientUnit;
}

export type NutrientDataState = 'known' | 'unknown' | 'estimated';

export interface NutrientValue {
  nutrient: NutrientDefinition;
  state: NutrientDataState;
  value?: number;
  source?: NutritionSource;
  confidence?: number;
}

export interface NutritionFacts {
  basisGrams?: number;
  nutrients: ReadonlyArray<NutrientValue>;
}

export function knownNutrientValue(
  nutrient: NutrientDefinition,
  value: number,
  source?: NutritionSource,
): NutrientValue {
  return { nutrient, state: 'known', value, source };
}

export function unknownNutrientValue(nutrient: NutrientDefinition): NutrientValue {
  return { nutrient, state: 'unknown' };
}
