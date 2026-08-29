import type { Food } from '@/domain';
import type { ExternalFoodProvider, ExternalFoodProviderId } from '@/data/food-data/external';
import type { FoodSourceId } from '@/data/food-data/source-preferences';

export type BarcodeResolutionSource = 'personal' | 'usda-local' | ExternalFoodProviderId;

export type BarcodeResolution =
  | { status: 'found'; barcode: string; food: Food; sourceId: BarcodeResolutionSource }
  | { status: 'not-found'; barcode: string }
  | { status: 'offline'; barcode: string };

export interface BarcodeFoodStore {
  list(limit?: number): Promise<readonly Food[]>;
}

export interface BarcodeLocalSource {
  findByBarcode(barcode: string): Promise<Food | null>;
}

export interface BarcodeCache {
  get(provider: ExternalFoodProviderId, key: string, now?: Date): Promise<Food | null>;
  put(provider: ExternalFoodProviderId, key: string, food: Food, ttlDays?: number): Promise<void>;
}

export interface BarcodeSourcePreferences {
  isEnabled(sourceId: FoodSourceId): Promise<boolean>;
}

export function normalizeBarcode(raw: string): string {
  const normalized = raw.replace(/[^0-9]/g, '');
  if (![8, 12, 13, 14].includes(normalized.length)) {
    throw new Error('Barcode must be an EAN-8, UPC-A, EAN-13, or GTIN-14 value.');
  }
  return normalized;
}

export function barcodeCandidates(raw: string): readonly string[] {
  const normalized = normalizeBarcode(raw);
  const candidates = [normalized];
  if (normalized.length === 13 && normalized.startsWith('0')) candidates.push(normalized.slice(1));
  if (normalized.length === 12) candidates.push(`0${normalized}`);
  return [...new Set(candidates)];
}

export class BarcodeLookupService {
  constructor(
    private readonly foods: BarcodeFoodStore,
    private readonly localCorpus: BarcodeLocalSource,
    private readonly providers: readonly ExternalFoodProvider[],
    private readonly cache: BarcodeCache,
    private readonly sourcePreferences: BarcodeSourcePreferences,
  ) {}

  async resolve(rawBarcode: string): Promise<BarcodeResolution> {
    const candidates = barcodeCandidates(rawBarcode);
    const barcode = candidates[0] ?? normalizeBarcode(rawBarcode);

    if (await this.sourcePreferences.isEnabled('personal')) {
      const personalFoods = await this.foods.list(500);
      const personal = personalFoods.find((food) => food.barcode && candidates.includes(food.barcode));
      if (personal) return { status: 'found', barcode, food: personal, sourceId: 'personal' };
    }

    if (await this.sourcePreferences.isEnabled('usda-local')) {
      for (const candidate of candidates) {
        const local = await this.localCorpus.findByBarcode(candidate);
        if (local) return { status: 'found', barcode, food: local, sourceId: 'usda-local' };
      }
    }

    let successfulNetworkAttempt = false;
    let failedNetworkAttempt = false;

    for (const provider of this.providers) {
      if (!(await this.sourcePreferences.isEnabled(provider.id))) continue;
      for (const candidate of candidates) {
        const key = `barcode:${candidate}`;
        const cached = await this.cache.get(provider.id, key);
        if (cached) return { status: 'found', barcode, food: cached, sourceId: provider.id };

        try {
          const food = await provider.findByBarcode(candidate);
          successfulNetworkAttempt = true;
          if (food) {
            await this.cache.put(provider.id, key, food);
            return { status: 'found', barcode, food, sourceId: provider.id };
          }
        } catch {
          failedNetworkAttempt = true;
        }
      }
    }

    if (failedNetworkAttempt && !successfulNetworkAttempt) return { status: 'offline', barcode };
    return { status: 'not-found', barcode };
  }
}
