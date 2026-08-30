export type ExclusiveActionResult<T> =
  | { readonly started: true; readonly value: T }
  | { readonly started: false };

/**
 * Synchronous admission control for UI actions that must not overlap.
 * The guard flips before the action reaches its first await, so two taps from
 * the same render cannot both start a write.
 */
export class ExclusiveActionGate {
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  async run<T>(action: () => Promise<T>): Promise<ExclusiveActionResult<T>> {
    if (this.active) return { started: false };
    this.active = true;
    try {
      return { started: true, value: await action() };
    } finally {
      this.active = false;
    }
  }
}

/** Only the most recently started read may commit its result. */
export class LatestRequestGate {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(requestGeneration: number): boolean {
    return requestGeneration === this.generation;
  }
}
