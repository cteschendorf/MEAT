import type { Meal, MediaAsset, PortionSelection } from '@/domain';
import type { ISODateTime, MealId, MealItemId } from '@/domain/shared/ids';
import type {
  MealRepository,
  MediaRepository,
  TransactionRunner,
} from '@/data/repositories/contracts';
import {
  directTransactionRunner,
  MealItemNotFoundError,
  MealNotFoundError,
  validatePortionSelection,
} from '@/services/meals/meal-composer';

export const MEAL_DELETE_UNDO_WINDOW_MS = 10_000;

export interface PendingMealDeletion {
  readonly token: string;
  readonly mealId: MealId;
  readonly expiresAt: ISODateTime;
}

interface PendingMealDeletionRecord extends PendingMealDeletion {
  readonly meal: Meal;
  readonly mediaAssets: readonly MediaAsset[];
}

export interface MediaAssetFileStore {
  /** Must be idempotent so interrupted cleanup can be retried safely. */
  delete(uri: string): Promise<void> | void;
}

export class MealDeletionExpiredError extends Error {
  constructor(readonly token: string) {
    super('The meal can no longer be restored.');
    this.name = 'MealDeletionExpiredError';
  }
}

export class LastMealItemRemovalRequiresConfirmationError extends Error {
  constructor(readonly mealId: MealId) {
    super('Removing the final food deletes the entire meal and requires confirmation.');
    this.name = 'LastMealItemRemovalRequiresConfirmationError';
  }
}

export type RemoveMealItemResult =
  | { readonly kind: 'updated'; readonly meal: Meal }
  | { readonly kind: 'pending-delete'; readonly deletion: PendingMealDeletion };

function ascendingTimelineOrder(left: Meal, right: Meal): number {
  return left.occurredAt.localeCompare(right.occurredAt)
    || left.createdAt.localeCompare(right.createdAt)
    || String(left.id).localeCompare(String(right.id));
}

function descendingHistoryOrder(left: Meal, right: Meal): number {
  return -ascendingTimelineOrder(left, right);
}

function requireValidLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit <= 0) throw new Error('History limit must be a positive integer.');
}

function requireValidTimestamp(value: ISODateTime, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be a valid date and time.`);
  return parsed;
}

/** Timeline ordering, durable edits, and the in-session ten-second undo window. */
export class MealHistoryService {
  private readonly pending = new Map<string, PendingMealDeletionRecord>();
  /**
   * Deletion, undo, expiry, and private-data reset all mutate the same in-memory
   * ownership state. Keeping those operations behind one FIFO gate makes the
   * first caller the deterministic owner of a token and prevents an undo from
   * reattaching media while finalization is deleting it.
   */
  private deletionStateTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly meals: MealRepository,
    private readonly media: MediaRepository,
    private readonly idFactory: (prefix: string) => string,
    private readonly mediaFiles?: MediaAssetFileStore,
    private readonly transactions: TransactionRunner = directTransactionRunner,
  ) {}

  async listDay(start: ISODateTime, end: ISODateTime): Promise<readonly Meal[]> {
    if (requireValidTimestamp(start, 'Day start') >= requireValidTimestamp(end, 'Day end')) {
      throw new Error('Day end must be later than day start.');
    }
    return [...await this.meals.listByDateRange(start, end)].sort(ascendingTimelineOrder);
  }

  async listRecent(limit = 100): Promise<readonly Meal[]> {
    requireValidLimit(limit);
    return [...await this.meals.listRecent(limit)].sort(descendingHistoryOrder);
  }

  async updatePortion(
    mealId: MealId,
    itemId: MealItemId,
    portion: PortionSelection,
    now: ISODateTime,
  ): Promise<Meal> {
    validatePortionSelection(portion);
    requireValidTimestamp(now, 'Meal update time');
    const meal = await this.requireMeal(mealId);
    let found = false;
    const items = meal.items.map((item) => {
      if (item.id !== itemId) return item;
      found = true;
      return { ...item, portion: { ...portion } };
    });
    if (!found) throw new MealItemNotFoundError(itemId);
    const updated = { ...meal, items, updatedAt: now };
    await this.meals.save(updated);
    return updated;
  }

  async removeItem(
    mealId: MealId,
    itemId: MealItemId,
    now: ISODateTime,
    confirmEventDeletion = false,
  ): Promise<RemoveMealItemResult> {
    requireValidTimestamp(now, 'Meal update time');
    const meal = await this.requireMeal(mealId);
    if (!meal.items.some((item) => item.id === itemId)) throw new MealItemNotFoundError(itemId);
    if (meal.items.length === 1) {
      if (!confirmEventDeletion) throw new LastMealItemRemovalRequiresConfirmationError(mealId);
      return { kind: 'pending-delete', deletion: await this.deleteWithUndo(mealId, now) };
    }
    const updated: Meal = {
      ...meal,
      items: meal.items.filter((item) => item.id !== itemId),
      updatedAt: now,
    };
    await this.meals.save(updated);
    return { kind: 'updated', meal: updated };
  }

  async deleteWithUndo(mealId: MealId, deletedAt: ISODateTime): Promise<PendingMealDeletion> {
    return this.runDeletionStateExclusive(async () => {
      const deletedTime = requireValidTimestamp(deletedAt, 'Deletion time');
      if ([...this.pending.values()].some((entry) => entry.mealId === mealId)) {
        throw new Error('This meal is already pending deletion.');
      }
      const meal = await this.requireMeal(mealId);
      const mediaAssets = await this.media.listByIds(meal.mediaIds);
      const record: PendingMealDeletionRecord = {
        token: this.idFactory('meal-delete'),
        mealId,
        expiresAt: new Date(deletedTime + MEAL_DELETE_UNDO_WINDOW_MS).toISOString() as ISODateTime,
        meal,
        mediaAssets,
      };
      await this.transactions.run(async () => {
        await this.media.detachFromMeal(meal.mediaIds, meal.id, deletedAt);
        await this.meals.delete(meal.id);
        return true;
      });
      this.pending.set(record.token, record);
      return { token: record.token, mealId: record.mealId, expiresAt: record.expiresAt };
    });
  }

  async undoDelete(token: string, now: ISODateTime): Promise<Meal> {
    return this.runDeletionStateExclusive(() => this.undoDeleteExclusive(token, now));
  }

  private async undoDeleteExclusive(token: string, now: ISODateTime): Promise<Meal> {
    const record = this.pending.get(token);
    if (!record) throw new MealDeletionExpiredError(token);
    if (requireValidTimestamp(now, 'Undo time') >= Date.parse(record.expiresAt)) {
      await this.finalizeDeleteExclusive(token);
      throw new MealDeletionExpiredError(token);
    }
    if (await this.meals.getById(record.meal.id)) {
      throw new Error(`Meal ${record.meal.id} already exists and cannot be restored.`);
    }
    await this.transactions.run(async () => {
      await this.meals.save(record.meal);
      await this.media.attachToMeal(record.meal.mediaIds, record.meal.id, now);
      return true;
    });
    this.pending.delete(token);
    return record.meal;
  }

  async finalizeDelete(token: string): Promise<boolean> {
    return this.runDeletionStateExclusive(() => this.finalizeDeleteExclusive(token));
  }

  private async finalizeDeleteExclusive(token: string): Promise<boolean> {
    const record = this.pending.get(token);
    if (!record) return false;
    await this.disposeAssets(record.mediaAssets);
    this.pending.delete(token);
    return true;
  }

  async finalizeExpired(now: ISODateTime): Promise<number> {
    const current = requireValidTimestamp(now, 'Cleanup time');
    return this.runDeletionStateExclusive(async () => {
      const expired = [...this.pending.values()].filter((entry) => Date.parse(entry.expiresAt) <= current);
      let finalized = 0;
      for (const entry of expired) {
        if (await this.finalizeDeleteExclusive(entry.token)) finalized += 1;
      }
      return finalized;
    });
  }

  async cleanupUnattached(cutoff: ISODateTime, limit = 100): Promise<number> {
    requireValidTimestamp(cutoff, 'Cleanup cutoff');
    requireValidLimit(limit);
    return this.runDeletionStateExclusive(async () => {
      const protectedIds = new Set(
        [...this.pending.values()].flatMap((entry) => entry.mediaAssets.map((asset) => asset.id)),
      );
      const assets = (await this.media.listUnattachedBefore(cutoff, limit))
        .filter((asset) => !protectedIds.has(asset.id));
      await this.disposeAssets(assets);
      return assets.length;
    });
  }

  /**
   * Holds all deletion/undo work while private data is purged. The callback
   * marks the point at which the database transaction has committed. From that
   * point onward pending snapshots must be discarded even if file cleanup
   * fails, because restoring one would recreate data the user deleted.
   */
  async runExclusivePrivateDataReset(
    operation: (markDatabasePurged: () => void) => Promise<void>,
  ): Promise<void> {
    await this.runDeletionStateExclusive(async () => {
      let databasePurged = false;
      try {
        await operation(() => { databasePurged = true; });
      } finally {
        if (databasePurged) this.pending.clear();
      }
    });
  }

  getPendingDeletion(token: string): PendingMealDeletion | null {
    const record = this.pending.get(token);
    return record
      ? { token: record.token, mealId: record.mealId, expiresAt: record.expiresAt }
      : null;
  }

  private async requireMeal(mealId: MealId): Promise<Meal> {
    const meal = await this.meals.getById(mealId);
    if (!meal) throw new MealNotFoundError(mealId);
    return meal;
  }

  private async disposeAssets(assets: readonly MediaAsset[]): Promise<void> {
    if (this.mediaFiles) {
      for (const asset of assets) await this.mediaFiles.delete(asset.uri);
    }
    await this.media.deleteMany(assets.map((asset) => asset.id));
  }

  private runDeletionStateExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.deletionStateTail;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    this.deletionStateTail = previous.catch(() => undefined).then(() => gate);

    return previous
      .catch(() => undefined)
      .then(operation)
      .finally(release);
  }
}
