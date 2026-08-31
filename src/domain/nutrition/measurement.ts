/**
 * Units a person can enter a portion in, and what it takes to reach grams.
 *
 * Nutrition in MEAT is stored per 100 g and scaled by weight, so every entry
 * path has to end in grams. Mass units get there by exact arithmetic. Volume
 * units cannot get there at all without knowing how heavy the food is per
 * millilitre, and that varies enormously — a fluid ounce of olive oil is 27.4 g,
 * of honey 42.0 g, a 53% difference in every macro.
 *
 * So volume is offered only for foods whose own data yields a density (THI-317).
 * Nothing here assumes 1 ml = 1 g. That assumption is the volumetric equivalent
 * of treating a missing nutrient as zero, which this codebase does not do.
 */

export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type VolumeUnit = 'ml' | 'l' | 'fl-oz' | 'cup' | 'tbsp' | 'tsp';
export type MeasurementUnit = MassUnit | VolumeUnit;

/** Grams in one of each mass unit. Exact by definition of the pound. */
const gramsPerMassUnit: Readonly<Record<MassUnit, number>> = {
  g: 1,
  kg: 1000,
  // The international avoirdupois pound is exactly 0.45359237 kg, and the ounce
  // is a sixteenth of it. Both are exact, not approximations.
  oz: 28.349523125,
  lb: 453.59237,
};

/**
 * Millilitres in one of each volume unit.
 *
 * US customary throughout, because the food data is US: the FDA "legal" cup used
 * on nutrition labels is 240 ml, but USDA portion descriptions use the customary
 * cup of 236.5882365 ml, and the portions are what densities are derived from.
 */
const millilitresPerVolumeUnit: Readonly<Record<VolumeUnit, number>> = {
  ml: 1,
  l: 1000,
  'fl-oz': 29.5735295625,
  cup: 236.5882365,
  tbsp: 14.78676478125,
  tsp: 4.92892159375,
};

export const massUnits = Object.keys(gramsPerMassUnit) as readonly MassUnit[];
export const volumeUnits = Object.keys(millilitresPerVolumeUnit) as readonly VolumeUnit[];

const unitLabels: Readonly<Record<MeasurementUnit, string>> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  l: 'L',
  'fl-oz': 'fl oz',
  cup: 'cup',
  tbsp: 'tbsp',
  tsp: 'tsp',
};

export function measurementUnitLabel(unit: MeasurementUnit): string {
  return unitLabels[unit];
}

export function isMassUnit(unit: MeasurementUnit): unit is MassUnit {
  return unit in gramsPerMassUnit;
}

export function isVolumeUnit(unit: MeasurementUnit): unit is VolumeUnit {
  return unit in millilitresPerVolumeUnit;
}

/** Grams per millilitre for one specific food, derived from its own portions. */
export type Density = number;

/**
 * Converts an amount to grams.
 *
 * Returns `null` rather than guessing when a volume amount is asked for without
 * a density — the caller's job is then to not offer that unit, not to invent a
 * number and carry on.
 */
export function gramsForAmount(
  amount: number,
  unit: MeasurementUnit,
  density?: Density,
): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (isMassUnit(unit)) return amount * gramsPerMassUnit[unit];
  if (density === undefined || !Number.isFinite(density) || density <= 0) return null;
  return amount * millilitresPerVolumeUnit[unit] * density;
}

/** The inverse, for showing a stored gram weight back in the chosen unit. */
export function amountForGrams(
  grams: number,
  unit: MeasurementUnit,
  density?: Density,
): number | null {
  if (!Number.isFinite(grams) || grams < 0) return null;
  if (isMassUnit(unit)) return grams / gramsPerMassUnit[unit];
  if (density === undefined || !Number.isFinite(density) || density <= 0) return null;
  return grams / (millilitresPerVolumeUnit[unit] * density);
}

/**
 * A volume measure recognised inside a portion label.
 *
 * USDA stores the unit in the description text rather than the `measure_unit`
 * column — 36,642 of 37,025 portions say "undetermined" there, while 4,080
 * descriptions read "1 cup" and 1,546 mention fluid ounces. The text is the
 * data, so it has to be read.
 */
const volumePhrases: readonly (readonly [RegExp, VolumeUnit])[] = [
  [/(\d+(?:\.\d+)?)\s*(?:fl\.?\s*oz|fluid\s+ounces?)\b/i, 'fl-oz'],
  [/(\d+(?:\.\d+)?)\s*(?:tbsp|tablespoons?)\b/i, 'tbsp'],
  [/(\d+(?:\.\d+)?)\s*(?:tsp|teaspoons?)\b/i, 'tsp'],
  [/(\d+(?:\.\d+)?)\s*cups?\b/i, 'cup'],
  [/(\d+(?:\.\d+)?)\s*(?:ml|millilit(?:er|re)s?)\b/i, 'ml'],
  [/(\d+(?:\.\d+)?)\s*(?:l|lit(?:er|re)s?)\b/i, 'l'],
];

/** A leading bare fraction or mixed number, as USDA writes "1/2 cup". */
function leadingAmount(label: string): number | null {
  const mixed = /^\s*(\d+)\s+(\d+)\s*\/\s*(\d+)/.exec(label);
  if (mixed?.[1] && mixed[2] && mixed[3]) {
    const whole = Number(mixed[1]);
    const denominator = Number(mixed[3]);
    if (denominator > 0) return whole + Number(mixed[2]) / denominator;
  }
  const fraction = /^\s*(\d+)\s*\/\s*(\d+)/.exec(label);
  if (fraction?.[1] && fraction[2]) {
    const denominator = Number(fraction[2]);
    if (denominator > 0) return Number(fraction[1]) / denominator;
  }
  return null;
}

export interface VolumeMeasure {
  readonly amount: number;
  readonly unit: VolumeUnit;
}

/** Reads "1 cup", "1/2 cup, diced", "8 fl oz" out of a portion label. */
export function volumeMeasureFromLabel(label: string): VolumeMeasure | null {
  for (const [pattern, unit] of volumePhrases) {
    const match = pattern.exec(label);
    if (!match?.[1]) continue;
    // A fraction at the front beats the integer the pattern captured: "1 1/2
    // cups" must not be read as one cup.
    const amount = leadingAmount(label) ?? Number(match[1]);
    if (Number.isFinite(amount) && amount > 0) return { amount, unit };
  }
  return null;
}

export interface DensitySource {
  readonly label: string;
  readonly gramWeight: number;
}

/**
 * Derives grams per millilitre from the food's own portions.
 *
 * Only a portion that states both a volume and a weight can do this, and the
 * result belongs to that one food. A median across every usable portion resists
 * a single mis-keyed record without averaging in obvious outliers.
 */
export function densityFromPortions(portions: readonly DensitySource[]): Density | null {
  const densities: number[] = [];
  for (const portion of portions) {
    if (!Number.isFinite(portion.gramWeight) || portion.gramWeight <= 0) continue;
    const measure = volumeMeasureFromLabel(portion.label);
    if (!measure) continue;
    const millilitres = measure.amount * millilitresPerVolumeUnit[measure.unit];
    if (millilitres <= 0) continue;
    const density = portion.gramWeight / millilitres;
    // Nothing edible is lighter than aerogel or heavier than lead. A value
    // outside this range means the label and the weight describe different
    // things, and averaging it in would poison every conversion.
    if (density >= 0.1 && density <= 2.5) densities.push(density);
  }
  if (!densities.length) return null;
  const sorted = [...densities].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1
    ? sorted[middle]
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
  return median ?? null;
}
