import type { Food, FoodCandidate, MealContextInput, Recipe, SavedMeal } from '@/domain';
import { sourceIdFromFoodId } from '@/domain/food/source';
import type { ISODateTime, MealId } from '@/domain/shared/ids';
import type { AppServices } from '@/services/app-services';
import { resolvedFoodId, recipeGramsForServings } from '@/services/meals/saved-meals';
import { mealComposerSessions, type MealComposerSession } from '@/ui/meal-composer-session';

type ComposerEntryServices = Pick<
  AppServices,
  'discovery' | 'foods' | 'mealComposer' | 'recipeService'
>;

export interface ResolvedComposerSession {
  readonly session: MealComposerSession;
  /** True when this entry point had to create the composer rather than return to one. */
  readonly created: boolean;
}

/**
 * Every discovery surface joins the same in-memory draft. If a utility route is
 * opened directly, it creates a normal composer instead of writing a Meal on
 * its own.
 */
export function resolveComposerSession(
  services: Pick<ComposerEntryServices, 'mealComposer'>,
  requestedDraftId: string | undefined,
  now: ISODateTime,
): ResolvedComposerSession {
  if (requestedDraftId) {
    const existing = mealComposerSessions.get(requestedDraftId as MealId);
    if (existing) {
      services.mealComposer.assertDraftWritable(existing.draft);
      return { session: existing, created: false };
    }
  }

  const draft = services.mealComposer.createDraft({ occurredAt: now }, now);
  const session: MealComposerSession = { draft, existingMedia: [], stagedPhotos: [] };
  services.mealComposer.assertDraftWritable(draft);
  mealComposerSessions.put(session);
  return { session, created: true };
}

function withDraft(
  services: Pick<ComposerEntryServices, 'mealComposer'>,
  session: MealComposerSession,
  draft: MealComposerSession['draft'],
): MealComposerSession {
  services.mealComposer.assertDraftWritable(draft);
  const next = { ...session, draft };
  mealComposerSessions.put(next);
  return next;
}

export async function addPersonalFoodToComposer(
  services: Pick<ComposerEntryServices, 'mealComposer'>,
  requestedDraftId: string | undefined,
  food: Food,
  gramWeight: number,
  now: ISODateTime,
): Promise<ResolvedComposerSession> {
  const resolved = resolveComposerSession(services, requestedDraftId, now);
  const draft = await services.mealComposer.addFood(resolved.session.draft, food, {
    portion: { quantity: 1, gramWeight },
  });
  return { ...resolved, session: withDraft(services, resolved.session, draft) };
}

export async function addCandidateToComposer(
  services: Pick<ComposerEntryServices, 'mealComposer'>,
  requestedDraftId: string | undefined,
  candidate: FoodCandidate,
  gramWeight: number,
  now: ISODateTime,
): Promise<ResolvedComposerSession> {
  const resolved = resolveComposerSession(services, requestedDraftId, now);
  // addCandidate retains the full provider record before the draft references it.
  const draft = await services.mealComposer.addCandidate(resolved.session.draft, candidate, {
    portion: { quantity: 1, gramWeight },
  });
  return { ...resolved, session: withDraft(services, resolved.session, draft) };
}

async function addSavedMealItem(
  services: ComposerEntryServices,
  draft: MealComposerSession['draft'],
  item: SavedMeal['items'][number],
): Promise<MealComposerSession['draft']> {
  const foodId = resolvedFoodId(item);
  const sourceId = item.foodRef?.sourceId ?? sourceIdFromFoodId(foodId) ?? 'personal';
  const options = {
    portion: { ...item.portion },
    ...(item.recipeId ? { recipeId: item.recipeId } : {}),
    ...(item.note ? { note: item.note } : {}),
  };

  if (sourceId !== 'personal') {
    const candidate = await services.discovery.getByFoodId(foodId);
    if (!candidate) {
      throw new Error('A saved provider food is unavailable and has no retained offline record.');
    }
    return services.mealComposer.addCandidate(draft, candidate, options);
  }

  const food = await services.foods.getById(foodId);
  if (!food) throw new Error('A food in this saved meal is no longer available.');
  return services.mealComposer.addFood(draft, food, options);
}

export async function prefillSavedMealComposer(
  services: ComposerEntryServices,
  requestedDraftId: string | undefined,
  savedMeal: SavedMeal,
  now: ISODateTime,
): Promise<ResolvedComposerSession> {
  const resolved = resolveComposerSession(services, requestedDraftId, now);
  let draft = resolved.session.draft;
  for (const item of savedMeal.items) {
    draft = await addSavedMealItem(services, draft, item);
  }
  const context: MealContextInput = {
    ...draft.context,
    title: savedMeal.name,
  };
  draft = services.mealComposer.withContext(draft, context);
  return { ...resolved, session: withDraft(services, resolved.session, draft) };
}

export async function addRecipeSnapshotToComposer(
  services: Pick<ComposerEntryServices, 'mealComposer' | 'recipeService'>,
  requestedDraftId: string | undefined,
  recipe: Recipe,
  servings: number,
  now: ISODateTime,
): Promise<ResolvedComposerSession> {
  const resolved = resolveComposerSession(services, requestedDraftId, now);
  const food = await services.recipeService.resolveRevisionFood(recipe);
  const draft = await services.mealComposer.addFood(resolved.session.draft, food, {
    portion: { quantity: 1, gramWeight: recipeGramsForServings(recipe, servings) },
    recipeId: recipe.id,
  });
  return { ...resolved, session: withDraft(services, resolved.session, draft) };
}
