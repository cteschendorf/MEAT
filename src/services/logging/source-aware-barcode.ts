import type { Food, Meal } from '@/domain';
import type {
  FoodCandidate,
  FoodProviderIssue,
  FoodResultFreshness,
  FoodSourceId,
} from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';
import type { BarcodeProviderResult } from '@/services/logging/food-discovery';

export const supportedScannerBarcodeFormats = ['ean8', 'ean13', 'upc_a', 'upc_e'] as const;
export type ScannerBarcodeFormat = (typeof supportedScannerBarcodeFormats)[number];

export type CameraPermissionPlan = 'checking' | 'ready' | 'request' | 'blocked';

export function cameraPermissionPlan(
  permission: { readonly granted: boolean; readonly canAskAgain: boolean } | null,
): CameraPermissionPlan {
  if (!permission) return 'checking';
  if (permission.granted) return 'ready';
  return permission.canAskAgain ? 'request' : 'blocked';
}

export interface SourceAwareBarcodeDiscovery {
  lookupBarcode(barcode: string, signal?: AbortSignal): Promise<readonly BarcodeProviderResult[]>;
  persist(candidate: FoodCandidate): Promise<void>;
}

export interface SourceAwareBarcodeLogger {
  logFood(food: Food, gramWeight: number, occurredAt: ISODateTime): Promise<Meal>;
}

export type BarcodeSourceOutcome =
  | {
      readonly sourceId: FoodSourceId;
      readonly state: 'found';
      readonly candidate: FoodCandidate;
      readonly freshness: FoodResultFreshness;
      readonly matchedBarcode: string;
      readonly issue?: FoodProviderIssue;
    }
  | {
      readonly sourceId: FoodSourceId;
      readonly state: 'empty';
      readonly freshness: FoodResultFreshness;
    }
  | {
      readonly sourceId: FoodSourceId;
      readonly state: 'offline' | 'error' | 'throttled';
      readonly freshness: FoodResultFreshness;
      readonly issue: FoodProviderIssue;
    };

export interface SourceAwareBarcodeResolution {
  readonly barcode: string;
  readonly variants: readonly string[];
  readonly status: 'found' | 'not-found' | 'unavailable';
  readonly sources: readonly BarcodeSourceOutcome[];
}

function normalizedDigits(raw: string): string {
  const normalized = raw.trim().replace(/[\s-]/g, '');
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Barcode must contain digits only.');
  }
  return normalized;
}

export function normalizeRetailBarcode(raw: string, format?: ScannerBarcodeFormat): string {
  const normalized = normalizedDigits(raw);
  const expectedLength = format === 'ean13' ? 13 : format === 'upc_a' ? 12 : 8;
  if (format && normalized.length !== expectedLength) {
    throw new Error(
      `${format === 'ean13' ? 'EAN-13' : format === 'upc_a' ? 'UPC-A' : format === 'upc_e' ? 'UPC-E' : 'EAN-8'} barcodes must contain ${expectedLength} digits.`,
    );
  }
  if (!format && ![8, 12, 13].includes(normalized.length)) {
    throw new Error('Barcode must be an EAN-8, EAN-13, UPC-A, or UPC-E value.');
  }
  return normalized;
}

/** Expand an eight-digit UPC-E (number system + six digits + check digit) to UPC-A. */
export function expandUpcE(raw: string): string {
  const barcode = normalizeRetailBarcode(raw, 'upc_e');
  const [numberSystem, d1, d2, d3, d4, d5, d6, checkDigit] = barcode;
  if (
    numberSystem === undefined ||
    d1 === undefined ||
    d2 === undefined ||
    d3 === undefined ||
    d4 === undefined ||
    d5 === undefined ||
    d6 === undefined ||
    checkDigit === undefined
  ) {
    throw new Error('UPC-E barcode is incomplete.');
  }
  if (d6 === '0' || d6 === '1' || d6 === '2') {
    return `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}${checkDigit}`;
  }
  if (d6 === '3') return `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}${checkDigit}`;
  if (d6 === '4') return `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}${checkDigit}`;
  return `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}${checkDigit}`;
}

export function retailBarcodeVariants(
  raw: string,
  format?: ScannerBarcodeFormat,
): readonly string[] {
  const normalized = normalizeRetailBarcode(raw, format);
  const variants = [normalized];
  if (format === 'upc_e') {
    const expanded = expandUpcE(normalized);
    variants.push(expanded, `0${expanded}`);
  } else if (format === 'upc_a' || (!format && normalized.length === 12)) {
    variants.push(`0${normalized}`);
  } else if ((format === 'ean13' || !format) && normalized.length === 13 && normalized.startsWith('0')) {
    variants.push(normalized.slice(1));
  }
  return [...new Set(variants)];
}

export function scannerBarcodeFormat(value: string): ScannerBarcodeFormat | undefined {
  return supportedScannerBarcodeFormats.find((format) => format === value);
}

function sourceOutcome(result: BarcodeProviderResult, matchedBarcode: string): BarcodeSourceOutcome {
  if (result.result.candidate) {
    return {
      sourceId: result.sourceId,
      state: 'found',
      candidate: result.result.candidate,
      freshness: result.result.freshness,
      matchedBarcode,
      ...(result.result.issue ? { issue: result.result.issue } : {}),
    };
  }
  if (result.result.issue) {
    return {
      sourceId: result.sourceId,
      state: result.result.issue.kind,
      freshness: result.result.freshness,
      issue: result.result.issue,
    };
  }
  return { sourceId: result.sourceId, state: 'empty', freshness: result.result.freshness };
}

function shouldReplaceOutcome(
  current: BarcodeSourceOutcome | undefined,
  next: BarcodeSourceOutcome,
): boolean {
  if (!current) return true;
  if (current.state === 'found') return false;
  if (next.state === 'found') return true;
  if (current.state === 'empty' && next.state !== 'empty') return true;
  return false;
}

export class SourceAwareBarcodeService {
  constructor(
    private readonly discovery: SourceAwareBarcodeDiscovery,
    private readonly logger: SourceAwareBarcodeLogger,
  ) {}

  async lookup(
    raw: string,
    options: { readonly format?: ScannerBarcodeFormat; readonly signal?: AbortSignal } = {},
  ): Promise<SourceAwareBarcodeResolution> {
    const variants = retailBarcodeVariants(raw, options.format);
    const bySource = new Map<FoodSourceId, BarcodeSourceOutcome>();
    const sourceOrder: FoodSourceId[] = [];

    if (options.signal?.aborted) throw new Error('Barcode lookup was cancelled.');
    const resultsByVariant = await Promise.all(
      variants.map(async (variant) => ({
        variant,
        results: await this.discovery.lookupBarcode(variant, options.signal),
      })),
    );

    for (const { variant, results } of resultsByVariant) {
      for (const result of results) {
        if (!bySource.has(result.sourceId)) sourceOrder.push(result.sourceId);
        const next = sourceOutcome(result, variant);
        if (shouldReplaceOutcome(bySource.get(result.sourceId), next)) {
          bySource.set(result.sourceId, next);
        }
      }
    }

    const sources = sourceOrder.flatMap((sourceId) => {
      const outcome = bySource.get(sourceId);
      return outcome ? [outcome] : [];
    });
    const status = sources.some((source) => source.state === 'found')
      ? 'found'
      : sources.length > 0 && sources.every((source) => source.state === 'empty')
        ? 'not-found'
        : 'unavailable';
    return { barcode: variants[0] ?? normalizeRetailBarcode(raw, options.format), variants, status, sources };
  }

  async persistAndLog(
    candidate: FoodCandidate,
    gramWeight: number,
    occurredAt: ISODateTime,
  ): Promise<Meal> {
    if (!Number.isFinite(gramWeight) || gramWeight <= 0) {
      throw new Error('Portion must be greater than zero grams.');
    }
    await this.discovery.persist(candidate);
    return this.logger.logFood(candidate.food, gramWeight, occurredAt);
  }
}

export class BarcodeScanDeduplicator {
  private lastKey: string | null = null;
  private lastAcceptedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs = 1_500,
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isFinite(windowMs) || windowMs < 0) {
      throw new Error('Duplicate suppression window must be nonnegative.');
    }
  }

  accept(raw: string, format?: ScannerBarcodeFormat): boolean {
    const key = `${format ?? 'unknown'}:${normalizeRetailBarcode(raw, format)}`;
    const now = this.clock();
    if (key === this.lastKey && now - this.lastAcceptedAt < this.windowMs) return false;
    this.lastKey = key;
    this.lastAcceptedAt = now;
    return true;
  }

  reset(): void {
    this.lastKey = null;
    this.lastAcceptedAt = Number.NEGATIVE_INFINITY;
  }
}
