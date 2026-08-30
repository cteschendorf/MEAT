import type { ISODateTime, MediaId } from '@/domain/shared/ids';
import type {
  LocalMealPhoto,
  PickedMealPhoto,
} from '@/platform/media/local-meal-photo-store-core';

export const MEAL_PHOTO_LIMIT = 5;

export type MealPhotoSource = 'camera' | 'library';
export type PhotoLibraryAccess = 'all' | 'limited' | 'none' | null;

export interface MealPhotoPermissionSnapshot {
  readonly granted: boolean;
  readonly canAskAgain: boolean;
  readonly accessPrivileges?: PhotoLibraryAccess;
}

export type MealPhotoPermissionDecision =
  | { readonly allowed: true; readonly scope: 'all' | 'limited' }
  | { readonly allowed: false; readonly canAskAgain: boolean };

export function decideMealPhotoPermission(
  source: MealPhotoSource,
  permission: MealPhotoPermissionSnapshot,
): MealPhotoPermissionDecision {
  if (permission.granted) {
    return {
      allowed: true,
      scope: source === 'library' && permission.accessPrivileges === 'limited' ? 'limited' : 'all',
    };
  }
  if (source === 'library' && permission.accessPrivileges === 'limited') {
    return { allowed: true, scope: 'limited' };
  }
  return { allowed: false, canAskAgain: permission.canAskAgain };
}

export interface MealPhotoPickerAdapter<TPhoto extends PickedMealPhoto = PickedMealPhoto> {
  requestPermission(source: MealPhotoSource): Promise<MealPhotoPermissionSnapshot>;
  launch(
    source: MealPhotoSource,
    options: { readonly selectionLimit: number },
  ): Promise<{ readonly canceled: boolean; readonly assets: readonly TPhoto[] }>;
}

export type MealPhotoPickResult<TPhoto extends PickedMealPhoto = PickedMealPhoto> =
  | { readonly kind: 'limit-reached'; readonly photos: readonly [] }
  | {
      readonly kind: 'permission-denied';
      readonly source: MealPhotoSource;
      readonly canAskAgain: boolean;
      readonly photos: readonly [];
    }
  | { readonly kind: 'cancelled'; readonly photos: readonly [] }
  | {
      readonly kind: 'selected';
      readonly permissionScope: 'all' | 'limited';
      readonly photos: readonly TPhoto[];
      readonly remainingCapacity: number;
    };

/** Requests access only after the caller has chosen Camera or Photo Library. */
export async function pickMealPhotos<TPhoto extends PickedMealPhoto>(
  source: MealPhotoSource,
  currentCount: number,
  picker: MealPhotoPickerAdapter<TPhoto>,
): Promise<MealPhotoPickResult<TPhoto>> {
  if (!Number.isInteger(currentCount) || currentCount < 0) {
    throw new Error('Current photo count must be a nonnegative integer.');
  }
  const remainingCapacity = Math.max(0, MEAL_PHOTO_LIMIT - currentCount);
  if (remainingCapacity === 0) return { kind: 'limit-reached', photos: [] };

  const permission = decideMealPhotoPermission(source, await picker.requestPermission(source));
  if (!permission.allowed) {
    return {
      kind: 'permission-denied',
      source,
      canAskAgain: permission.canAskAgain,
      photos: [],
    };
  }

  const selection = await picker.launch(source, { selectionLimit: remainingCapacity });
  if (selection.canceled) return { kind: 'cancelled', photos: [] };
  const photos = selection.assets.slice(0, remainingCapacity);
  return {
    kind: 'selected',
    permissionScope: permission.scope,
    photos,
    remainingCapacity: remainingCapacity - photos.length,
  };
}

export interface MealPhotoDraftFileStore {
  stage(photo: PickedMealPhoto, id: MediaId, createdAt: ISODateTime): Promise<LocalMealPhoto>;
  promote(photo: LocalMealPhoto): Promise<LocalMealPhoto>;
  restoreToDraft(photo: LocalMealPhoto): Promise<LocalMealPhoto>;
  discard(photo: Pick<LocalMealPhoto, 'uri'>): Promise<void> | void;
}

async function discardAll(
  photos: readonly Pick<LocalMealPhoto, 'uri'>[],
  store: Pick<MealPhotoDraftFileStore, 'discard'>,
): Promise<void> {
  const failures: unknown[] = [];
  for (const photo of photos) {
    try {
      await store.discard(photo);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more staged meal photos could not be removed.');
  }
}

/** A cancelled composer removes every session-local derivative, even if one delete fails. */
export async function cancelMealPhotoDraft(
  photos: readonly LocalMealPhoto[],
  store: Pick<MealPhotoDraftFileStore, 'discard'>,
): Promise<void> {
  await discardAll(photos, store);
}

/**
 * Stages selected photos in picker order. A mid-batch processing failure
 * removes every derivative produced by this call before rethrowing.
 */
export async function stageMealPhotoSelection(options: {
  readonly existing: readonly LocalMealPhoto[];
  readonly retainedCount?: number;
  readonly selected: readonly PickedMealPhoto[];
  readonly store: Pick<MealPhotoDraftFileStore, 'stage' | 'discard'>;
  readonly createId: () => MediaId;
  readonly now: () => ISODateTime;
}): Promise<readonly LocalMealPhoto[]> {
  const retainedCount = options.retainedCount ?? 0;
  if (!Number.isInteger(retainedCount) || retainedCount < 0) {
    throw new Error('Retained photo count must be a nonnegative integer.');
  }
  const capacity = Math.max(0, MEAL_PHOTO_LIMIT - retainedCount - options.existing.length);
  const staged: LocalMealPhoto[] = [];
  try {
    for (const photo of options.selected.slice(0, capacity)) {
      if (!(photo.width > 0) || !(photo.height > 0)) continue;
      staged.push(await options.store.stage(photo, options.createId(), options.now()));
    }
    return [...options.existing, ...staged];
  } catch (error) {
    try {
      await discardAll([...staged].reverse(), options.store);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Meal photo processing failed and staged-file cleanup was incomplete.',
      );
    }
    throw error;
  }
}

export function reconstructMealPhotoOrder(
  order: readonly MediaId[],
  photos: readonly LocalMealPhoto[],
): readonly LocalMealPhoto[] {
  const byId = new Map<MediaId, LocalMealPhoto>();
  for (const photo of photos) {
    if (byId.has(photo.id)) throw new Error(`Duplicate meal photo ${photo.id}.`);
    byId.set(photo.id, photo);
  }
  return order.map((id) => {
    const photo = byId.get(id);
    if (!photo) throw new Error(`Meal photo ${id} is missing.`);
    return photo;
  });
}

/**
 * Promotes files in display order. If any move rejects, already-promoted files
 * are moved back to drafts in reverse order, so a retry starts from one state.
 * The store's promote contract is atomic: a rejected move leaves its source in
 * place, which is the guarantee Expo File.move provides.
 */
export async function promoteMealPhotosWithRollback(
  photos: readonly LocalMealPhoto[],
  store: Pick<MealPhotoDraftFileStore, 'promote' | 'restoreToDraft'>,
): Promise<readonly LocalMealPhoto[]> {
  const promoted: LocalMealPhoto[] = [];
  try {
    for (const photo of photos) promoted.push(await store.promote(photo));
    return reconstructMealPhotoOrder(photos.map((photo) => photo.id), promoted);
  } catch (error) {
    const rollbackFailures: unknown[] = [];
    for (const photo of [...promoted].reverse()) {
      try {
        await store.restoreToDraft(photo);
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    if (rollbackFailures.length > 0) {
      throw new AggregateError(
        [error, ...rollbackFailures],
        'Meal photo promotion failed and file rollback was incomplete.',
      );
    }
    throw error;
  }
}

export interface MealPhotoRollbackResult {
  readonly restored: readonly LocalMealPhoto[];
  readonly unavailableIds: readonly MediaId[];
}

/**
 * Returns a fully promoted batch to draft storage after a later database or
 * meal-save failure. Files that cannot be restored are discarded so startup
 * cleanup never mistakes a partial durable batch for committed media.
 */
export async function restorePromotedMealPhotosForRetry(
  photos: readonly LocalMealPhoto[],
  store: Pick<MealPhotoDraftFileStore, 'restoreToDraft' | 'discard'>,
): Promise<MealPhotoRollbackResult> {
  const restoredById = new Map<MediaId, LocalMealPhoto>();
  const unavailable = new Set<MediaId>();
  for (const photo of [...photos].reverse()) {
    try {
      const restored = await store.restoreToDraft(photo);
      restoredById.set(restored.id, restored);
    } catch {
      unavailable.add(photo.id);
      try {
        await store.discard(photo);
      } catch {
        // Startup orphan cleanup is the final retry when a local delete fails.
      }
    }
  }
  return {
    restored: photos.flatMap((photo) => {
      const restored = restoredById.get(photo.id);
      return restored ? [restored] : [];
    }),
    unavailableIds: photos.filter((photo) => unavailable.has(photo.id)).map((photo) => photo.id),
  };
}

export type MealPhotoCoordinatorPickResult<TPhoto extends PickedMealPhoto = PickedMealPhoto> =
  | (Exclude<MealPhotoPickResult<TPhoto>, { readonly kind: 'selected' }> & {
      readonly stagedPhotos: readonly LocalMealPhoto[];
    })
  | {
      readonly kind: 'selected';
      readonly permissionScope: 'all' | 'limited';
      readonly selectedPhotos: readonly TPhoto[];
      readonly stagedPhotos: readonly LocalMealPhoto[];
      readonly remainingCapacity: number;
    };

/**
 * The UI-facing production coordinator. It is deliberately platform-neutral:
 * Expo permission/picker APIs and the Expo file store are injected by the
 * screen, while ordering, caps, cleanup, and rollback stay behavior-testable.
 */
export class MealPhotoComposerCoordinator<TPhoto extends PickedMealPhoto = PickedMealPhoto> {
  constructor(
    private readonly picker: MealPhotoPickerAdapter<TPhoto>,
    private readonly store: MealPhotoDraftFileStore,
    private readonly createId: () => MediaId,
    private readonly now: () => ISODateTime,
  ) {}

  async pickAndStage(options: {
    readonly source: MealPhotoSource;
    readonly retainedCount: number;
    readonly stagedPhotos: readonly LocalMealPhoto[];
  }): Promise<MealPhotoCoordinatorPickResult<TPhoto>> {
    const picked = await pickMealPhotos(
      options.source,
      options.retainedCount + options.stagedPhotos.length,
      this.picker,
    );
    if (picked.kind !== 'selected') {
      return { ...picked, stagedPhotos: options.stagedPhotos };
    }
    const stagedPhotos = await stageMealPhotoSelection({
      existing: options.stagedPhotos,
      retainedCount: options.retainedCount,
      selected: picked.photos,
      store: this.store,
      createId: this.createId,
      now: this.now,
    });
    return {
      kind: 'selected',
      permissionScope: picked.permissionScope,
      selectedPhotos: picked.photos,
      stagedPhotos,
      remainingCapacity: MEAL_PHOTO_LIMIT - options.retainedCount - stagedPhotos.length,
    };
  }

  cancel(stagedPhotos: readonly LocalMealPhoto[]): Promise<void> {
    return cancelMealPhotoDraft(stagedPhotos, this.store);
  }

  promote(stagedPhotos: readonly LocalMealPhoto[]): Promise<readonly LocalMealPhoto[]> {
    return promoteMealPhotosWithRollback(stagedPhotos, this.store);
  }

  restoreForRetry(promotedPhotos: readonly LocalMealPhoto[]): Promise<MealPhotoRollbackResult> {
    return restorePromotedMealPhotosForRetry(promotedPhotos, this.store);
  }
}
