import { gramsForAmount, type MassUnit } from '@/domain/nutrition/measurement';

/**
 * Reads a weight out of a package's own serving-size wording.
 *
 * Open Food Facts states a serving three ways and populates them unevenly.
 * `serving_quantity` is a bare number, `serving_quantity_unit` says what that
 * number is — and is a later addition that many products predate — while
 * `serving_size` is the free text off the label and is the field that is almost
 * always there. That text usually contains the answer in plain sight:
 * "1 bar (40 g)", "2 cookies (25 g)", "8 fl oz (240 ml)".
 *
 * Reading it is not a guess. The grams are stated by the manufacturer; we were
 * simply printing the string as a caption and throwing the number away, then
 * falling back to a synthesized 100 g that nobody weighs out (THI-338).
 */

const massSpellings: Readonly<Record<string, MassUnit>> = {
  g: 'g', gr: 'g', grm: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
};

/**
 * Volume spellings, in millilitres.
 *
 * Kept as millilitres rather than as `VolumeUnit` so that centilitres and
 * decilitres — common on European labels and absent from the domain's unit
 * set — can be read without widening that set for one provider's wording.
 */
const millilitreSpellings: Readonly<Record<string, number>> = {
  ml: 1, milliliter: 1, milliliters: 1, millilitre: 1, millilitres: 1,
  cc: 1,
  cl: 10, centiliter: 10, centiliters: 10, centilitre: 10, centilitres: 10,
  dl: 100, deciliter: 100, deciliters: 100, decilitre: 100, decilitres: 100,
  l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
  floz: 29.5735295625,
  cup: 236.5882365, cups: 236.5882365,
  tbsp: 14.78676478125, tablespoon: 14.78676478125, tablespoons: 14.78676478125,
  tsp: 4.92892159375, teaspoon: 4.92892159375, teaspoons: 4.92892159375,
};

export interface ServingMeasure {
  /** Grams, when the text stated a mass. */
  readonly grams?: number;
  /** Millilitres, when the text stated only a volume. */
  readonly millilitres?: number;
}

interface Match extends ServingMeasure {
  readonly parenthesised: boolean;
}

/** Spans covered by brackets, so a parenthesised weight can be preferred. */
function bracketSpans(text: string): readonly (readonly [number, number])[] {
  const spans: [number, number][] = [];
  const opens: number[] = [];
  [...text].forEach((character, index) => {
    if (character === '(' || character === '[') opens.push(index);
    if (character === ')' || character === ']') {
      const start = opens.pop();
      if (start !== undefined) spans.push([start, index]);
    }
  });
  return spans;
}

/**
 * Normalises the wording before matching.
 *
 * The comma rule is the fiddly one: European labels write "1,5 g" for one and a
 * half grams, and both spellings appear in the same database. A comma between
 * digits with one or two digits after it is a decimal point; anything else is
 * left alone rather than guessed at.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/(\d),(\d{1,2})(?!\d)/g, '$1.$2')
    .replace(/fl\.?\s*oz\.?/g, ' floz ')
    .replace(/\s+/g, ' ');
}

/** "1/2" and "1 1/2" as numbers, since labels write portions that way. */
function fractionValue(whole: string | undefined, numerator: string, denominator: string): number | null {
  const bottom = Number(denominator);
  if (!Number.isFinite(bottom) || bottom === 0) return null;
  const value = Number(numerator) / bottom + (whole ? Number(whole) : 0);
  return Number.isFinite(value) ? value : null;
}

const MEASURE = /(?:(\d+)\s+)?(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*([a-z]+)/g;

function matchesIn(text: string): readonly Match[] {
  const normalised = normalise(text);
  const spans = bracketSpans(normalised);
  const found: Match[] = [];

  for (const match of normalised.matchAll(MEASURE)) {
    const [, whole, lead, denominator, unit = ''] = match;
    if (!lead) continue;
    const amount = denominator
      ? fractionValue(whole, lead, denominator)
      : Number(lead);
    if (amount === null || !Number.isFinite(amount) || amount <= 0) continue;

    const index = match.index ?? 0;
    const parenthesised = spans.some(([start, end]) => index > start && index < end);

    const mass = massSpellings[unit];
    if (mass) {
      const grams = gramsForAmount(amount, mass);
      if (grams !== null) found.push({ grams, parenthesised });
      continue;
    }
    const millilitresPer = millilitreSpellings[unit];
    if (millilitresPer !== undefined) {
      found.push({ millilitres: amount * millilitresPer, parenthesised });
    }
  }

  return found;
}

/**
 * The measure a serving-size string states, or null when it states none.
 *
 * A weight in brackets wins, because that is where a label puts the honest
 * number: "1 bar (40 g)" is one bar, and forty grams is what the bar weighs.
 * A mass anywhere beats a volume anywhere, because a mass needs no assumption
 * to become grams.
 */
export function servingMeasureFromText(text: string | undefined): ServingMeasure | null {
  if (!text) return null;
  const found = matchesIn(text);
  if (!found.length) return null;

  const byPreference =
    found.find((match) => match.grams !== undefined && match.parenthesised) ??
    found.find((match) => match.grams !== undefined) ??
    found.find((match) => match.millilitres !== undefined && match.parenthesised) ??
    found.find((match) => match.millilitres !== undefined);

  if (!byPreference) return null;
  return byPreference.grams !== undefined
    ? { grams: byPreference.grams }
    : { millilitres: byPreference.millilitres as number };
}

/**
 * Grams for a serving that a product only ever stated as a volume.
 *
 * **This assumes one millilitre weighs one gram, which is an assumption and not
 * a fact.** It is right for water, within a few percent for soft drinks and
 * juice, and wrong by half for oil or honey. `measurement.ts` refuses this
 * conversion for exactly that reason, and it is deliberately not relaxed there:
 * the shortcut lives here, at one provider's boundary, so it can be found and
 * removed in one place.
 *
 * Charles chose it over the alternative — showing 100 g, which is not closer to
 * the truth for anything at all — with a proper density-aware conversion
 * tracked as THI-339. Until then the serving keeps its volume wording, so the
 * label on screen says "250 ml" and the assumption is visible rather than
 * silently baked into a gram figure.
 */
export const ASSUMED_GRAMS_PER_MILLILITRE = 1;

export function assumedGramsForMillilitres(millilitres: number): number {
  return millilitres * ASSUMED_GRAMS_PER_MILLILITRE;
}
