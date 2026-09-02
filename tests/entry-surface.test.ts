import assert from 'node:assert/strict';
import test from 'node:test';

import { commitAction } from '../src/ui/composer/commit-action';
import {
  defaultEntryTab,
  entryTab,
  entryTabs,
  isEntryTabReady,
} from '../src/ui/composer/entry-tabs';
import { preSearchSections } from '../src/ui/composer/pre-search-sections';

// ── The tab row ──

test('the five ways into a meal are peers, in the order the row reads', () => {
  assert.deepEqual(entryTabs.map((tab) => tab.id), [
    'scan', 'search', 'ai', 'quick-add', 'library',
  ]);
});

test('the sheet opens on Search, because most foods are found by name', () => {
  assert.equal(defaultEntryTab, 'search');
  assert.ok(isEntryTabReady(defaultEntryTab));
});

test('a tab whose feature has not shipped stays in the row and says so', () => {
  // Hiding it would make the row's width depend on which features exist, and a
  // row that changes shape between builds is harder to learn than an honest one.
  const ai = entryTab('ai');
  assert.equal(isEntryTabReady('ai'), false);
  assert.equal(ai.pending?.title, 'Not built yet');
  assert.ok(ai.pending?.message.includes('this device'), 'it should say where the work happens');
});

test('every tab has a spoken label, because five short words are not self-explaining', () => {
  for (const tab of entryTabs) {
    assert.ok(tab.accessibilityLabel.length > tab.title.length, `${tab.id} needs a fuller label`);
  }
});

test('titles stay short enough for five to share one row', () => {
  for (const tab of entryTabs) {
    assert.ok(tab.title.length <= 9, `${tab.title} is too long for the row`);
  }
});

// ── The commit button ──

const idle = { stagedCount: 0, saving: false, editing: false, busy: false };

test('an empty meal explains itself instead of sitting silently dead', () => {
  // The whole of THI-315: the button used to refuse with no reason given, so
  // the only way to learn the rule was to press something that did not respond.
  const action = commitAction(idle);
  assert.equal(action.disabled, true);
  assert.equal(action.label, 'Log foods');
  assert.ok(action.hint?.includes('Add a food first'));
});

test('the staged count rides on the button', () => {
  assert.equal(commitAction({ ...idle, stagedCount: 1 }).label, 'Log 1 food');
  assert.equal(commitAction({ ...idle, stagedCount: 3 }).label, 'Log 3 foods');
});

test('editing an existing event says Save, not Log', () => {
  assert.equal(commitAction({ ...idle, editing: true }).label, 'Save changes');
  assert.equal(commitAction({ ...idle, editing: true, stagedCount: 2 }).label, 'Save 2 foods');
});

test('a button that can be pressed carries no hint', () => {
  const action = commitAction({ ...idle, stagedCount: 2 });
  assert.equal(action.disabled, false);
  assert.equal(action.hint, null);
});

test('saving takes over the label and stops a second press', () => {
  const action = commitAction({ ...idle, stagedCount: 2, saving: true });
  assert.equal(action.label, 'Saving…');
  assert.equal(action.disabled, true);
});

test('another write in flight disables it without changing what it says', () => {
  // The label is a promise about what pressing does. It should not flicker
  // just because a photo is uploading.
  const action = commitAction({ ...idle, stagedCount: 2, busy: true });
  assert.equal(action.label, 'Log 2 foods');
  assert.equal(action.disabled, true);
});

test('the spoken label says where the foods are going', () => {
  assert.equal(
    commitAction({ ...idle, stagedCount: 2 }).accessibilityLabel,
    'Log 2 foods to your timeline.',
  );
  assert.ok(
    commitAction(idle).accessibilityLabel.includes('at least one food'),
    'a disabled control must speak its reason too',
  );
});

// ── What shows before anyone types ──

function at(hour: number): Date {
  return new Date(2026, 8, 1, hour, 0, 0);
}

test('the picks heading names the ranking behind it, not the clock', () => {
  // "7 AM Picks" changes every hour and explains nothing. The suggestions are
  // ranked by time-of-day context, so the heading names that instead.
  assert.equal(preSearchSections(at(7)).picksTitle, 'Morning picks');
  assert.equal(preSearchSections(at(12)).picksTitle, 'Midday picks');
  assert.equal(preSearchSections(at(19)).picksTitle, 'Evening picks');
  assert.equal(preSearchSections(at(2)).picksTitle, 'Late picks');
});

test('the heading holds still for the length of a meal', () => {
  assert.equal(preSearchSections(at(7)).picksTitle, preSearchSections(at(10)).picksTitle);
  assert.equal(preSearchSections(at(19)).picksTitle, preSearchSections(at(21)).picksTitle);
});

test('the hour suggests a meal name without asserting one', () => {
  assert.equal(preSearchSections(at(7)).suggestedMealName, 'Breakfast');
  assert.equal(preSearchSections(at(12)).suggestedMealName, 'Lunch');
  assert.equal(preSearchSections(at(19)).suggestedMealName, 'Dinner');
  // Someone eating dinner at 3am has not eaten a snack — which is exactly why
  // this is offered as a highlighted chip and never written on its own.
  assert.equal(preSearchSections(at(3)).suggestedMealName, 'Snack');
});
