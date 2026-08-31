import type { MediaAsset } from '@/domain';
import type { MealId } from '@/domain/shared/ids';
import type { LocalMealPhoto } from '@/platform';
import type { MealDraft } from '@/services/meals/meal-composer';

export interface MealComposerSession {
  readonly draft: MealDraft;
  readonly existingMedia: readonly MediaAsset[];
  readonly stagedPhotos: readonly LocalMealPhoto[];
}

type Listener = () => void;

export class MealComposerSessionStore {
  private readonly sessions = new Map<MealId, MealComposerSession>();
  private readonly listeners = new Map<MealId, Set<Listener>>();

  get(mealId: MealId): MealComposerSession | null {
    return this.sessions.get(mealId) ?? null;
  }

  put(session: MealComposerSession): void {
    this.sessions.set(session.draft.id, session);
    this.emit(session.draft.id);
  }

  updateDraft(draft: MealDraft): void {
    const current = this.sessions.get(draft.id);
    if (!current) throw new Error('The meal draft is no longer available.');
    this.put({ ...current, draft });
  }

  addStagedPhoto(mealId: MealId, photo: LocalMealPhoto): void {
    const current = this.require(mealId);
    this.put({ ...current, stagedPhotos: [...current.stagedPhotos, photo] });
  }

  setStagedPhotos(mealId: MealId, photos: readonly LocalMealPhoto[]): void {
    const current = this.require(mealId);
    this.put({ ...current, stagedPhotos: [...photos] });
  }

  removePhoto(mealId: MealId, mediaId: string): MealComposerSession {
    const current = this.require(mealId);
    const next = {
      ...current,
      existingMedia: current.existingMedia.filter((asset) => asset.id !== mediaId),
      stagedPhotos: current.stagedPhotos.filter((photo) => photo.id !== mediaId),
    };
    this.put(next);
    return next;
  }

  clear(mealId: MealId): MealComposerSession | null {
    const current = this.sessions.get(mealId) ?? null;
    this.sessions.delete(mealId);
    this.emit(mealId);
    return current;
  }

  /** Invalidates every draft after a private-data purge and wakes open composers. */
  clearAll(): readonly MealComposerSession[] {
    const cleared = [...this.sessions.values()];
    const mealIds = [...this.sessions.keys()];
    this.sessions.clear();
    for (const mealId of mealIds) this.emit(mealId);
    return cleared;
  }

  subscribe(mealId: MealId, listener: Listener): () => void {
    const current = this.listeners.get(mealId) ?? new Set<Listener>();
    current.add(listener);
    this.listeners.set(mealId, current);
    return () => {
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(mealId);
    };
  }

  private require(mealId: MealId): MealComposerSession {
    const session = this.sessions.get(mealId);
    if (!session) throw new Error('The meal draft is no longer available.');
    return session;
  }

  private emit(mealId: MealId): void {
    this.listeners.get(mealId)?.forEach((listener) => listener());
  }
}

export const mealComposerSessions = new MealComposerSessionStore();
