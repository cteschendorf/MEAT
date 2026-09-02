import { useCallback, useState } from 'react';

import { ExclusiveActionGate } from '@/services/actions/exclusive-action';

/**
 * The composer's one status line and one gate.
 *
 * Every handler in the composer reports through the same sentence and blocks
 * on the same lock, so they share this rather than each keeping a copy. That
 * sharing is not incidental coupling to be designed away — two meal writes
 * running at once is the thing the gate exists to prevent, and it can only do
 * that if there is exactly one of it (THI-316).
 */
export interface ComposerStatus {
  /** The sentence under the composer, or null when there is nothing to say. */
  readonly message: string | null;
  readonly setMessage: (next: string | null) => void;
  /** The name of the action in flight, which is what disables the buttons. */
  readonly busyAction: string | null;
  readonly busy: boolean;
  readonly gate: ExclusiveActionGate;
  /** True while a write holds the lock; a caller should decline rather than queue. */
  readonly locked: boolean;
  readonly runAction: (name: string, action: () => Promise<void>) => Promise<void>;
}

export function useComposerStatus(): ComposerStatus {
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [gate] = useState(() => new ExclusiveActionGate());

  const runAction = useCallback(
    async (name: string, action: () => Promise<void>): Promise<void> => {
      await gate.run(async () => {
        setBusyAction(name);
        setMessage(null);
        try {
          await action();
        } finally {
          setBusyAction(null);
        }
      });
    },
    [gate],
  );

  return {
    message,
    setMessage,
    busyAction,
    busy: busyAction !== null,
    gate,
    locked: gate.isActive,
    runAction,
  };
}
