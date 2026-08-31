import assert from 'node:assert/strict';
import test from 'node:test';

import {
  amountForGrams,
  densityFromPortions,
  gramsForAmount,
  isMassUnit,
  isVolumeUnit,
  massUnits,
  measurementUnitLabel,
  volumeMeasureFromLabel,
  volumeUnits,
} from '../src/domain/nutrition/measurement';

test('mass units convert exactly, because their definitions are exact', () => {
  // The avoirdupois pound is defined as exactly 0.45359237 kg; the ounce is a
  // sixteenth of it. These are not measured approximations.
  assert.equal(gramsForAmount(1, 'g'), 1);
  assert.equal(gramsForAmount(1, 'kg'), 1000);
  assert.equal(gramsForAmount(1, 'lb'), 453.59237);
  assert.equal(gramsForAmount(16, 'oz'), 453.59237);
  assert.equal(gramsForAmount(4, 'oz'), 113.3980925);

  // A round trip through a unit has to land back on the same weight.
  const grams = gramsForAmount(6.5, 'oz') as number;
  assert.ok(Math.abs((amountForGrams(grams, 'oz') as number) - 6.5) < 1e-12);
});

test('a volume amount without a density resolves to nothing, not to a guess', () => {
  // This is the whole point. 1 fl oz of water is 29.6 g, of olive oil 27.0 g,
  // of honey 42.0 g. Picking one silently would be wrong for most foods.
  assert.equal(gramsForAmount(1, 'fl-oz'), null);
  assert.equal(gramsForAmount(1, 'cup'), null);
  assert.equal(amountForGrams(240, 'cup'), null);
  assert.equal(gramsForAmount(1, 'cup', 0), null);
  assert.equal(gramsForAmount(1, 'cup', Number.POSITIVE_INFINITY), null);
});

test('a volume amount with a density converts, and the density belongs to the food', () => {
  // Whole milk: USDA gives "1 cup" = 244 g, so 1.0313 g/ml.
  const milk = 244 / 236.5882365;
  assert.ok(Math.abs((gramsForAmount(1, 'cup', milk) as number) - 244) < 1e-9);
  assert.ok(Math.abs((gramsForAmount(8, 'fl-oz', milk) as number) - 244) < 1e-9);

  // Olive oil: USDA gives "1 tablespoon" = 13.5 g, so 0.913 g/ml. The same
  // fluid ounce that is 30.5 g of milk is 27.0 g of oil.
  const oil = 13.5 / 14.78676478125;
  assert.ok(Math.abs((gramsForAmount(1, 'fl-oz', oil) as number) - 27.0) < 0.05);
  assert.ok(Math.abs((gramsForAmount(1, 'fl-oz', milk) as number) - 30.5) < 0.05);
});

test('rejects amounts that are not amounts', () => {
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(gramsForAmount(bad, 'g'), null);
  }
  assert.equal(amountForGrams(-1, 'g'), null);
});

test('volume measures are read out of the portion label, where USDA keeps them', () => {
  // The `measure_unit` column says "undetermined" for 36,642 of 37,025 portions.
  // The description is where the unit actually lives.
  assert.deepEqual(volumeMeasureFromLabel('1 cup'), { amount: 1, unit: 'cup' });
  assert.deepEqual(volumeMeasureFromLabel('1 cup, diced'), { amount: 1, unit: 'cup' });
  assert.deepEqual(volumeMeasureFromLabel('8 fl oz'), { amount: 8, unit: 'fl-oz' });
  assert.deepEqual(volumeMeasureFromLabel('8 fluid ounces'), { amount: 8, unit: 'fl-oz' });
  assert.deepEqual(volumeMeasureFromLabel('1 tablespoon'), { amount: 1, unit: 'tbsp' });
  assert.deepEqual(volumeMeasureFromLabel('2 tsp'), { amount: 2, unit: 'tsp' });
  assert.deepEqual(volumeMeasureFromLabel('330 ml'), { amount: 330, unit: 'ml' });

  // Fractions are how USDA writes half a cup, and a mixed number must not read
  // as its whole part.
  assert.deepEqual(volumeMeasureFromLabel('1/2 cup'), { amount: 0.5, unit: 'cup' });
  assert.deepEqual(volumeMeasureFromLabel('1 1/2 cups'), { amount: 1.5, unit: 'cup' });

  // A weight or a count is not a volume.
  assert.equal(volumeMeasureFromLabel('1 medium breast'), null);
  assert.equal(volumeMeasureFromLabel('140 g'), null);
  assert.equal(volumeMeasureFromLabel('1 oz'), null);
});

test('density comes from the food, and is the median of what the food says', () => {
  // Milk described two ways agrees with itself.
  const milk = densityFromPortions([
    { label: '1 cup', gramWeight: 244 },
    { label: '8 fl oz', gramWeight: 244 },
    { label: '1 tablespoon', gramWeight: 15.3 },
  ]);
  assert.ok(milk !== null && Math.abs(milk - 1.031) < 0.01);

  // A food with nothing volumetric to say gets no density, so volume units are
  // simply not offered for it.
  assert.equal(
    densityFromPortions([
      { label: '1 medium breast', gramWeight: 140 },
      { label: '100 g', gramWeight: 100 },
    ]),
    null,
  );
  assert.equal(densityFromPortions([]), null);
});

test('a portion whose label and weight disagree is discarded, not averaged in', () => {
  // "1 cup = 5 g" describes a cup of something and the weight of something else.
  // Letting it into the average would skew every conversion for the food.
  const density = densityFromPortions([
    { label: '1 cup', gramWeight: 240 },
    { label: '1 cup', gramWeight: 5 },
    { label: '1 cup', gramWeight: 242 },
  ]);
  assert.ok(density !== null && Math.abs(density - 1.017) < 0.01);

  // Everything out of range leaves no density at all rather than a bad one.
  assert.equal(densityFromPortions([{ label: '1 cup', gramWeight: 0.5 }]), null);
  assert.equal(densityFromPortions([{ label: '1 cup', gramWeight: 5000 }]), null);
  assert.equal(densityFromPortions([{ label: '1 cup', gramWeight: 0 }]), null);
});

test('the unit vocabulary is coherent', () => {
  assert.deepEqual([...massUnits], ['g', 'kg', 'oz', 'lb']);
  assert.deepEqual([...volumeUnits], ['ml', 'l', 'fl-oz', 'cup', 'tbsp', 'tsp']);
  for (const unit of massUnits) {
    assert.equal(isMassUnit(unit), true);
    assert.equal(isVolumeUnit(unit), false);
  }
  for (const unit of volumeUnits) {
    assert.equal(isVolumeUnit(unit), true);
    assert.equal(isMassUnit(unit), false);
  }
  assert.equal(measurementUnitLabel('fl-oz'), 'fl oz');
  assert.equal(measurementUnitLabel('l'), 'L');
});
