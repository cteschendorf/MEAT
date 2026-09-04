/**
 * The one button that ends a meal, and what it is allowed to say.
 *
 * The composer's save button used to sit disabled with no explanation
 * (THI-315): nothing on screen said that a meal needs a food in it, so the
 * only way to find out was to press a button that did not respond. A control
 * that refuses without saying why teaches nothing, and looks broken.
 *
 * So a disabled state here always carries a reason, and the label always
 * carries the count — the staged foods ride on the button rather than living
 * in a separate list the user has to go and check.
 */
export interface CommitAction {
  readonly label: string;
  /** Why it cannot be pressed, or null when it can. Never silently disabled. */
  readonly hint: string | null;
  readonly disabled: boolean;
  readonly accessibilityLabel: string;
}

export interface CommitState {
  /** Foods added to the draft and not yet written. */
  readonly stagedCount: number;
  /** True while the save is in flight. */
  readonly saving: boolean;
  /** True when this is an edit of an event already on the timeline. */
  readonly editing: boolean;
  /** True while some other write holds the lock. */
  readonly busy: boolean;
}

export function commitAction(state: CommitState): CommitAction {
  if (state.saving) {
    return {
      label: 'Saving…',
      hint: null,
      disabled: true,
      accessibilityLabel: 'Saving this meal event.',
    };
  }

  const verb = state.editing ? 'Save' : 'Log';

  if (state.stagedCount === 0) {
    // The empty case is the one THI-315 was about. The button still names the
    // action it would perform, so the row does not change shape when the first
    // food lands — only the count appears.
    return {
      label: state.editing ? 'Save changes' : `${verb} foods`,
      hint: 'Add a food first — search for one, scan a barcode, or pick one from your library.',
      disabled: true,
      accessibilityLabel: `${verb} foods. Unavailable until this meal has at least one food.`,
    };
  }

  const foods = `${state.stagedCount} food${state.stagedCount === 1 ? '' : 's'}`;
  const label = state.editing ? `Save ${foods}` : `${verb} ${foods}`;
  return {
    label,
    hint: null,
    disabled: state.busy,
    accessibilityLabel: `${label} to your timeline.`,
  };
}
