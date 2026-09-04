import type { SourceRecordId } from '@/domain/shared/ids';

/**
 * Canonical display order for the five core metrics: protein first, because the
 * product is protein-first. Every surface that renders metrics — search rows,
 * composer item rows, meal detail, the dashboard — renders in this order.
 *
 * This array is the single source of truth: `CoreNutrientCode` is derived from
 * it, so a code cannot exist without a defined position.
 */
export const coreNutrientDisplayOrder = [
  'protein-g',
  'energy-kcal',
  'carbohydrate-g',
  'fat-g',
  'fiber-g',
] as const;

export type CoreNutrientCode = (typeof coreNutrientDisplayOrder)[number];

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
  nutrients: readonly NutrientValue[];
}

export function knownNutrientValue(
  nutrient: NutrientDefinition,
  value: number,
  source?: NutritionSource,
): NutrientValue {
  return source
    ? { nutrient, state: 'known', value, source }
    : { nutrient, state: 'known', value };
}

export function unknownNutrientValue(nutrient: NutrientDefinition): NutrientValue {
  return { nutrient, state: 'unknown' };
}
