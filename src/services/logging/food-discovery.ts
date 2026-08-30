import type { Food } from '@/domain';
import type {
  FoodCandidate,
  FoodPortion,
  FoodProvenance,
  FoodRef,
  FoodSearchGroup,
  FoodSourceId,
} from '@/domain/food/source';
import {
  foodIdForRef,
  legacyProviderFoodIdForRef,
  sourceIdFromFoodId,
} from '@/domain/food/source';
import type { FoodId, SourceRecordId } from '@/domain/shared/ids';
import { ApiError } from '@/data/providers/api-error';
import type {
  FoodLookupResult,
  FoodProvider,
  FoodProviderIssue,
  FoodSearchOptions,
} from '@/data/providers/contracts';
import type { FoodSourcePreferenceStore } from '@/data/food-data/source-preferences';
import type { FoodReferenceRepository, FoodRepository } from '@/data/repositories/contracts';

export const foodSourceOrder: readonly FoodSourceId[] = [
  'personal',
  'usda-core',
  'usda-fdc',
  'open-food-facts',
];

function portionsForFood(food: Food): readonly FoodPortion[] {
  return food.servings.map((serving) => ({
    id: serving.id,
    label: serving.label,
    quantity: serving.quantity,
    unit: serving.unit,
    ...(serving.gramWeight === undefined ? {} : { gramWeight: serving.gramWeight }),
    ...(serving.isDefault === undefined ? {} : { isDefault: serving.isDefault }),
  }));
}

function recordIdFromFoodId(foodId: FoodId | string, sourceId: FoodSourceId): SourceRecordId {
  if (sourceIdFromFoodId(foodId) !== sourceId) return String(foodId) as SourceRecordId;
  const separator = foodId.indexOf(':');
  const encoded = separator < 0 ? foodId : foodId.slice(separator + 1);
  try {
    return decodeURIComponent(encoded) as SourceRecordId;
  } catch {
    return encoded as SourceRecordId;
  }
}

function isPersonalFood(food: Food): boolean {
  return (sourceIdFromFoodId(food.id) ?? 'personal') === 'personal';
}

function foodForRequestedId(food: Food, requestedId: FoodId, ref: FoodRef): Food | null {
  const canonicalId = foodIdForRef(ref);
  const legacyId = legacyProviderFoodIdForRef(ref);
  const personalRawId = ref.sourceId === 'personal' ? (ref.recordId as unknown as FoodId) : null;
  if (
    food.id !== requestedId &&
    food.id !== canonicalId &&
    food.id !== legacyId &&
    food.id !== personalRawId
  ) {
    return null;
  }
  if (food.id === requestedId) return food;
  return {
    ...food,
    id: requestedId,
    servings: food.servings.map((serving) => ({ ...serving, foodId: requestedId })),
  };
}

export function candidateFromFood(food: Food, sourceId?: FoodSourceId): FoodCandidate {
  const resolvedSource = sourceId ?? sourceIdFromFoodId(food.id) ?? 'personal';
  const recordId = recordIdFromFoodId(food.id, resolvedSource);
  const provenance: FoodProvenance = {
    provider: resolvedSource,
    recordId,
    ...(food.primarySource?.retrievedAt
      ? { retrievedAt: food.primarySource.retrievedAt as NonNullable<FoodProvenance['retrievedAt']> }
      : {}),
  };
  return {
    ref: { sourceId: resolvedSource, recordId },
    food,
    portions: portionsForFood(food),
    provenance,
  };
}

export interface SearchablePersonalFoodRepository extends FoodRepository {
  search(query: string, limit?: number): Promise<readonly Food[]>;
}

export class PersonalFoodProvider implements FoodProvider {
  readonly id = 'personal' as const;
  readonly capabilities = {
    search: true,
    getById: true,
    lookupBarcode: true,
    persist: true,
  } as const;

  constructor(private readonly foods: SearchablePersonalFoodRepository) {}

  async search(query: string, options: FoodSearchOptions = {}): Promise<FoodSearchGroup> {
    const limit = options.limit ?? 25;
    const candidates = (await this.foods.search(query, Math.max(limit * 4, 100)))
      .filter(isPersonalFood)
      .slice(0, limit)
      .map((food) => candidateFromFood(food, this.id));
    return candidates.length
      ? { sourceId: this.id, query, state: 'ready', candidates, freshness: 'fresh-cache' }
      : { sourceId: this.id, query, state: 'empty', freshness: 'fresh-cache' };
  }

  async getById(ref: FoodRef): Promise<FoodLookupResult> {
    if (ref.sourceId !== this.id) return { candidate: null, freshness: 'fresh-cache' };
    const direct = await this.foods.getById(ref.recordId as unknown as FoodId);
    const namespaced = direct ?? (await this.foods.getById(foodIdForRef(ref)));
    return {
      candidate: namespaced ? candidateFromFood(namespaced, this.id) : null,
      freshness: 'fresh-cache',
    };
  }

  async lookupBarcode(barcode: string): Promise<FoodLookupResult> {
    const food = (await this.foods.list(500)).find(
      (candidate) => isPersonalFood(candidate) && candidate.barcode === barcode,
    ) ?? null;
    return {
      candidate: food ? candidateFromFood(food, this.id) : null,
      freshness: 'fresh-cache',
    };
  }

  async persist(candidate: FoodCandidate): Promise<void> {
    if (candidate.ref.sourceId !== this.id) {
      throw new Error('A non-personal food cannot be persisted in the personal food store.');
    }
    await this.foods.save(candidate.food);
  }
}

function issueFor(error: unknown): FoodProviderIssue {
  if (error instanceof ApiError) return error.toProviderIssue();
  return {
    kind: 'error',
    code: 'provider-error',
    message: error instanceof Error ? error.message : 'The food source failed unexpectedly.',
  };
}

function failedGroup(sourceId: FoodSourceId, query: string, error: unknown): FoodSearchGroup {
  const issue = issueFor(error);
  const state = issue.kind;
  return { sourceId, query, state, candidates: [], issue };
}

export interface BarcodeProviderResult {
  readonly sourceId: FoodSourceId;
  readonly result: FoodLookupResult;
}

export interface FoodDiscoverySearchOptions extends FoodSearchOptions {
  readonly onGroup?: (group: FoodSearchGroup) => void;
}

export class FoodDiscoveryService {
  private readonly byId: ReadonlyMap<FoodSourceId, FoodProvider>;

  constructor(
    providers: readonly FoodProvider[],
    private readonly preferences: FoodSourcePreferenceStore,
  ) {
    this.byId = new Map(providers.map((provider) => [provider.id, provider]));
  }

  async search(
    query: string,
    options: FoodDiscoverySearchOptions = {},
  ): Promise<readonly FoodSearchGroup[]> {
    const normalized = query.trim();
    const providerOptions: FoodSearchOptions = {
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    };
    const enabled = await Promise.all(
      foodSourceOrder.map(async (sourceId) => ({
        sourceId,
        enabled: await this.preferences.isEnabled(sourceId),
      })),
    );
    return Promise.all(
      enabled
        .filter((entry) => entry.enabled && this.byId.get(entry.sourceId)?.capabilities.search)
        .map(async ({ sourceId }) => {
          const provider = this.byId.get(sourceId);
          if (!provider) {
            const group = failedGroup(sourceId, normalized, new Error('Food source is unavailable.'));
            options.onGroup?.(group);
            return group;
          }
          try {
            const group = await provider.search(normalized, providerOptions);
            options.onGroup?.(group);
            return group;
          } catch (error) {
            const group = failedGroup(sourceId, normalized, error);
            options.onGroup?.(group);
            return group;
          }
        }),
    );
  }

  async getByFoodId(foodId: FoodId): Promise<FoodCandidate | null> {
    const sourceId = sourceIdFromFoodId(foodId) ?? 'personal';
    const provider = this.byId.get(sourceId);
    if (!provider) return null;
    const ref: FoodRef = { sourceId, recordId: recordIdFromFoodId(foodId, sourceId) };
    const allowNetwork =
      sourceId === 'personal' || sourceId === 'usda-core'
        ? true
        : await this.preferences.isEnabled(sourceId);
    return (await provider.getById(ref, { preferCached: true, allowNetwork })).candidate;
  }

  async persist(candidate: FoodCandidate): Promise<void> {
    const provider = this.byId.get(candidate.ref.sourceId);
    if (!provider?.persist) {
      if (candidate.ref.sourceId === 'usda-core') return;
      throw new Error(`Food source ${candidate.ref.sourceId} cannot retain selected records.`);
    }
    await provider.persist(candidate);
  }

  async lookupBarcode(barcode: string, signal?: AbortSignal): Promise<readonly BarcodeProviderResult[]> {
    const enabled = await Promise.all(
      foodSourceOrder.map(async (sourceId) => ({
        sourceId,
        enabled: await this.preferences.isEnabled(sourceId),
      })),
    );
    return Promise.all(
      enabled
        .filter(({ sourceId, enabled: isEnabled }) => {
          const provider = this.byId.get(sourceId);
          return isEnabled && provider?.capabilities.lookupBarcode && provider.lookupBarcode;
        })
        .map(async ({ sourceId }) => {
          const provider = this.byId.get(sourceId);
          if (!provider?.lookupBarcode) {
            return { sourceId, result: { candidate: null, freshness: 'fresh-cache' } };
          }
          try {
            return {
              sourceId,
              result: await provider.lookupBarcode(
                barcode,
                signal === undefined ? {} : { signal },
              ),
            };
          } catch (error) {
            return {
              sourceId,
              result: {
                candidate: null,
                freshness: 'network',
                issue: issueFor(error),
              },
            };
          }
        }),
    );
  }
}

export class CompositeFoodRepository implements FoodRepository {
  constructor(
    private readonly personal: FoodRepository,
    private readonly discovery: FoodDiscoveryService,
    private readonly references: FoodReferenceRepository,
  ) {}

  async getById(id: FoodId): Promise<Food | null> {
    const sourceId = sourceIdFromFoodId(id) ?? 'personal';
    const ref: FoodRef = { sourceId, recordId: recordIdFromFoodId(id, sourceId) };
    try {
      const discovered = await this.discovery.getByFoodId(id);
      if (discovered) return foodForRequestedId(discovered.food, id, ref);
    } catch (error) {
      if (sourceId === 'personal') throw error;
    }
    if (sourceId === 'personal') return null;

    const legacyId = legacyProviderFoodIdForRef(ref);
    if (!legacyId) return null;
    const snapshot = await this.personal.getById(legacyId);
    return snapshot ? foodForRequestedId(snapshot, id, ref) : null;
  }

  async save(food: Food): Promise<void> {
    const candidate = candidateFromFood(food);
    if (candidate.ref.sourceId === 'personal') {
      await this.personal.save(food);
    }
    // External candidates are persisted with their full provider provenance by
    // the discovery flow before they are logged. Saving the normalized Food
    // here must not replace that richer cache record with generic provenance.
    await this.references.touch(food.id, food.updatedAt);
  }

  async delete(id: FoodId): Promise<void> {
    if ((sourceIdFromFoodId(id) ?? 'personal') !== 'personal') {
      throw new Error('Provider food records cannot be deleted from private food storage.');
    }
    await this.personal.delete(id);
  }

  async list(limit = 100): Promise<readonly Food[]> {
    const [personal, knownIds] = await Promise.all([
      this.personal.list(Math.max(limit * 4, 100)),
      this.references.listKnownIds(limit * 2),
    ]);
    const byId = new Map(
      personal.filter(isPersonalFood).slice(0, limit).map((food) => [food.id, food]),
    );
    const external = await Promise.allSettled(
      knownIds
        .filter((id) => !byId.has(id))
        .map((id) => this.getById(id)),
    );
    for (const result of external) {
      if (result.status === 'rejected') continue;
      const food = result.value;
      if (food) byId.set(food.id, food);
      if (byId.size >= limit) break;
    }
    return [...byId.values()].slice(0, limit);
  }
}
