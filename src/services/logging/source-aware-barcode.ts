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

/** Lengths a real retail barcode can have: EAN-8/UPC-E, UPC-A, EAN-13. */
const retailBarcodeLengths: readonly number[] = [8, 12, 13];

const formatNames: Readonly<Record<ScannerBarcodeFormat, string>> = {
  ean8: 'EAN-8',
  ean13: 'EAN-13',
  upc_a: 'UPC-A',
  upc_e: 'UPC-E',
};

function normalizedDigits(raw: string): string {
  const normalized = raw.trim().replace(/[\s-]/g, '');
  if (!/^\d+$/.test(normalized)) {
    throw new Error('Barcode must contain digits only.');
  }
  return normalized;
}

/**
 * Validates the trailing GS1 mod-10 check digit.
 *
 * This gates *camera* scans only. A misread frame still looks like digits, so
 * the check digit is the one cheap signal that separates a real product from a
 * bad read, and firing four provider lookups at a misread is worse than waiting
 * one more frame. Hand-typed barcodes are never gated on it: store-internal and
 * some legitimately mislabelled products carry check digits that do not
 * validate, and a person reading a number off a package is trusted.
 */
export function gs1CheckDigitValid(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 8) return false;
  const expected = Number(digits[digits.length - 1]);
  let sum = 0;
  let weight = 3;
  for (let index = digits.length - 2; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === expected;
}

/**
 * Normalizes a barcode to bare digits.
 *
 * `format` is the symbology a scanner *reported*, and it is advisory only —
 * never a length contract. iOS has no UPC-A metadata type at all: expo-camera
 * maps `upc_a` onto `AVMetadataObject.ObjectType.ean13`, and then strips a
 * leading zero from the payload. Every US grocery item therefore arrives as
 * `{ type: 'ean13', data: <12 digits> }`, and so does any EAN-13 that begins
 * with a zero. Treating the reported format as authoritative rejected both.
 */
export function normalizeRetailBarcode(raw: string, format?: ScannerBarcodeFormat): string {
  const normalized = normalizedDigits(raw);
  if (retailBarcodeLengths.includes(normalized.length)) return normalized;
  throw new Error(
    format
      ? `A ${formatNames[format]} scan produced ${normalized.length} digits, which is not a retail barcode length.`
      : 'Barcode must be an EAN-8, EAN-13, UPC-A, or UPC-E value.',
  );
}

/** Expand an eight-digit UPC-E (number system + six digits + check digit) to UPC-A. */
export function expandUpcE(raw: string): string {
  const barcode = normalizedDigits(raw);
  if (barcode.length !== 8) {
    throw new Error('UPC-E barcodes must contain 8 digits.');
  }
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

/**
 * Every identifier this barcode could be filed under, in preference order.
 *
 * Derived from the digits rather than the reported symbology, because the
 * symbology is unreliable (see `normalizeRetailBarcode`). The same physical
 * product is UPC-A in one database and zero-padded EAN-13 in another, so both
 * are always tried; the scanned digits stay first so the resolution reports
 * back what the user actually scanned.
 */
export function retailBarcodeVariants(
  raw: string,
  format?: ScannerBarcodeFormat,
): readonly string[] {
  const normalized = normalizeRetailBarcode(raw, format);
  const variants = [normalized];

  if (normalized.length === 12) {
    variants.push(`0${normalized}`);
  } else if (normalized.length === 13 && normalized.startsWith('0')) {
    variants.push(normalized.slice(1));
  } else if (normalized.length === 8 && format !== 'ean8') {
    // Eight digits is genuinely ambiguous: EAN-8 stands alone, UPC-E expands.
    // Unless the scanner positively said EAN-8, try the expansion too rather
    // than guess — three cheap parallel lookups beat one confident miss.
    try {
      const expanded = expandUpcE(normalized);
      variants.push(expanded, `0${expanded}`);
    } catch {
      // Not a UPC-E shape, so EAN-8 on its own is the whole answer.
    }
  }

  return [...new Set(variants)];
}

export type ScanRejection = 'unsupported-symbology' | 'not-a-retail-barcode' | 'check-digit';

export type ScannedBarcode =
  | { readonly ok: true; readonly digits: string; readonly format: ScannerBarcodeFormat }
  | { readonly ok: false; readonly reason: ScanRejection };

/**
 * Turns one raw camera event into something safe to look up.
 *
 * Total: a frame the camera cannot make sense of is an ordinary occurrence
 * during scanning, not an error the user caused, so this never throws and the
 * caller never has to guard it.
 */
export function interpretScannedBarcode(data: string, rawType: string): ScannedBarcode {
  const format = scannerBarcodeFormat(rawType);
  if (!format) return { ok: false, reason: 'unsupported-symbology' };

  let digits: string;
  try {
    digits = normalizeRetailBarcode(data, format);
  } catch {
    return { ok: false, reason: 'not-a-retail-barcode' };
  }

  if (!gs1CheckDigitValid(digits)) return { ok: false, reason: 'check-digit' };
  return { ok: true, digits, format };
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

  /**
   * Keyed on the digits alone, and never throws.
   *
   * The format is deliberately not part of the key: iOS reports the same
   * physical barcode under different symbologies from one frame to the next, so
   * including it would let one product through several times. An unusable value
   * is simply not accepted — a camera frame is not a place to raise an error.
   */
  accept(raw: string, format?: ScannerBarcodeFormat): boolean {
    let key: string;
    try {
      key = normalizeRetailBarcode(raw, format);
    } catch {
      return false;
    }
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
