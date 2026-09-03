import assert from 'node:assert/strict';
import test from 'node:test';

import { parseOpenFoodFactsProductResponse } from '../src/data/providers/normalization';
import { servingMeasureFromText } from '../src/data/providers/serving-size-text';
import type { ISODateTime } from '../src/domain/shared/ids';
import { defaultPortionFor } from '../src/ui/food-search-results';
import { defaultAmountForChoice, defaultPortionChoice } from '../src/ui/food-detail-model';

const now = '2026-09-02T00:00:00.000Z' as ISODateTime;

/**
 * Open Food Facts servings (THI-338).
 *
 * Every branded food was opening on a synthesized 100 g. The mapping for the
 * package's own serving existed and looked right — it just required
 * `serving_quantity_unit`, a late addition to the OFF schema that most products
 * predate, and it never read `serving_size`, the field that is almost always
 * populated and usually states the weight outright.
 *
 * The three fixtures that existed all supplied every field, so the shapes that
 * actually come back were the shapes with no test.
 */

function candidateFor(product: Record<string, unknown>) {
  const candidate = parseOpenFoodFactsProductResponse(
    {
      product: {
        code: '5060337502900',
        product_name: 'Test product',
        nutriments: { 'energy-kcal_100g': 400, proteins_100g: 20 },
        ...product,
      },
    },
    now,
  );
  assert.ok(candidate, 'the product should parse');
  return candidate;
}

function servingGrams(product: Record<string, unknown>): number | undefined {
  return candidateFor(product).portions.find((portion) => portion.isDefault)?.gramWeight;
}

// ── The shapes that were falling through to 100 g ──

test('a quantity with no unit is still the serving', () => {
  // `serving_quantity_unit` arrived late in the OFF schema. Requiring it threw
  // away a number that was sitting right there, on a large share of products.
  assert.equal(servingGrams({ serving_size: '30 g', serving_quantity: '30' }), 30);
});

test('the weight is read out of the label text when that is all there is', () => {
  // "1 bar (40 g)" was used as a caption and the 40 discarded.
  assert.equal(servingGrams({ serving_size: '1 bar (40 g)' }), 40);
  assert.equal(servingGrams({ serving_size: '2 cookies (25 g)' }), 25);
  assert.equal(servingGrams({ serving_size: '30 g' }), 30);
});

test('a product that states no serving at all still gets 100 g', () => {
  // The fallback is correct when there is genuinely nothing to read. It was
  // only ever wrong as a substitute for something the product did say.
  assert.equal(servingGrams({}), 100);
  assert.equal(servingGrams({ serving_size: 'about a handful' }), 100);
});

// ── The assumption, and its limits ──

test('millilitres become grams one to one, and say so on the label', () => {
  const candidate = candidateFor({
    serving_size: '250 ml',
    serving_quantity: '250',
    serving_quantity_unit: 'ml',
  });
  const serving = candidate.portions.find((portion) => portion.isDefault);
  assert.equal(serving?.gramWeight, 250);
  // The wording is the product's, so the screen never claims 250 g was stated.
  assert.equal(serving?.label, '250 ml');
});

test('a stated mass always beats a stated volume', () => {
  // "8 fl oz (240 ml)" needs the assumption; "8 fl oz (227 g)" does not, and
  // the grams must win rather than the volume that appears first.
  assert.equal(servingGrams({ serving_size: '8 fl oz (227 g)' }), 227);
});

// ── Reading the label text ──

test('a weight in brackets is the one that means the weight', () => {
  // "1 bar (40 g)": one bar is the count, forty grams is what it weighs.
  assert.deepEqual(servingMeasureFromText('1 bar (40 g)'), { grams: 40 });
  assert.deepEqual(servingMeasureFromText('1/2 cup (120 g)'), { grams: 120 });
});

test('European decimal commas are read as decimals', () => {
  assert.deepEqual(servingMeasureFromText('1,5 g'), { grams: 1.5 });
});

test('ounces and pounds convert exactly, not approximately', () => {
  const measure = servingMeasureFromText('1 oz');
  assert.ok(measure?.grams !== undefined);
  assert.ok(Math.abs(measure.grams - 28.349523125) < 1e-9);
});

test('centilitres and decilitres are read, though the domain has no unit for them', () => {
  assert.deepEqual(servingMeasureFromText('33 cl'), { millilitres: 330 });
  assert.deepEqual(servingMeasureFromText('2 dl'), { millilitres: 200 });
});

test('text with no measurement in it yields none', () => {
  assert.equal(servingMeasureFromText('1 serving'), null);
  assert.equal(servingMeasureFromText(''), null);
  assert.equal(servingMeasureFromText(undefined), null);
});

test('a zero or negative amount is not a serving', () => {
  assert.equal(servingMeasureFromText('0 g'), null);
  assert.equal(servingGrams({ serving_quantity: '0', serving_quantity_unit: 'g' }), 100);
});

// ── What the user actually sees ──

test('the row and the sheet both open on the package serving, not on 100 g', () => {
  const candidate = candidateFor({ serving_size: '1 bar (40 g)' });
  const row = defaultPortionFor(candidate);
  assert.equal(row.gramWeight, 40);

  const choice = defaultPortionChoice(candidate);
  assert.equal(choice.kind, 'serving');
  assert.equal(choice.gramWeight, 40);
  assert.equal(defaultAmountForChoice(choice), 1, 'one serving, not 100 of something');
});

test('a label that already states its weight does not state it twice', () => {
  // Making these servings reachable is what exposed this: the row appends the
  // gram figure, and packaged labels usually carry it already.
  assert.equal(defaultPortionFor(candidateFor({ serving_size: '1 bar (40 g)' })).label, '1 bar (40 g)');
  assert.equal(defaultPortionFor(candidateFor({ serving_size: '30 g' })).label, '30 g');
  assert.equal(defaultPortionFor(candidateFor({ serving_size: '1,5 g' })).label, '1,5 g');
});

test('a manufacturer rounding its own conversion is not a disagreement to display', () => {
  // The label says 28 g for an ounce; the exact conversion is 28.3. Printing
  // "1 oz (28 g) (28.3 g)" would be reporting a conflict that is not there.
  const candidate = candidateFor({
    serving_size: '1 oz (28 g)',
    serving_quantity: '1',
    serving_quantity_unit: 'oz',
  });
  assert.equal(defaultPortionFor(candidate).label, '1 oz (28 g)');
});

test('a volume serving does show the weight we assumed for it', () => {
  // The opposite of the case above: here the label states no grams, and the
  // figure being appended is an assumption, so it belongs on screen.
  const candidate = candidateFor({
    serving_size: '250 ml',
    serving_quantity: '250',
    serving_quantity_unit: 'ml',
  });
  assert.equal(defaultPortionFor(candidate).label, '250 ml (250 g)');
});
