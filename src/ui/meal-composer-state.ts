import type { MealContextInput } from '@/domain';
import type { MealDraft } from '@/services/meals/meal-composer';

export interface RawMealContext {
  readonly title: string;
  readonly location: string;
  readonly caption: string;
}

export function rawMealContextForDraft(draft: MealDraft): RawMealContext {
  return {
    title: draft.context.title ?? '',
    location: draft.context.location?.label ?? '',
    caption: draft.context.caption ?? '',
  };
}

export function isCustomMealTitle(title: string, presets: readonly string[]): boolean {
  return Boolean(title && !presets.includes(title));
}

/** Preserve text exactly while editing; canonical trimming happens at commit. */
export function contextFromRawMealValues(
  draft: MealDraft,
  raw: RawMealContext,
): MealContextInput {
  return {
    occurredAt: draft.context.occurredAt,
    ...(raw.title.trim() ? { title: raw.title } : {}),
    ...(raw.caption.trim() ? { caption: raw.caption } : {}),
    ...(raw.location.trim() ? { location: { label: raw.location } } : {}),
    ...(draft.context.mediaIds === undefined ? {} : { mediaIds: draft.context.mediaIds }),
  };
}

/**
 * An add may await provider persistence while another draft edit completes.
 * Keep the latest context/items and append only the newly created item IDs.
 *
 * This deliberately does not short-circuit on `latest === base`. Drafts are now
 * persisted and rehydrated (THI-305), so reference identity is not a reliable
 * proxy for "unchanged". The merge path is equivalent when nothing changed —
 * the caller's addition only appends items, so re-deriving from `latest`
 * reproduces `added` exactly — and it stays correct once identity no longer
 * survives a round trip.
 */
export function rebaseComposerAddition(
  base: MealDraft,
  added: MealDraft,
  latest: MealDraft | null,
): MealDraft {
  if (!latest) return added;
  const baseIds = new Set(base.items.map((item) => item.id));
  const latestIds = new Set(latest.items.map((item) => item.id));
  const newItems = added.items.filter((item) => !baseIds.has(item.id) && !latestIds.has(item.id));
  return { ...latest, items: [...latest.items, ...newItems] };
}
