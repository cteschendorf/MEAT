import type { Food } from '@/domain/food/food';
import type { FoodId, ISODateTime, SourceRecordId } from '@/domain/shared/ids';

export const foodSourceIds = [
  'personal',
  'usda-core',
  'usda-fdc',
  'open-food-facts',
] as const;

export type FoodSourceId = (typeof foodSourceIds)[number];

const legacyProviderSourceIds = {
  usda: 'usda-fdc',
  off: 'open-food-facts',
} as const satisfies Readonly<Record<string, FoodSourceId>>;

export interface FoodRef {
  readonly sourceId: FoodSourceId;
  readonly recordId: SourceRecordId;
}

export interface FoodPortion {
  readonly id: string;
  readonly label: string;
  readonly quantity: number;
  readonly unit: string;
  readonly gramWeight?: number;
  readonly isDefault?: boolean;
}

export interface FoodProvenance {
  readonly provider: FoodSourceId;
  readonly recordId: SourceRecordId;
  readonly license?: {
    readonly name: string;
    readonly url?: string;
  };
  readonly dataset?: string;
  readonly release?: string;
  readonly retrievedAt?: ISODateTime;
  readonly recordUrl?: string;
}

export interface FoodCandidate {
  readonly ref: FoodRef;
  readonly food: Food;
  readonly portions: readonly FoodPortion[];
  readonly provenance: FoodProvenance;
}

export function foodIdForRef(ref: FoodRef): FoodId {
  return `${ref.sourceId}:${encodeURIComponent(ref.recordId)}` as FoodId;
}

function decodedRecordId(encoded: string): SourceRecordId {
  try {
    return decodeURIComponent(encoded) as SourceRecordId;
  } catch {
    return encoded as SourceRecordId;
  }
}

/**
 * Decode provider IDs written by build 1 before source-scoped IDs existed.
 * `food:*` is deliberately absent: it was the build-1 personal-food format.
 */
export function legacyProviderFoodRefFromFoodId(foodId: FoodId | string): FoodRef | null {
  const separator = foodId.indexOf(':');
  if (separator <= 0 || separator === foodId.length - 1) return null;
  const prefix = foodId.slice(0, separator);
  const sourceId = legacyProviderSourceIds[prefix as keyof typeof legacyProviderSourceIds];
  if (!sourceId) return null;
  return { sourceId, recordId: decodedRecordId(foodId.slice(separator + 1)) };
}

export function legacyProviderFoodIdForRef(ref: FoodRef): FoodId | null {
  if (ref.sourceId === 'usda-fdc') return `usda:${ref.recordId}` as FoodId;
  if (ref.sourceId === 'open-food-facts') return `off:${ref.recordId}` as FoodId;
  return null;
}

export function sourceIdFromFoodId(foodId: FoodId | string): FoodSourceId | null {
  const separator = foodId.indexOf(':');
  if (separator <= 0) return null;
  const prefix = foodId.slice(0, separator);
  if (foodSourceIds.includes(prefix as FoodSourceId)) return prefix as FoodSourceId;
  return legacyProviderSourceIds[prefix as keyof typeof legacyProviderSourceIds] ?? null;
}

export type FoodResultFreshness = 'network' | 'fresh-cache' | 'stale-cache';

export interface FoodProviderIssue {
  readonly kind: 'offline' | 'error' | 'throttled';
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly retryAt?: ISODateTime;
}

interface FoodSearchGroupBase {
  readonly sourceId: FoodSourceId;
  readonly query: string;
}

export type FoodSearchGroup =
  | (FoodSearchGroupBase & {
      readonly state: 'loading';
    })
  | (FoodSearchGroupBase & {
      readonly state: 'ready';
      readonly candidates: readonly FoodCandidate[];
      readonly freshness: Exclude<FoodResultFreshness, 'stale-cache'>;
    })
  | (FoodSearchGroupBase & {
      readonly state: 'empty';
      readonly freshness: Exclude<FoodResultFreshness, 'stale-cache'>;
    })
  | (FoodSearchGroupBase & {
      readonly state: 'offline';
      readonly candidates: readonly FoodCandidate[];
      readonly issue: FoodProviderIssue;
      readonly freshness?: 'stale-cache';
    })
  | (FoodSearchGroupBase & {
      readonly state: 'error';
      readonly candidates: readonly FoodCandidate[];
      readonly issue: FoodProviderIssue;
      readonly freshness?: 'stale-cache';
    })
  | (FoodSearchGroupBase & {
      readonly state: 'throttled';
      readonly candidates: readonly FoodCandidate[];
      readonly issue: FoodProviderIssue;
      readonly freshness?: 'stale-cache';
    });
