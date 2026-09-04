import { act, cleanup, fireEvent, render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { ComposerFooter } from '../src/ui/components/composer-footer';
import { ComposerTabBar } from '../src/ui/components/composer-tab-bar';
import { commitAction } from '../src/ui/composer/commit-action';
import type { EntryTabId } from '../src/ui/composer/entry-tabs';

/**
 * The two controls that are on screen in every mode (THI-328).
 *
 * These render without a draft, services or a router, which is the point: the
 * tab row and the commit button are properties of the sheet, so neither should
 * need a composer to exist.
 */

const idle = { stagedCount: 0, saving: false, editing: false, busy: false };

afterEach(() => {
  cleanup();
});

/**
 * `mount` and `press` both wrap their work in `act`.
 *
 * Without that, an unflushed update from an earlier test leaves the next mount
 * committing nothing, so it queries an empty tree and passes vacuously. The
 * symptom is a suite that only passes in one order, which is not evidence of
 * anything.
 */
async function press(element: Parameters<typeof fireEvent.press>[0]): Promise<void> {
  await act(async () => {
    fireEvent.press(element);
  });
}

async function mount(element: ReactElement): Promise<RenderResult> {
  let result: RenderResult | null = null;
  await act(async () => {
    result = render(element);
  });
  if (!result) throw new Error('render produced nothing');
  return result;
}

describe('composer tab bar', () => {
  it('offers all five ways into a meal', async () => {
    const screen = await mount(<ComposerTabBar active="search" onSelect={() => {}} />);
    for (const title of ['Scan', 'Search', 'AI', 'Quick Add', 'Library']) {
      expect(screen.getByText(title)).toBeTruthy();
    }
  });

  it('marks exactly one tab selected', async () => {
    const screen = await mount(<ComposerTabBar active="library" onSelect={() => {}} />);
    const selected = screen
      .getAllByRole('tab')
      .filter((tab) => tab.props.accessibilityState?.selected === true);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.props.accessibilityLabel).toBe('Your foods, saved meals and recipes');
  });

  it('a tab with no feature behind it is still pressable, and says so', async () => {
    // Disabling it would leave the user with a control that refuses and no
    // explanation. The mode below the row is where the explanation belongs.
    const chosen: EntryTabId[] = [];
    const screen = await mount(<ComposerTabBar active="search" onSelect={(id) => chosen.push(id)} />);
    const ai = screen.getByLabelText('Describe a meal in your own words');

    expect(ai.props.accessibilityState?.disabled).toBeFalsy();
    expect(ai.props.accessibilityHint).toContain('not built yet');

    await press(ai);
    expect(chosen).toEqual(['ai']);
  });

  it('switching tabs is never blocked by a write in flight', async () => {
    // The draft belongs to the sheet, not to a mode, so a save running is no
    // reason to freeze the row — and a frozen row reads as a broken app.
    const chosen: EntryTabId[] = [];
    const screen = await mount(<ComposerTabBar active="search" onSelect={(id) => chosen.push(id)} />);
    await press(screen.getByLabelText('Scan a barcode'));
    await press(screen.getByLabelText('Your foods, saved meals and recipes'));
    expect(chosen).toEqual(['scan', 'library']);
  });
});

describe('composer footer', () => {
  it('a refusing button says why', async () => {
    const screen = await mount(
      <ComposerFooter commit={commitAction(idle)} onCommit={() => {}} />,
    );
    expect(screen.getByText(/Add a food first/)).toBeTruthy();
  });

  it('the hint disappears once the meal has something in it', async () => {
    const screen = await mount(
      <ComposerFooter commit={commitAction({ ...idle, stagedCount: 2 })} onCommit={() => {}} />,
    );
    expect(screen.queryByText(/Add a food first/)).toBeNull();
    expect(screen.getByText('Log 2 foods')).toBeTruthy();
  });

  it('an empty meal cannot be committed by pressing anyway', async () => {
    let pressed = 0;
    const screen = await mount(
      <ComposerFooter commit={commitAction(idle)} onCommit={() => { pressed += 1; }} />,
    );
    await press(screen.getByText('Log foods'));
    expect(pressed).toBe(0);
  });

  it('a meal with foods commits on one press', async () => {
    let pressed = 0;
    const screen = await mount(
      <ComposerFooter
        commit={commitAction({ ...idle, stagedCount: 1 })}
        onCommit={() => { pressed += 1; }}
      />,
    );
    await press(screen.getByText('Log 1 food'));
    expect(pressed).toBe(1);
  });

  it('the status line is announced rather than left to be noticed', async () => {
    const screen = await mount(
      <ComposerFooter
        commit={commitAction({ ...idle, stagedCount: 1 })}
        onCommit={() => {}}
        message="Chicken breast added. Add another food or confirm the event."
      />,
    );
    const line = screen.getByText(/Chicken breast added/);
    expect(line.props.accessibilityLiveRegion).toBe('polite');
  });
});
