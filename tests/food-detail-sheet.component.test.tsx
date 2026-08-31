import { fireEvent, render } from '@testing-library/react-native';

import type { Food, FoodCandidate } from '../src/domain';
import type { FoodId, FoodServingId, ISODateTime, SourceRecordId } from '../src/domain/shared/ids';
import { FoodDetailSheet } from '../src/ui/components/food-detail-sheet';
import type { DayStanding } from '../src/ui/food-detail-model';

const now = '2026-08-31T12:00:00.000Z' as ISODateTime;
const id = 'usda-core:5062' as FoodId;
const breast = 'usda-core:5062:breast' as FoodServingId;

const food: Food = {
  id,
  kind: 'generic',
  name: 'Chicken breast, roasted',
  nutrition: {
    basisGrams: 100,
    nutrients: [
      { nutrient: { code: 'protein-g', name: 'Protein', unit: 'g' }, state: 'known', value: 31 },
      { nutrient: { code: 'energy-kcal', name: 'Energy', unit: 'kcal' }, state: 'known', value: 165 },
      { nutrient: { code: 'fiber-g', name: 'Fiber', unit: 'g' }, state: 'unknown' },
    ],
  },
  servings: [
    { id: breast, foodId: id, label: '1 medium breast', quantity: 1, unit: 'serving', gramWeight: 140 },
  ],
  createdAt: now,
  updatedAt: now,
};

const candidate: FoodCandidate = {
  ref: { sourceId: 'usda-core', recordId: '5062' as SourceRecordId },
  food,
  portions: [
    { id: breast, label: '1 medium breast', quantity: 1, unit: 'serving', gramWeight: 140, isDefault: true },
  ],
  provenance: { provider: 'usda-core', recordId: '5062' as SourceRecordId },
};

const standings: readonly DayStanding[] = [
  { code: 'protein-g', current: 96, target: { mode: 'minimum', minimum: 180 } },
  { code: 'energy-kcal', current: 810, target: { mode: 'maximum', maximum: 1840 } },
  { code: 'fiber-g', current: 8, target: null },
];

function sheet(overrides: Partial<React.ComponentProps<typeof FoodDetailSheet>> = {}) {
  return (
    <FoodDetailSheet
      candidate={candidate}
      sourceLabel="USDA"
      favorite={false}
      standings={standings}
      pendingCount={2}
      busy={false}
      onClose={() => undefined}
      onToggleFavorite={() => undefined}
      onAdd={() => undefined}
      onLogAll={() => undefined}
      {...overrides}
    />
  );
}

// A Modal commits its contents a tick after mount, so every query here is a
// `find*`: the synchronous variants race the modal and see an empty tree.
describe('food detail sheet', () => {
  it('leads with protein and never renders an unknown nutrient as zero', async () => {
    const view = await render(sheet());
    expect(await view.findByText('43.4')).toBeTruthy();  // protein in one breast
    expect(await view.findByText('231')).toBeTruthy();   // calories
    expect((await view.findAllByText('—')).length).toBeGreaterThan(0);
    expect(await view.findByText('1 medium breast · 140 g · USDA')).toBeTruthy();
  });

  it('sends a real quantity, so two breasts is one action', async () => {
    const added: { gramWeight: number; quantity: number; servingId: string | undefined }[] = [];
    const view = await render(sheet({ onAdd: (_candidate, portion) => added.push(portion) }));

    fireEvent.changeText(await view.findByLabelText('Amount'), '2');
    fireEvent.press(await view.findByText('Add to event'));

    // The serving reference survives alongside the count, which is what lets the
    // timeline say "2 medium breasts" rather than "280 g".
    expect(added).toEqual([{ gramWeight: 280, quantity: 2, servingId: breast }]);
  });

  it('refuses to add a portion of zero and says why', async () => {
    const added: unknown[] = [];
    const view = await render(sheet({ onAdd: () => added.push(true) }));

    fireEvent.changeText(await view.findByLabelText('Amount'), '0');
    fireEvent.press(await view.findByText('Add to event'));

    expect(added).toEqual([]);
    expect(
      await view.findByText('Enter an amount greater than zero.'),
    ).toBeTruthy();
  });

  it('shows a protein minimum and a calorie cap as different readings', async () => {
    const view = await render(sheet());
    // A floor to clear...
    expect(await view.findByText('139.4 of 180 g minimum')).toBeTruthy();
    // ...and a ceiling not to cross are not the same sentence.
    expect(await view.findByText('1041 of 1840 kcal limit')).toBeTruthy();
    // A nutrient with no target says so rather than claiming zero percent.
    expect((await view.findAllByText('No target set')).length).toBeGreaterThan(0);
  });

  it('keeps both stages reachable while the sheet is open', async () => {
    let logged = 0;
    const view = await render(sheet({ onLogAll: () => { logged += 1; } }));
    // Add commits the food; Log commits the event. Both stay visible, so the
    // two-stage model is legible rather than inferred from a disabled button.
    expect(await view.findByText('Add to event')).toBeTruthy();
    fireEvent.press(await view.findByText('Log 2 foods'));
    expect(logged).toBe(1);
  });

  it('opens on the package serving rather than a synthesized 100 g', async () => {
    const view = await render(sheet());
    // The scanned or looked-up product should start where the label starts.
    expect(await view.findByText('1 medium breast · 140 g · USDA')).toBeTruthy();
  });

  it('measures in ounces when Settings asks for ounces', async () => {
    const added: { gramWeight: number; quantity: number; servingId: string | undefined }[] = [];
    const view = await render(
      sheet({ preferredMassUnit: 'oz', onAdd: (_candidate, portion) => added.push(portion) }),
    );

    fireEvent.press(await view.findByLabelText('Measure in oz'));
    fireEvent.changeText(await view.findByLabelText('Amount'), '6');
    fireEvent.press(await view.findByText('Add to event'));

    // Six ounces is 170.097 g exactly, and a typed weight is not a serving.
    expect(added).toHaveLength(1);
    expect(added[0]?.servingId).toBeUndefined();
    expect(added[0]?.gramWeight).toBeCloseTo(170.0971, 3);
  });

  it('offers volume only to a food whose own data says what it weighs', async () => {
    // This food names no volume portion, so no density can be derived for it
    // and fluid ounces would have to be invented.
    const view = await render(sheet());
    expect(await view.findByLabelText('Measure in g')).toBeTruthy();
    expect(view.queryByLabelText('Measure in fl oz')).toBeNull();

    // Give it a cup measure and the same food becomes measurable by volume.
    const withCup: FoodCandidate = {
      ...candidate,
      portions: [
        ...candidate.portions,
        { id: 'usda-core:5062:cup' as FoodServingId, label: '1 cup, diced', quantity: 1, unit: 'serving', gramWeight: 135 },
      ],
    };
    const volumetric = await render(sheet({ candidate: withCup }));
    expect(await volumetric.findByLabelText('Measure in fl oz')).toBeTruthy();
  });

  it('re-anchors the amount when the unit changes', async () => {
    const added: { gramWeight: number }[] = [];
    const view = await render(sheet({ onAdd: (_candidate, portion) => added.push(portion) }));

    // Opens on one breast, 140 g.
    fireEvent.press(await view.findByLabelText('Measure in g'));
    fireEvent.press(await view.findByText('Add to event'));

    // Switching to grams must not carry "1" over and log a single gram.
    expect(added[0]?.gramWeight).toBe(100);
  });

  it('closes back to the results without committing anything', async () => {
    let closed = 0;
    const view = await render(sheet({ onClose: () => { closed += 1; } }));
    fireEvent.press(await view.findByLabelText('Back to results'));
    expect(closed).toBe(1);
  });
});
