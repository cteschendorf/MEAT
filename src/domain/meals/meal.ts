import type { FoodId, FoodServingId, ISODateTime, MealId, MealItemId, MediaId, RecipeId } from '@/domain/shared/ids';
import type { FoodRef } from '@/domain/food/source';

export const MEAL_TITLE_MAX_LENGTH = 80;
export const MEAL_LOCATION_MAX_LENGTH = 120;
export const MEAL_CAPTION_MAX_LENGTH = 500;
export const MEAL_MEDIA_MAX_COUNT = 5;

export interface MealLocation {
  readonly label: string;
  readonly placeRef?: {
    readonly provider: string;
    readonly id: string;
  };
}

export interface MealContextInput {
  readonly occurredAt: ISODateTime;
  readonly title?: string;
  readonly caption?: string;
  readonly location?: MealLocation;
  readonly mediaIds?: readonly MediaId[];
}

export interface PortionSelection {
  servingId?: FoodServingId;
  quantity: number;
  gramWeight?: number;
}

export interface MealItem {
  id: MealItemId;
  foodId: FoodId;
  /** Provider identity retained when this item came from a source-aware flow. */
  foodRef?: FoodRef;
  portion: PortionSelection;
  recipeId?: RecipeId;
  note?: string;
}

export interface Meal {
  id: MealId;
  occurredAt: ISODateTime;
  items: readonly MealItem[];
  mediaIds: readonly MediaId[];
  title?: string;
  caption?: string;
  location?: MealLocation;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

function normalizedOptionalText(value: string | undefined, maximum: number, label: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > maximum) {
    throw new Error(`${label} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function normalizePlaceRef(value: MealLocation['placeRef']): MealLocation['placeRef'] | undefined {
  if (!value) return undefined;
  const provider = value.provider.trim();
  const id = value.id.trim();
  if (!provider && !id) return undefined;
  if (!provider || !id) throw new Error('Location place reference requires both provider and ID.');
  return { provider, id };
}

/**
 * Canonicalize user-entered meal context before it reaches persistence.
 * Build-1 meals remain valid because every newly introduced value is optional.
 */
export function normalizeMealContextInput(input: MealContextInput): MealContextInput {
  const occurredAt = new Date(input.occurredAt);
  if (!input.occurredAt || Number.isNaN(occurredAt.getTime())) {
    throw new Error('Meal time must be a valid date and time.');
  }

  const title = normalizedOptionalText(input.title, MEAL_TITLE_MAX_LENGTH, 'Meal name');
  const caption = normalizedOptionalText(input.caption, MEAL_CAPTION_MAX_LENGTH, 'Meal note');
  const locationLabel = normalizedOptionalText(
    input.location?.label,
    MEAL_LOCATION_MAX_LENGTH,
    'Meal location',
  );
  const placeRef = normalizePlaceRef(input.location?.placeRef);
  if (!locationLabel && placeRef) {
    throw new Error('A location label is required when a place reference is present.');
  }

  const mediaIds = [...new Set(input.mediaIds ?? [])];
  if (mediaIds.length !== (input.mediaIds?.length ?? 0)) {
    throw new Error('A meal cannot contain the same photo more than once.');
  }
  if (mediaIds.length > MEAL_MEDIA_MAX_COUNT) {
    throw new Error(`A meal can contain up to ${MEAL_MEDIA_MAX_COUNT} photos.`);
  }

  return {
    occurredAt: occurredAt.toISOString() as ISODateTime,
    ...(title ? { title } : {}),
    ...(caption ? { caption } : {}),
    ...(locationLabel
      ? { location: { label: locationLabel, ...(placeRef ? { placeRef } : {}) } }
      : {}),
    ...(mediaIds.length > 0 ? { mediaIds } : {}),
  };
}
