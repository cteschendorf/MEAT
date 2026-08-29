export const API_VERSION = 'v1' as const;
export const USDA_PROVIDER = 'USDA FoodData Central' as const;
export const USDA_SOURCE = 'usda-fdc' as const;

export interface FoodProvenance {
  source: typeof USDA_SOURCE;
  provider: typeof USDA_PROVIDER;
  sourceRecordId: string;
  fdcId: number;
  dataType: string;
  license: 'CC0-1.0';
  retrievedAt: string;
}

export interface NutrientProvenance {
  source: typeof USDA_SOURCE;
  provider: typeof USDA_PROVIDER;
  fdcId: number;
  nutrientId?: number;
  derivationCode?: string;
}

export interface CanonicalNutrient {
  id?: number;
  number?: string;
  code: string;
  name: string;
  unit: string;
  state: 'known' | 'unknown';
  amount?: number;
  provenance: NutrientProvenance;
}

export interface CanonicalPortion {
  id: string;
  amount: number;
  unit: string;
  gramWeight?: number;
  description?: string;
}

export interface CanonicalFood {
  id: string;
  fdcId: number;
  dataType: string;
  kind: 'generic' | 'branded';
  name: string;
  brand?: string;
  barcode?: string;
  nutrition: {
    basisGrams: 100;
    nutrients: CanonicalNutrient[];
  };
  portions: CanonicalPortion[];
  provenance: FoodProvenance;
}

export interface SearchData {
  source: typeof USDA_SOURCE;
  foods: CanonicalFood[];
  pagination: {
    limit: number;
    returned: number;
    totalHits?: number;
  };
}

export interface FoodDetailData {
  source: typeof USDA_SOURCE;
  food: CanonicalFood;
}

export interface HealthData {
  service: 'meat-usda-proxy';
  status: 'ok';
}

export interface SuccessEnvelope<T> {
  apiVersion: typeof API_VERSION;
  data: T;
}

export type ApiErrorCode =
  | 'INVALID_QUERY'
  | 'INVALID_LIMIT'
  | 'INVALID_FDC_ID'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'RATE_LIMITED'
  | 'SERVICE_NOT_CONFIGURED'
  | 'FOOD_NOT_FOUND'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_FAILURE'
  | 'UPSTREAM_INVALID_RESPONSE'
  | 'INTERNAL_ERROR';

export interface ErrorEnvelope {
  apiVersion: typeof API_VERSION;
  error: {
    code: ApiErrorCode;
    message: string;
    retryable: boolean;
  };
}
