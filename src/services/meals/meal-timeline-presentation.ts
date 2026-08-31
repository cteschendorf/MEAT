/** Presentation adapter shared by the Today and Journal timelines. */
import type { Food, Meal } from '@/domain';
import type { FoodRepository, MediaRepository } from '@/data';

export interface MealTimelineItem {
  readonly id: string;
  readonly name: string;
  readonly portionText: string | null;
}

export interface MealTimelineEntry {
  readonly id: string;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly dayKey: string;
  readonly foodSummary: string;
  readonly mealTitle?: string;
  readonly locationLabel?: string;
  readonly thumbnailUri?: string;
  readonly items: readonly MealTimelineItem[];
}

export interface MealTimelineMedia {
  readonly uri: string;
}

export interface MealTimelineBuildOptions {
  readonly media?: Pick<MediaRepository, 'listByIds'>;
  readonly mediaById?: ReadonlyMap<string, MealTimelineMedia>;
}

function validDateMilliseconds(value: string): number {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

function pad(number: number): string {
  return String(number).padStart(2, '0');
}

export function localTimelineDayKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return 'unknown-date';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formattedPortion(meal: Meal, itemIndex: number): string | null {
  const portion = meal.items[itemIndex]?.portion;
  if (!portion) return null;
  if (portion.gramWeight !== undefined && Number.isFinite(portion.gramWeight) && portion.gramWeight > 0) {
    const grams = Math.round(portion.gramWeight * 10) / 10;
    return `${grams} g`;
  }
  if (Number.isFinite(portion.quantity) && portion.quantity > 0) {
    const quantity = Math.round(portion.quantity * 100) / 100;
    return `${quantity}× serving`;
  }
  return null;
}

export function derivedFoodSummary(names: readonly string[]): string {
  const displayNames = names.map((name) => name.trim()).filter(Boolean);
  if (displayNames.length === 0) return 'Meal entry';
  if (displayNames.length === 1) return displayNames[0] ?? 'Meal entry';
  if (displayNames.length === 2) return `${displayNames[0]} & ${displayNames[1]}`;
  return `${displayNames[0]}, ${displayNames[1]} +${displayNames.length - 2} more`;
}

function optionalLocationLabel(meal: Meal): string | undefined {
  const currentLabel = meal.location?.label.trim();
  if (currentLabel) return currentLabel;

  const candidate = meal as unknown as {
    readonly locationLabel?: unknown;
    readonly location?: unknown;
  };
  if (typeof candidate.locationLabel === 'string' && candidate.locationLabel.trim()) {
    return candidate.locationLabel.trim();
  }
  if (typeof candidate.location === 'string' && candidate.location.trim()) {
    return candidate.location.trim();
  }
  if (candidate.location && typeof candidate.location === 'object') {
    const location = candidate.location as Readonly<Record<string, unknown>>;
    for (const key of ['label', 'name', 'formattedAddress', 'address'] as const) {
      const value = location[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function displayableUri(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const uri = value.trim();
  return /^(?:file|content|https?|data):/i.test(uri) ? uri : undefined;
}

function optionalThumbnailUri(
  meal: Meal,
  mediaById?: ReadonlyMap<string, MealTimelineMedia>,
): string | undefined {
  const firstMediaId = meal.mediaIds[0];
  if (firstMediaId !== undefined) {
    const resolved = displayableUri(mediaById?.get(firstMediaId)?.uri);
    if (resolved) return resolved;
    const inlineId = displayableUri(firstMediaId);
    if (inlineId) return inlineId;
  }

  const candidate = meal as Meal & {
    readonly thumbnailUri?: unknown;
    readonly media?: readonly unknown[];
  };
  const direct = displayableUri(candidate.thumbnailUri);
  if (direct) return direct;
  const firstMedia = candidate.media?.[0];
  if (firstMedia && typeof firstMedia === 'object') {
    const media = firstMedia as Readonly<Record<string, unknown>>;
    return displayableUri(media.thumbnailUri) ?? displayableUri(media.uri);
  }
  return undefined;
}

export function compareTimelineEntriesChronologically(
  left: MealTimelineEntry,
  right: MealTimelineEntry,
): number {
  const occurrence = validDateMilliseconds(left.occurredAt) - validDateMilliseconds(right.occurredAt);
  if (occurrence !== 0) return occurrence;
  const creation = validDateMilliseconds(left.createdAt) - validDateMilliseconds(right.createdAt);
  if (creation !== 0) return creation;
  return left.id === right.id ? 0 : left.id < right.id ? -1 : 1;
}

export interface MealTimelineSection {
  readonly dayKey: string;
  readonly entries: readonly MealTimelineEntry[];
}

export function groupTimelineEntries(
  entries: readonly MealTimelineEntry[],
): readonly MealTimelineSection[] {
  const byDay = new Map<string, MealTimelineEntry[]>();
  for (const entry of entries) {
    const current = byDay.get(entry.dayKey) ?? [];
    current.push(entry);
    byDay.set(entry.dayKey, current);
  }
  return [...byDay.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dayKey, values]) => ({
      dayKey,
      entries: [...values].sort(compareTimelineEntriesChronologically),
    }));
}

function dateFromDayKey(dayKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function timelineDayHeading(dayKey: string, now = new Date()): string {
  if (dayKey === localTimelineDayKey(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dayKey === localTimelineDayKey(yesterday)) return 'Yesterday';

  const date = dateFromDayKey(dayKey);
  if (!date) return 'Earlier';
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

export function pageFromLookahead<T>(
  values: readonly T[],
  limit: number,
): { readonly values: readonly T[]; readonly hasMore: boolean } {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History page size must be a positive integer.');
  return { values: values.slice(0, limit), hasMore: values.length > limit };
}

export async function buildMealTimelineEntries(
  meals: readonly Meal[],
  foods: FoodRepository,
  options: MealTimelineBuildOptions = {},
): Promise<readonly MealTimelineEntry[]> {
  const foodIds = [...new Set(meals.flatMap((meal) => meal.items.map((item) => item.foodId)))];
  const mediaIds = [...new Set(meals.flatMap((meal) => meal.mediaIds))];
  const [resolved, mediaResult] = await Promise.all([
    Promise.allSettled(foodIds.map((foodId) => foods.getById(foodId))),
    options.media && mediaIds.length > 0
      ? options.media.listByIds(mediaIds).then(
          (assets) => ({ status: 'fulfilled' as const, assets }),
          () => ({ status: 'rejected' as const }),
        )
      : Promise.resolve({ status: 'fulfilled' as const, assets: [] }),
  ]);
  const foodById = new Map<string, Food>();
  resolved.forEach((result, index) => {
    const requestedId = foodIds[index];
    if (requestedId === undefined || result.status !== 'fulfilled' || !result.value) return;
    if (result.value.id === requestedId) foodById.set(requestedId, result.value);
  });
  const mediaById = new Map<string, MealTimelineMedia>(options.mediaById);
  if (mediaResult.status === 'fulfilled') {
    for (const asset of mediaResult.assets) mediaById.set(asset.id, asset);
  }

  return meals.map((meal) => {
    const items = meal.items.map((item, index): MealTimelineItem => ({
      id: item.id,
      name: foodById.get(item.foodId)?.name ?? 'Unavailable food',
      portionText: formattedPortion(meal, index),
    }));
    const mealTitle = meal.title?.trim();
    const locationLabel = optionalLocationLabel(meal);
    const thumbnailUri = optionalThumbnailUri(meal, mediaById);
    return {
      id: meal.id,
      occurredAt: meal.occurredAt,
      createdAt: meal.createdAt,
      dayKey: localTimelineDayKey(meal.occurredAt),
      foodSummary: derivedFoodSummary(items.map((item) => item.name)),
      ...(mealTitle ? { mealTitle } : {}),
      ...(locationLabel ? { locationLabel } : {}),
      ...(thumbnailUri ? { thumbnailUri } : {}),
      items,
    };
  });
}
