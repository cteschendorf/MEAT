import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import type { Food, MealContextInput } from '@/domain';
import type { FoodCandidate } from '@/domain/food/source';
import type { FoodId, FoodServingId, MealItemId, MediaId } from '@/domain/shared/ids';
import type { LocalMealPhoto } from '@/platform';
import type { AppServices } from '@/services';
import { candidateFromFood } from '@/services/logging/food-discovery';
import type { FoodSuggestion } from '@/services/logging/food-suggestions';
import type { MealPhotoRollbackResult } from '@/services/media/meal-photo-workflow';
import type { MealDraft } from '@/services/meals/meal-composer';
import { portionForSelection, portionWithGramWeight } from '@/services/meals/portion-selection';
import { sourceForFood } from '@/ui/composer/food-sources';
import { nextMealContext, type MealContextPatch } from '@/ui/composer/meal-context';
import { mediaAssetFor, photoCoordinator } from '@/ui/composer/meal-photo-picker';
import { currentIso, messageFor } from '@/ui/composer/meal-time';
import type { ComposerSessionController } from '@/ui/composer/use-composer-session';
import type { ComposerStatus } from '@/ui/composer/use-composer-status';
import { mealComposerSessions } from '@/ui/meal-composer-session';

/** A chosen portion as the detail sheet reports it. */
export interface ChosenPortion {
  readonly gramWeight: number;
  readonly servingId: FoodServingId | undefined;
  readonly quantity: number;
}

interface ActionOptions {
  readonly composer: ComposerSessionController;
  readonly status: ComposerStatus;
  /** The typed context text, so a save carries what is on screen. */
  readonly rawContextFor: (draft: MealDraft) => MealContextInput;
  readonly favoriteIds: ReadonlySet<FoodId>;
  readonly refreshSuggestions: (services: AppServices) => Promise<void>;
  /** Set when editing an existing event, which changes what removing the last food means. */
  readonly mealId: string | undefined;
  readonly onSelect: (candidate: FoodCandidate | null) => void;
  readonly onSavedWithoutNavigation: () => void;
  readonly onDeletedWithoutNavigation: (token: string) => void;
}

export interface ComposerActions {
  readonly addCandidate: (
    candidate: FoodCandidate,
    gramWeight: number,
    servingId?: FoodServingId,
    quantity?: number,
  ) => Promise<void>;
  readonly addFromSheet: (candidate: FoodCandidate, portion: ChosenPortion) => Promise<void>;
  readonly addSuggestion: (suggestion: FoodSuggestion) => Promise<void>;
  readonly toggleFavorite: (candidate: FoodCandidate) => Promise<void>;
  readonly updateItemGrams: (itemId: MealItemId, value: string) => void;
  readonly removeItem: (itemId: MealItemId) => void;
  readonly updateContext: (values: MealContextPatch) => void;
  readonly openComposerChild: (pathname: '/meals-recipes' | '/scan-barcode' | '/manual-food') => void;
  readonly addPhotos: (source: 'camera' | 'library') => Promise<void>;
  readonly removePhoto: (id: MediaId) => void;
  readonly cancel: () => Promise<void>;
  readonly confirm: () => Promise<void>;
}

/**
 * Every write the composer can make.
 *
 * These were closures inside the screen's render body, which meant a mode that
 * wanted to add a food had to be that screen. The tabbed entry surface needs
 * five modes sharing one draft (THI-328), so the write surface has to be
 * something a tab can be handed rather than something a component owns.
 *
 * Nothing here is memoised on purpose: each is called from an event handler, so
 * a fresh closure per render costs nothing and always sees current state. The
 * things that must not be recreated — the gate, the session — are held by the
 * hooks that own them.
 */
export function useComposerActions(options: ActionOptions): ComposerActions {
  const router = useRouter();
  const {
    composer,
    status,
    rawContextFor,
    favoriteIds,
    refreshSuggestions,
    mealId,
    onSelect,
    onSavedWithoutNavigation,
    onDeletedWithoutNavigation,
  } = options;
  const { services, session, publishDraft, rebaseAddedItems } = composer;
  const { setMessage } = status;

  async function candidateForFood(food: Food): Promise<FoodCandidate> {
    if (!services) return candidateFromFood(food, sourceForFood(food));
    try {
      return (
        (await services.discovery.getByFoodId(food.id)) ?? candidateFromFood(food, sourceForFood(food))
      );
    } catch {
      // A provider that cannot be reached is not a reason to refuse the add:
      // the food is already in hand, and its own record is enough to log it.
      return candidateFromFood(food, sourceForFood(food));
    }
  }

  async function addCandidate(
    candidate: FoodCandidate,
    gramWeight: number,
    servingId?: FoodServingId,
    quantity = 1,
  ): Promise<void> {
    if (!services || !session) return;
    if (!Number.isFinite(gramWeight) || gramWeight <= 0) {
      setMessage('Enter a portion greater than zero grams.');
      return;
    }
    const base = session.draft;
    const added = await services.mealComposer.addCandidate(base, candidate, {
      portion: portionForSelection(candidate.food, servingId, quantity, gramWeight),
    });
    publishDraft(rebaseAddedItems(base, added));
    onSelect(null);
    setMessage(`${candidate.food.name} added. Add another food or confirm the event.`);
  }

  async function addFromSheet(candidate: FoodCandidate, portion: ChosenPortion): Promise<void> {
    await status.runAction(`add:${candidate.food.id}`, async () => {
      try {
        // The quantity reaches `portionForSelection`, so a serving-based portion
        // records as "2 × 1 medium breast" rather than a bare weight.
        await addCandidate(candidate, portion.gramWeight, portion.servingId, portion.quantity);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to add this food.'));
      }
    });
  }

  async function addSuggestion(suggestion: FoodSuggestion): Promise<void> {
    await status.runAction(`quick:${suggestion.food.id}`, async () => {
      try {
        await addCandidate(await candidateForFood(suggestion.food), suggestion.suggestedGramWeight);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to add this food.'));
      }
    });
  }

  async function toggleFavorite(candidate: FoodCandidate): Promise<void> {
    if (!services) return;
    await status.runAction(`favorite:${candidate.food.id}`, async () => {
      try {
        await services.discovery.persist(candidate);
        await services.suggestions.setFavorite(
          candidate.food,
          !favoriteIds.has(candidate.food.id),
          currentIso(),
        );
        await refreshSuggestions(services);
      } catch (error) {
        setMessage(messageFor(error, 'Unable to update this favorite.'));
      }
    });
  }

  function updateItemGrams(itemId: MealItemId, value: string): void {
    if (!services || !session || status.locked) return;
    const gramWeight = Number(value);
    if (!Number.isFinite(gramWeight) || gramWeight <= 0) {
      setMessage('Portions must be greater than zero grams.');
      return;
    }
    try {
      const item = session.draft.items.find((candidate) => candidate.id === itemId);
      if (!item) return;
      publishDraft(
        services.mealComposer.updateItemPortion(
          session.draft,
          itemId,
          portionWithGramWeight(item.portion, gramWeight),
        ),
      );
      setMessage(null);
    } catch (error) {
      setMessage(messageFor(error, 'Unable to change this portion.'));
    }
  }

  async function deleteExistingEvent(): Promise<void> {
    if (!services || !session || !mealId) return;
    await status.runAction('delete', async () => {
      try {
        const deletion = await services.mealHistory.deleteWithUndo(session.draft.id, currentIso());
        composer.finish();
        mealComposerSessions.clear(session.draft.id);
        await photoCoordinator(services).cancel(session.stagedPhotos).catch(() => undefined);
        try {
          router.replace({ pathname: '/meal-deleted', params: { token: deletion.token } });
        } catch {
          onDeletedWithoutNavigation(deletion.token);
          setMessage('The event was deleted. Open the Undo screen to restore it within 10 seconds.');
        }
      } catch (error) {
        setMessage(messageFor(error, 'Unable to delete this event.'));
      }
    });
  }

  function removeItem(itemId: MealItemId): void {
    if (!services || !session || status.locked) return;
    // Removing the last food from an existing event deletes the event. That is
    // a bigger thing than the button says, so it is asked rather than assumed.
    if (mealId && session.draft.items.length === 1) {
      Alert.alert(
        'Delete this event?',
        'Removing its final food deletes the entire timeline event. You will have 10 seconds to undo.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete event', style: 'destructive', onPress: () => void deleteExistingEvent() },
        ],
      );
      return;
    }
    try {
      publishDraft(services.mealComposer.removeItem(session.draft, itemId));
    } catch (error) {
      setMessage(messageFor(error, 'Unable to remove this food.'));
    }
  }

  function updateContext(values: MealContextPatch): void {
    if (!services || !session || status.locked) return;
    try {
      publishDraft(
        services.mealComposer.withContext(session.draft, nextMealContext(session.draft, values)),
      );
      setMessage(null);
    } catch (error) {
      setMessage(messageFor(error, 'That meal detail is not valid.'));
    }
  }

  function openComposerChild(pathname: '/meals-recipes' | '/scan-barcode' | '/manual-food'): void {
    if (!services || !session || status.locked) return;
    try {
      const draft = services.mealComposer.withContext(session.draft, rawContextFor(session.draft));
      publishDraft(draft);
      router.push({ pathname, params: { draftId: draft.id } });
    } catch (error) {
      setMessage(messageFor(error, 'Unable to open this food option.'));
    }
  }

  async function addPhotos(source: 'camera' | 'library'): Promise<void> {
    if (!services || !session) return;
    await status.runAction(source, async () => {
      try {
        const result = await services.mealComposer.runDraftWrite(session.draft, () =>
          photoCoordinator(services).pickAndStage({
            source,
            retainedCount: session.existingMedia.length,
            stagedPhotos: session.stagedPhotos,
          }),
        );
        if (result.kind === 'permission-denied') {
          setMessage(
            source === 'camera'
              ? 'Camera access was not granted. You can continue without a photo.'
              : 'Photo-library access was not granted. You can continue without a photo.',
          );
          return;
        }
        if (result.kind === 'limit-reached') {
          setMessage('A meal can contain up to five photos.');
          return;
        }
        if (result.kind === 'cancelled') return;
        // The draft can have been closed while the picker was open. A staged
        // photo with no draft to belong to is a file nobody will ever delete.
        const activeSession = mealComposerSessions.get(session.draft.id);
        if (!activeSession) {
          await photoCoordinator(services).cancel(result.stagedPhotos).catch(() => undefined);
          setMessage('This meal draft is no longer available.');
          return;
        }
        try {
          services.mealComposer.assertDraftWritable(activeSession.draft);
        } catch (error) {
          await photoCoordinator(services).cancel(result.stagedPhotos).catch(() => undefined);
          throw error;
        }
        mealComposerSessions.setStagedPhotos(session.draft.id, result.stagedPhotos);
        setMessage(null);
      } catch (error) {
        setMessage(
          messageFor(
            error,
            source === 'camera' ? 'Unable to add a camera photo.' : 'Unable to add a library photo.',
          ),
        );
      }
    });
  }

  function removePhoto(id: MediaId): void {
    if (!services || !session || status.locked) return;
    const staged = session.stagedPhotos.find((photo) => photo.id === id);
    if (staged) services.mealPhotoFiles.discard(staged);
    mealComposerSessions.removePhoto(session.draft.id, id);
  }

  async function cancel(): Promise<void> {
    if (status.locked) return;
    if (!services || !session) {
      router.back();
      return;
    }
    await photoCoordinator(services).cancel(session.stagedPhotos).catch(() => undefined);
    composer.finish();
    mealComposerSessions.clear(session.draft.id);
    router.back();
  }

  async function confirm(): Promise<void> {
    if (!services || !session) return;
    if (session.draft.items.length === 0) {
      setMessage('Add at least one food before saving this event.');
      return;
    }
    await status.runAction('confirm', async () => {
      let promoted: readonly LocalMealPhoto[] = [];
      const confirmationRollback: { result?: MealPhotoRollbackResult } = {};
      let committed = false;
      try {
        const now = currentIso();
        const coordinator = photoCoordinator(services);
        const retainedMediaIds = session.existingMedia.map((asset) => asset.id);
        const mediaIds = [...retainedMediaIds, ...session.stagedPhotos.map((photo) => photo.id)];
        const draft = services.mealComposer.withContext(session.draft, {
          ...rawContextFor(session.draft),
          mediaIds,
        });
        await services.mealComposer.saveWithMedia(
          draft,
          now,
          async () => {
            promoted = await coordinator.promote(session.stagedPhotos);
            return promoted.map((photo) => mediaAssetFor(photo, now));
          },
          async (assets) => {
            await services.media.deleteMany(assets.map((asset) => asset.id)).catch(() => undefined);
            confirmationRollback.result = await coordinator.restoreForRetry(promoted);
          },
        );
        committed = true;

        const retained = new Set(mediaIds);
        const removed = composer.initialExistingMedia.filter((asset) => !retained.has(asset.id));
        try {
          await services.mealComposer.runDraftWrite(draft, async () => {
            removed.forEach((asset) => services.mealPhotoFiles.delete(asset.uri));
            await services.media.deleteMany(removed.map((asset) => asset.id));
          });
        } catch {
          // Startup orphan cleanup safely retries a post-commit media cleanup failure.
        }
        composer.finish();
        mealComposerSessions.clear(session.draft.id);
        try {
          router.dismissTo('/');
        } catch {
          onSavedWithoutNavigation();
          setMessage('Your meal was saved, but Today could not open automatically.');
        }
      } catch (error) {
        // The meal is on the timeline; only the cleanup after it failed. Saying
        // "unable to save" here would be false, and would invite a second save.
        if (committed) {
          composer.finish();
          mealComposerSessions.clear(session.draft.id);
          onSavedWithoutNavigation();
          setMessage('Your meal was saved, but final screen cleanup could not finish.');
          return;
        }
        const activeSession = mealComposerSessions.get(session.draft.id);
        const rollbackResult = confirmationRollback.result;
        if (rollbackResult && activeSession) {
          const restoredById = new Map(rollbackResult.restored.map((photo) => [photo.id, photo]));
          const promotedIds = new Set(promoted.map((photo) => photo.id));
          const restoredSessionPhotos = activeSession.stagedPhotos.flatMap((photo) => {
            const restored = restoredById.get(photo.id);
            if (restored) return [restored];
            return promotedIds.has(photo.id) ? [] : [photo];
          });
          mealComposerSessions.setStagedPhotos(session.draft.id, restoredSessionPhotos);
        }
        setMessage(messageFor(error, 'Unable to save this meal event.'));
      }
    });
  }

  return {
    addCandidate,
    addFromSheet,
    addSuggestion,
    toggleFavorite,
    updateItemGrams,
    removeItem,
    updateContext,
    openComposerChild,
    addPhotos,
    removePhoto,
    cancel,
    confirm,
  };
}
