export type PrivateDataGeneration = number;

export type PrivateDataWriteRejectionReason =
  | 'purge-in-progress'
  | 'stale-generation';

/**
 * Raised before a private write starts when a reset owns the application-wide
 * write boundary or when the caller belongs to a draft created before reset.
 */
export class PrivateDataWriteRejectedError extends Error {
  constructor(readonly reason: PrivateDataWriteRejectionReason) {
    super(
      reason === 'purge-in-progress'
        ? 'Private data is being deleted. This change was not saved.'
        : 'This meal draft expired when private data was deleted.',
    );
    this.name = 'PrivateDataWriteRejectedError';
  }
}

type PurgeOperation = (markDatabasePurged: () => void) => Promise<void>;

/**
 * A small FIFO write/reset barrier for private data.
 *
 * Writes accepted before reset finish first. A purge becomes pending
 * synchronously, rejects every later lease request, and then owns the boundary
 * until filesystem cleanup finishes. The generation advances at the
 * irreversible database commit so stale composer closures stay invalid even if
 * later file cleanup rejects.
 */
export class PrivateDataWriteCoordinator {
  private generationValue = 0;
  private purgePending = false;
  private purgePromise: Promise<void> | null = null;
  private writeTail: Promise<void> = Promise.resolve();

  get generation(): PrivateDataGeneration {
    return this.generationValue;
  }

  assertWriteAllowed(expectedGeneration?: PrivateDataGeneration): void {
    if (this.purgePending) {
      throw new PrivateDataWriteRejectedError('purge-in-progress');
    }
    if (expectedGeneration !== undefined && expectedGeneration !== this.generationValue) {
      throw new PrivateDataWriteRejectedError('stale-generation');
    }
  }

  runWrite<T>(
    operation: () => Promise<T>,
    expectedGeneration?: PrivateDataGeneration,
  ): Promise<T> {
    try {
      this.assertWriteAllowed(expectedGeneration);
    } catch (error) {
      return Promise.reject(error);
    }

    const result = this.writeTail.then(operation);
    this.writeTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  runPurge(operation: PurgeOperation): Promise<void> {
    if (this.purgePromise) return this.purgePromise;

    // This assignment intentionally precedes the first await: callers cannot
    // slip a new private write behind a reset that has already been requested.
    this.purgePending = true;
    const nextGeneration = this.generationValue + 1;
    const pending = this.writeTail.then(async () => {
      let markedPurged = false;
      await operation(() => {
        if (markedPurged) return;
        markedPurged = true;
        this.generationValue = nextGeneration;
      });
    }).finally(() => {
      this.purgePending = false;
      this.purgePromise = null;
    });
    this.purgePromise = pending;
    this.writeTail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}
