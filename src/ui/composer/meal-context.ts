import type { MealContextInput, MealLocation } from '@/domain';
import type { ISODateTime } from '@/domain/shared/ids';
import type { MealDraft } from '@/services/meals/meal-composer';

export const presetMealNames = ['Breakfast', 'Lunch', 'Dinner', 'Snack'] as const;

/** A partial edit to the meal's context; `null` clears a field, absent leaves it. */
export interface MealContextPatch {
  readonly occurredAt?: ISODateTime;
  readonly title?: string | null;
  readonly caption?: string | null;
  readonly location?: MealLocation | null;
}

/**
 * The draft's context with one patch applied.
 *
 * `'title' in values` rather than a truthiness check, deliberately: `null` is
 * an instruction to clear the field and absence is an instruction to leave it
 * alone. Collapsing the two would mean a meal name, once set, could never be
 * removed — which is what "None" is for.
 */
export function nextMealContext(draft: MealDraft, values: MealContextPatch): MealContextInput {
  const current = draft.context;
  const title = 'title' in values ? values.title ?? undefined : current.title;
  const caption = 'caption' in values ? values.caption ?? undefined : current.caption;
  const location = 'location' in values ? values.location ?? undefined : current.location;
  return {
    occurredAt: values.occurredAt ?? current.occurredAt,
    ...(title === undefined ? {} : { title }),
    ...(caption === undefined ? {} : { caption }),
    ...(location === undefined ? {} : { location }),
    ...(current.mediaIds === undefined ? {} : { mediaIds: current.mediaIds }),
  };
}

/** True when a draft arrives already carrying context worth showing unfolded. */
export function shouldRevealContext(
  draft: MealDraft,
  media: { readonly existing: number; readonly staged: number },
): boolean {
  return Boolean(
    draft.context.caption || draft.context.location || media.existing || media.staged,
  );
}
