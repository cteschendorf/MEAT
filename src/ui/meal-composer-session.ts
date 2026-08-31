import type { MediaAsset } from '@/domain';
import type { MealId } from '@/domain/shared/ids';
import type { ComposerDraftRepository } from '@/data/repositories/contracts';
import type { LocalMealPhoto } from '@/platform';
import type { MealDraft } from '@/services/meals/meal-composer';

export interface MealComposerSession {
  readonly draft: MealDraft;
  readonly existingMedia: readonly MediaAsset[];
  readonly stagedPhotos: readonly LocalMealPhoto[];
}

type Listener = () => void;

/** Bumped when the persisted shape changes; unreadable rows are discarded. */
const SESSION_PAYLOAD_VERSION = 1;

interface PersistedSession {
  readonly version: number;
  readonly session: MealComposerSession;
}

function isSession(value: unknown): value is MealComposerSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<MealComposerSession>;
  return (
    typeof candidate.draft === 'object' &&
    candidate.draft !== null &&
    typeof (candidate.draft as MealDraft).id === 'string' &&
    Array.isArray(candidate.existingMedia) &&
    Array.isArray(candidate.stagedPhotos)
  );
}

/**
 * Holds every open composer draft.
 *
 * Reads are synchronous from memory so the composer can render without
 * awaiting, while every mutation writes through to durable storage. Before
 * this, a draft lived only in memory: backgrounding the app long enough for
 * iOS to reclaim it lost an in-progress meal silently, with its staged photos
 * deleted by the next launch's cleanup (THI-305).
 *
 * Persistence is best-effort by design. Losing the last keystroke to a crash
 * is acceptable; losing the whole meal is not. Write failures are reported to
 * `onPersistenceError` rather than thrown, because a storage problem must not
 * break the composer the user is actively typing into.
 */
export class MealComposerSessionStore {
  private readonly sessions = new Map<MealId, MealComposerSession>();
  private readonly listeners = new Map<MealId, Set<Listener>>();
  private drafts: ComposerDraftRepository | null = null;
  private lastWrite: Promise<unknown> = Promise.resolve();

  /** Reports a persistence failure. Set by the host; never throws into the UI. */
  onPersistenceError: ((error: unknown) => void) | null = null;

  get(mealId: MealId): MealComposerSession | null {
    return this.sessions.get(mealId) ?? null;
  }

  put(session: MealComposerSession): void {
    this.sessions.set(session.draft.id, session);
    this.emit(session.draft.id);
    this.persist(session);
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
    this.enqueue((drafts) => drafts.delete(mealId));
    return current;
  }

  /** Invalidates every draft after a private-data purge and wakes open composers. */
  clearAll(): readonly MealComposerSession[] {
    const cleared = [...this.sessions.values()];
    const mealIds = [...this.sessions.keys()];
    this.sessions.clear();
    for (const mealId of mealIds) this.emit(mealId);
    this.enqueue((drafts) => drafts.deleteAll());
    return cleared;
  }

  subscribe(mealId: MealId, listener: Listener): () => void {
    const current = this.listeners.get(mealId) ?? new Set<Listener>();
    current.add(listener);
    this.listeners.set(mealId, current);
    return () => {
      const registered = this.listeners.get(mealId);
      // Compare before deleting: a later subscriber may own a fresh Set for
      // this id, and this cleanup must not unregister it.
      if (registered !== current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(mealId);
    };
  }

  /**
   * Attaches durable storage and restores any drafts left by a previous run.
   * Sessions already in memory win, so an open composer is never overwritten
   * by an older snapshot of itself.
   */
  async attach(drafts: ComposerDraftRepository): Promise<void> {
    this.drafts = drafts;
    let records: readonly { id: string; payload: string }[] = [];
    try {
      records = await drafts.list();
    } catch (error) {
      this.onPersistenceError?.(error);
      return;
    }

    for (const record of records) {
      const session = this.parse(record.payload);
      if (!session) {
        // Unreadable or superseded payload: drop it rather than resurrecting
        // a draft the composer cannot render.
        this.enqueue((store) => store.delete(record.id));
        continue;
      }
      if (this.sessions.has(session.draft.id)) continue;
      this.sessions.set(session.draft.id, session);
      this.emit(session.draft.id);
    }
  }

  /** Detaches storage without touching memory. Used by tests and teardown. */
  detach(): void {
    this.drafts = null;
  }

  /** Resolves once every queued write has settled. */
  async flush(): Promise<void> {
    await this.lastWrite;
  }

  private parse(payload: string): MealComposerSession | null {
    try {
      const parsed = JSON.parse(payload) as Partial<PersistedSession>;
      if (parsed.version !== SESSION_PAYLOAD_VERSION) return null;
      return isSession(parsed.session) ? parsed.session : null;
    } catch {
      return null;
    }
  }

  private persist(session: MealComposerSession): void {
    const payload: PersistedSession = { version: SESSION_PAYLOAD_VERSION, session };
    const serialized = JSON.stringify(payload);
    this.enqueue((drafts) =>
      drafts.save({
        id: session.draft.id,
        payload: serialized,
        updatedAt: new Date().toISOString(),
      }),
    );
  }

  /**
   * Serializes writes so a save and a delete for the same draft cannot land
   * out of order and resurrect it.
   */
  private enqueue(write: (drafts: ComposerDraftRepository) => Promise<void>): void {
    const drafts = this.drafts;
    if (!drafts) return;
    this.lastWrite = this.lastWrite
      .then(() => write(drafts))
      .catch((error: unknown) => {
        this.onPersistenceError?.(error);
      });
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
