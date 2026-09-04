import { fireEvent, render } from '@testing-library/react-native';

import type { FoodResultRow } from '../src/ui/food-search-results';
import { FoodResultRowItem } from '../src/ui/components/food-result-row';

const row: FoodResultRow = {
  key: 'usda-core:1',
  candidate: {} as FoodResultRow['candidate'],
  name: 'Chicken breast, roasted',
  nameSegments: [
    { text: 'Chicken', matched: true },
    { text: ' breast, roasted', matched: false },
  ],
  metrics: [
    { code: 'protein-g', label: 'P', text: '43.4', known: true },
    { code: 'energy-kcal', label: 'kcal', text: '231', known: true },
    { code: 'carbohydrate-g', label: 'C', text: '0', known: true },
    { code: 'fat-g', label: 'F', text: '5', known: true },
    { code: 'fiber-g', label: 'fiber', text: '—', known: false },
  ],
  portionLabel: '1 medium breast (140 g)',
  sourceLabel: 'USDA',
  favorite: false,
  gramWeight: 140,
};

describe('unified search result row', () => {
  it('shows all five metrics protein first, with unknown as a dash', async () => {
    const view = await render(
      <FoodResultRowItem row={row} onAdd={() => undefined} onRefine={() => undefined} />,
    );

    expect(view.getByText('43.4 P')).toBeTruthy();
    expect(view.getByText('231 kcal')).toBeTruthy();
    // Missing fiber must never read as zero.
    expect(view.getByText('— fiber')).toBeTruthy();
  });

  it('names its source and leads the portion with the household measure', async () => {
    const view = await render(
      <FoodResultRowItem row={row} onAdd={() => undefined} onRefine={() => undefined} />,
    );
    // The portion and the source now share the metrics line rather than having
    // one of their own (THI-313's row anatomy), so this asserts the two facts
    // are there rather than the exact string that once held them.
    expect(view.getByText(/1 medium breast \(140 g\)/)).toBeTruthy();
    expect(view.getByText(/USDA/)).toBeTruthy();
  });

  it('adds at the default portion without a detour through the editor', async () => {
    const added: FoodResultRow[] = [];
    const view = await render(
      <FoodResultRowItem row={row} onAdd={(value) => added.push(value)} onRefine={() => undefined} />,
    );

    fireEvent.press(view.getByLabelText('Add Chicken breast, roasted, 1 medium breast (140 g)'));
    expect(added).toHaveLength(1);
  });

  it('opens portion refinement when the row itself is tapped', async () => {
    const refined: FoodResultRow[] = [];
    const view = await render(
      <FoodResultRowItem row={row} onAdd={() => undefined} onRefine={(value) => refined.push(value)} />,
    );

    fireEvent.press(
      view.getByLabelText(
        'Chicken breast, roasted. 43.4 P, 231 kcal, 0 C, 5 F, — fiber. 1 medium breast (140 g). USDA.',
      ),
    );
    expect(refined).toHaveLength(1);
  });
});
