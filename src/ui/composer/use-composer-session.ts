import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import type { Food, MediaAsset } from '@/domain';
import type { FoodId, ISODateTime, MealId } from '@/domain/shared/ids';
import { openAppServices, type AppServices } from '@/services';
import type { ExclusiveActionGate } from '@/services/actions/exclusive-action';
import type { MealDraft } from '@/services/meals/meal-composer';
import { photoCoordinator } from '@/ui/composer/meal-photo-picker';
import { currentIso, messageFor } from '@/ui/composer/meal-time';
import { mealComposerSessions, type MealComposerSession } from '@/ui/meal-composer-session';
import { rebaseComposerAddition } from '@/ui/meal-composer-state';

export interface ComposerParams {
  readonly draftId?: string | undefined;
  readonly mealId?: string | undefined;
  readonly occurredAt?: string | undefined;
}

export interface ComposerSessionController {
  readonly services: AppServices | null;
  readonly session: MealComposerSession | null;
  /** The foods behind the draft's items, resolved for display. */
  readonly foodById: ReadonlyMap<FoodId, Food>;
  readonly publishDraft: (draft: MealDraft) => void;
  /** Folds an addition into whatever the draft has become while it was awaited. */
  readonly rebaseAddedItems: (base: MealDraft, added: MealDraft) => MealDraft;
  /** The media the draft opened with, for deciding what to delete on save. */
  readonly initialExistingMedia: readonly MediaAsset[];
  /** Marks the draft finished so the exit guard stops defending it. */
  readonly finish: () => void;
}

interface SessionOptions {
  readonly params: ComposerParams;
  readonly gate: ExclusiveActionGate;
  readonly onMessage: (message: string | null) => void;
  /** Called with a draft whose stored context the text fields should adopt. */
  readonly onAdoptContext: (draft: MealDraft) => void;
  /** Called once the draft is open, for loads that depend on having one. */
  readonly onOpened: (services: AppServices, session: MealComposerSession) => void;
}

/**
 * The draft's whole lifetime: opening it, keeping it, and defending it on the
 * way out.
 *
 * This is the piece the tabbed entry surface needs to own outright (THI-328).
 * While it lived inside the screen, every mode that wanted the draft had to be
 * a route, and the draft had to survive being handed across a navigation
 * boundary by id — which is the mechanism behind THI-309's silent fork and
 * THI-319's teleport, not merely their setting.
 */
export function useComposerSession(options: SessionOptions): ComposerSessionController {
  const router = useRouter();
  const navigation = useNavigation();
  const { params, gate, onMessage, onAdoptContext, onOpened } = options;

  const [services, setServices] = useState<AppServices | null>(null);
  const [session, setSession] = useState<MealComposerSession | null>(null);
  const [foodById, setFoodById] = useState<ReadonlyMap<FoodId, Food>>(new Map());
  const initialExistingMedia = useRef<readonly MediaAsset[]>([]);
  const completed = useRef(false);
  // Drafts this screen published itself. An update carrying one of these is an
  // echo of our own write, so the text fields must not be reset from it —
  // doing that would yank a half-typed note back to its committed value.
  const [locallyPublishedDrafts] = useState(() => new WeakSet<object>());

  // Held in a ref so a caller passing an inline closure does not re-run the
  // bootstrap and open a second draft. Written in an effect rather than during
  // render, which is where a ref may legally be assigned.
  const callbacks = useRef({ onMessage, onAdoptContext, onOpened });
  useEffect(() => {
    callbacks.current = { onMessage, onAdoptContext, onOpened };
  }, [onMessage, onAdoptContext, onOpened]);

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    void openAppServices()
      .then(async (nextServices) => {
        if (!active) return;
        let nextSession: MealComposerSession | null = params.draftId
          ? mealComposerSessions.get(params.draftId as MealId)
          : null;
        if (!nextSession && params.mealId) {
          const draft = await nextServices.mealComposer.loadDraft(params.mealId as MealId);
          const existingMedia = await nextServices.media.listByIds(draft.context.mediaIds ?? []);
          initialExistingMedia.current = existingMedia;
          nextSession = { draft, existingMedia, stagedPhotos: [] };
        }
        if (!nextSession) {
          const now = currentIso();
          const requestedTime = params.occurredAt ? new Date(params.occurredAt) : new Date(now);
          const occurredAt = (
            Number.isNaN(requestedTime.getTime()) ? now : requestedTime.toISOString()
          ) as ISODateTime;
          nextSession = {
            draft: nextServices.mealComposer.createDraft({ occurredAt }, now),
            existingMedia: [],
            stagedPhotos: [],
          };
        }
        nextServices.mealComposer.assertDraftWritable(nextSession.draft);
        locallyPublishedDrafts.add(nextSession.draft);
        mealComposerSessions.put(nextSession);
        setServices(nextServices);
        setSession(nextSession);
        callbacks.current.onAdoptContext(nextSession.draft);
        callbacks.current.onOpened(nextServices, nextSession);
        router.setParams({ draftId: nextSession.draft.id });

        unsubscribe = mealComposerSessions.subscribe(nextSession.draft.id, () => {
          if (!active) return;
          const updated = mealComposerSessions.get(nextSession.draft.id);
          if (updated && !locallyPublishedDrafts.has(updated.draft)) {
            callbacks.current.onAdoptContext(updated.draft);
            locallyPublishedDrafts.add(updated.draft);
          }
          setSession(updated);
        });
      })
      .catch((error: unknown) => {
        if (active) {
          callbacks.current.onMessage(messageFor(error, 'Unable to prepare the meal composer.'));
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [params, locallyPublishedDrafts, router]);

  useEffect(() => {
    if (!services || !session) return;
    let active = true;
    void Promise.allSettled(
      session.draft.items.map((item) => services.foods.getById(item.foodId)),
    ).then((results) => {
      if (!active) return;
      const resolved = new Map<FoodId, Food>();
      results.forEach((result, index) => {
        if (result.status !== 'fulfilled' || !result.value) return;
        const item = session.draft.items[index];
        if (item) resolved.set(item.foodId, result.value);
      });
      setFoodById(resolved);
    });
    return () => {
      active = false;
    };
  }, [services, session]);

  // Leaving mid-write, or mid-photo, is the case this guard exists for. A
  // staged photo that outlives its draft is a file nobody will ever delete.
  useEffect(() => {
    const cleanup = navigation.addListener('beforeRemove', (event) => {
      if (completed.current || !session) return;
      if (gate.isActive) {
        event.preventDefault();
        AccessibilityInfo.announceForAccessibility(
          'Please wait for the current meal action to finish.',
        );
        return;
      }
      if (services && session.stagedPhotos.length > 0) {
        event.preventDefault();
        completed.current = true;
        mealComposerSessions.clear(session.draft.id);
        void photoCoordinator(services)
          .cancel(session.stagedPhotos)
          .catch(() => undefined)
          .finally(() => navigation.dispatch(event.data.action));
        return;
      }
      mealComposerSessions.clear(session.draft.id);
    });
    return cleanup;
  }, [gate, navigation, services, session]);

  const publishDraft = useCallback(
    (draft: MealDraft): void => {
      if (!services) return;
      services.mealComposer.assertDraftWritable(draft);
      locallyPublishedDrafts.add(draft);
      mealComposerSessions.updateDraft(draft);
      setSession(mealComposerSessions.get(draft.id));
    },
    [services, locallyPublishedDrafts],
  );

  const rebaseAddedItems = useCallback(
    (base: MealDraft, added: MealDraft): MealDraft =>
      rebaseComposerAddition(base, added, mealComposerSessions.get(base.id)?.draft ?? null),
    [],
  );

  return {
    services,
    session,
    foodById,
    publishDraft,
    rebaseAddedItems,
    get initialExistingMedia() {
      return initialExistingMedia.current;
    },
    finish: () => {
      completed.current = true;
    },
  };
}
