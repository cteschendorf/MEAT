/**
 * Holds a single navigation action until the mutation protecting the current
 * route has released it. Keeping this tiny state machine outside React makes
 * the important exactly-once behavior deterministic and easy to test.
 */
export class DeferredRouteExit {
  private pending: (() => void) | null = null;

  get hasPending(): boolean {
    return this.pending !== null;
  }

  queue(action: () => void): boolean {
    if (this.pending) return false;
    this.pending = action;
    return true;
  }

  flush(blocked: boolean): boolean {
    if (blocked || !this.pending) return false;
    const action = this.pending;
    this.pending = null;
    action();
    return true;
  }

  clear(): void {
    this.pending = null;
  }
}
