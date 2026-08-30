import type {
  Food,
  FoodCandidate,
  Meal,
  MealContextInput,
  MealItem,
  MediaAsset,
  PortionSelection,
} from '@/domain';
import { foodIdForRef, sourceIdFromFoodId } from '@/domain/food/source';
import { normalizeMealContextInput } from '@/domain/meals/meal';
import type {
  ISODateTime,
  MealId,
  MealItemId,
  MediaId,
  RecipeId,
} from '@/domain/shared/ids';
import type {
  FoodRepository,
  MealRepository,
  MediaRepository,
  TransactionRunner,
} from '@/data/repositories/contracts';
import { foodRefForFoodId } from '@/services/meals/saved-meals';
import type {
  PrivateDataGeneration,
  PrivateDataWriteCoordinator,
} from '@/services/privacy/private-data-write-coordinator';

export interface FoodCandidatePersistence {
  persist(candidate: FoodCandidate): Promise<void>;
}

export interface MealDraft {
  readonly id: MealId;
  readonly createdAt: ISODateTime;
  readonly context: MealContextInput;
  readonly items: readonly MealItem[];
  /** Internal epoch used to reject a closure retained across private-data deletion. */
  readonly privateDataGeneration?: PrivateDataGeneration;
}

export interface AddMealItemOptions {
  readonly portion: PortionSelection;
  readonly recipeId?: RecipeId;
  readonly note?: string;
}

export class MealNotFoundError extends Error {
  constructor(readonly mealId: MealId) {
    super(`Meal ${mealId} does not exist.`);
    this.name = 'MealNotFoundError';
  }
}

export class MealItemNotFoundError extends Error {
  constructor(readonly itemId: MealItemId) {
    super(`Meal item ${itemId} does not exist.`);
    this.name = 'MealItemNotFoundError';
  }
}

export const directTransactionRunner: TransactionRunner = {
  run: <T>(operation: () => Promise<T>) => operation(),
};

function requirePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a finite number greater than zero.`);
  }
}

function normalizeTimestamp(value: ISODateTime, label: string): ISODateTime {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date and time.`);
  return parsed.toISOString() as ISODateTime;
}

export function validatePortionSelection(portion: PortionSelection): void {
  requirePositive(portion.quantity, 'Portion quantity');
  if (portion.gramWeight !== undefined) requirePositive(portion.gramWeight, 'Portion gram weight');
}

function normalizeItemNote(note: string | undefined): string | undefined {
  const normalized = note?.trim();
  return normalized || undefined;
}

function cloneItem(item: MealItem): MealItem {
  return {
    ...item,
    ...(item.foodRef ? { foodRef: { ...item.foodRef } } : {}),
    portion: { ...item.portion },
  };
}

function mediaIdsFor(context: MealContextInput): readonly MediaId[] {
  return context.mediaIds ?? [];
}

function assertMediaAsset(asset: MediaAsset): void {
  if (!asset.uri.trim()) throw new Error('Media URI is required.');
  if (!asset.mimeType.trim()) throw new Error('Media MIME type is required.');
  requirePositive(asset.width, 'Media width');
  requirePositive(asset.height, 'Media height');
  if (!Number.isInteger(asset.byteSize) || asset.byteSize < 0) {
    throw new Error('Media byte size must be a nonnegative integer.');
  }
  normalizeTimestamp(asset.createdAt, 'Media creation time');
  normalizeTimestamp(asset.updatedAt, 'Media update time');
}

/**
 * Stateless draft operations plus the single confirmation boundary used by
 * every logging path. Provider candidates are retained before a draft item is
 * returned, so a confirmed event can always resolve its historical FoodRef.
 */
export class MealComposerService {
  private readonly pendingSaves = new Map<MealId, Promise<Meal>>();

  constructor(
    private readonly foods: FoodRepository,
    private readonly meals: MealRepository,
    private readonly candidates: FoodCandidatePersistence,
    private readonly idFactory: (prefix: string) => string,
    private readonly media?: MediaRepository,
    private readonly transactions: TransactionRunner = directTransactionRunner,
    private readonly privateDataWrites?: PrivateDataWriteCoordinator,
  ) {}

  createDraft(context: MealContextInput, now: ISODateTime): MealDraft {
    return {
      id: this.idFactory('meal') as MealId,
      createdAt: normalizeTimestamp(now, 'Draft creation time'),
      context: normalizeMealContextInput(context),
      items: [],
      ...(this.privateDataWrites
        ? { privateDataGeneration: this.privateDataWrites.generation }
        : {}),
    };
  }

  draftFromMeal(meal: Meal): MealDraft {
    return {
      id: meal.id,
      createdAt: meal.createdAt,
      context: normalizeMealContextInput({
        occurredAt: meal.occurredAt,
        ...(meal.title === undefined ? {} : { title: meal.title }),
        ...(meal.caption === undefined ? {} : { caption: meal.caption }),
        ...(meal.location === undefined ? {} : { location: meal.location }),
        ...(meal.mediaIds.length === 0 ? {} : { mediaIds: meal.mediaIds }),
      }),
      items: meal.items.map(cloneItem),
      ...(this.privateDataWrites
        ? { privateDataGeneration: this.privateDataWrites.generation }
        : {}),
    };
  }

  async loadDraft(mealId: MealId): Promise<MealDraft> {
    return this.runPrivateWrite(undefined, async () => {
      const meal = await this.meals.getById(mealId);
      if (!meal) throw new MealNotFoundError(mealId);
      return this.draftFromMeal(meal);
    });
  }

  withContext(draft: MealDraft, context: MealContextInput): MealDraft {
    return { ...draft, context: normalizeMealContextInput(context) };
  }

  async addCandidate(
    draft: MealDraft,
    candidate: FoodCandidate,
    options: AddMealItemOptions,
  ): Promise<MealDraft> {
    validatePortionSelection(options.portion);
    const personalLegacyId =
      candidate.ref.sourceId === 'personal' && sourceIdFromFoodId(candidate.food.id) === null;
    const canonicalFoodId = foodIdForRef(candidate.ref);
    if (!personalLegacyId && candidate.food.id !== canonicalFoodId) {
      throw new Error('Food candidate ID does not match its provider reference.');
    }
    await this.runPrivateWrite(draft, async () => {
      await this.candidates.persist(candidate);
      await this.foods.save(candidate.food);
    });

    const foodId = personalLegacyId ? candidate.food.id : canonicalFoodId;
    const note = normalizeItemNote(options.note);
    const item: MealItem = {
      id: this.idFactory('item') as MealItemId,
      foodId,
      foodRef: { ...candidate.ref },
      portion: { ...options.portion },
      ...(options.recipeId ? { recipeId: options.recipeId } : {}),
      ...(note ? { note } : {}),
    };
    return { ...draft, items: [...draft.items, item] };
  }

  /** Add an already-private personal food or immutable recipe snapshot. */
  async addFood(draft: MealDraft, food: Food, options: AddMealItemOptions): Promise<MealDraft> {
    validatePortionSelection(options.portion);
    const sourceId = sourceIdFromFoodId(food.id);
    if (sourceId && sourceId !== 'personal') {
      throw new Error('Provider foods must be added with their full FoodCandidate provenance.');
    }
    await this.runPrivateWrite(draft, () => this.foods.save(food));
    const note = normalizeItemNote(options.note);
    const item: MealItem = {
      id: this.idFactory('item') as MealItemId,
      foodId: food.id,
      foodRef: foodRefForFoodId(food.id),
      portion: { ...options.portion },
      ...(options.recipeId ? { recipeId: options.recipeId } : {}),
      ...(note ? { note } : {}),
    };
    return { ...draft, items: [...draft.items, item] };
  }

  updateItemPortion(draft: MealDraft, itemId: MealItemId, portion: PortionSelection): MealDraft {
    validatePortionSelection(portion);
    let found = false;
    const items = draft.items.map((item) => {
      if (item.id !== itemId) return item;
      found = true;
      return { ...item, portion: { ...portion } };
    });
    if (!found) throw new MealItemNotFoundError(itemId);
    return { ...draft, items };
  }

  removeItem(draft: MealDraft, itemId: MealItemId): MealDraft {
    const items = draft.items.filter((item) => item.id !== itemId);
    if (items.length === draft.items.length) throw new MealItemNotFoundError(itemId);
    return { ...draft, items };
  }

  /** Rejects a session publication retained across a private-data reset. */
  assertDraftWritable(draft: MealDraft): void {
    this.privateDataWrites?.assertWriteAllowed(draft.privateDataGeneration);
  }

  /** Runs a file-producing draft action inside the same reset boundary. */
  runDraftWrite<T>(draft: MealDraft, operation: () => Promise<T>): Promise<T> {
    return this.runPrivateWrite(draft, operation);
  }

  save(draft: MealDraft, now: ISODateTime): Promise<Meal> {
    return this.enqueueSave(draft, () => (
      this.runPrivateWrite(draft, () => this.performSave(draft, now, []))
    ));
  }

  /**
   * Production confirmation boundary. The write lease is acquired before
   * staged files are promoted, then new media rows and the meal are committed
   * in one database transaction. A reset therefore either waits for the whole
   * confirmation or rejects it before file promotion begins.
   */
  saveWithMedia(
    draft: MealDraft,
    now: ISODateTime,
    prepareAssets: () => Promise<readonly MediaAsset[]>,
    rollbackAssets?: (assets: readonly MediaAsset[], cause: unknown) => Promise<void>,
  ): Promise<Meal> {
    return this.enqueueSave(draft, () => this.runPrivateWrite(draft, async () => {
      let assets: readonly MediaAsset[] = [];
      try {
        // Validate before promoting files, then validate again inside the
        // transaction when the final Meal value is assembled.
        this.validateDraftForSave(draft, now);
        assets = await prepareAssets();
        return await this.performSave(draft, now, assets);
      } catch (error) {
        if (rollbackAssets) {
          try {
            await rollbackAssets(assets, error);
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              'Meal confirmation failed and private media rollback was incomplete.',
            );
          }
        }
        throw error;
      }
    }));
  }

  private enqueueSave(draft: MealDraft, operation: () => Promise<Meal>): Promise<Meal> {
    const existing = this.pendingSaves.get(draft.id);
    if (existing) return existing;
    const pending = operation();
    this.pendingSaves.set(draft.id, pending);
    pending.then(
      () => this.pendingSaves.delete(draft.id),
      () => this.pendingSaves.delete(draft.id),
    );
    return pending;
  }

  private async performSave(
    draft: MealDraft,
    now: ISODateTime,
    mediaAssets: readonly MediaAsset[],
  ): Promise<Meal> {
    this.validateDraftForSave(draft, now);
    const context = normalizeMealContextInput(draft.context);
    const updatedAt = normalizeTimestamp(now, 'Meal update time');
    const nextMediaIds = mediaIdsFor(context);
    if (nextMediaIds.length > 0 && !this.media) throw new Error('Media persistence is unavailable.');
    const media = mediaAssets.length > 0 ? this.requireMediaAssets(mediaAssets) : this.media;
    const nextMediaSet = new Set(nextMediaIds);
    if (mediaAssets.some((asset) => !nextMediaSet.has(asset.id))) {
      throw new Error('Every newly registered media asset must belong to the confirmed meal.');
    }
    return this.transactions.run(async () => {
      if (media && mediaAssets.length > 0) await media.saveMany(mediaAssets);
      const current = await this.meals.getById(draft.id);
      const previousMediaIds = current?.mediaIds ?? [];
      const removedMediaIds = previousMediaIds.filter((id) => !nextMediaSet.has(id));
      const meal: Meal = {
        id: draft.id,
        occurredAt: context.occurredAt,
        items: draft.items.map(cloneItem),
        mediaIds: [...nextMediaIds],
        ...(context.title === undefined ? {} : { title: context.title }),
        ...(context.caption === undefined ? {} : { caption: context.caption }),
        ...(context.location === undefined ? {} : { location: context.location }),
        createdAt: current?.createdAt ?? draft.createdAt,
        updatedAt,
      };
      if (media && removedMediaIds.length > 0) {
        await media.detachFromMeal(removedMediaIds, meal.id, updatedAt);
      }
      await this.meals.save(meal);
      if (media && nextMediaIds.length > 0) {
        await media.attachToMeal(nextMediaIds, meal.id, updatedAt);
      }
      return meal;
    });
  }

  private validateDraftForSave(draft: MealDraft, now: ISODateTime): void {
    if (draft.items.length === 0) throw new Error('A meal requires at least one food.');
    if (new Set(draft.items.map((item) => item.id)).size !== draft.items.length) {
      throw new Error('Meal item IDs must be unique.');
    }
    for (const item of draft.items) validatePortionSelection(item.portion);
    normalizeMealContextInput(draft.context);
    normalizeTimestamp(now, 'Meal update time');
  }

  private requireMediaAssets(assets: readonly MediaAsset[]): MediaRepository {
    if (!this.media) throw new Error('Media persistence is unavailable.');
    for (const asset of assets) assertMediaAsset(asset);
    if (new Set(assets.map((asset) => asset.id)).size !== assets.length) {
      throw new Error('Media asset IDs must be unique.');
    }
    return this.media;
  }

  private runPrivateWrite<T>(
    draft: MealDraft | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (!this.privateDataWrites) return operation();
    return this.privateDataWrites.runWrite(operation, draft?.privateDataGeneration);
  }
}
