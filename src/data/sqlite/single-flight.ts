/**
 * Share one initialization attempt across concurrent callers. A successful
 * result remains shared; a failed attempt is cleared so the next call retries.
 */
export function retryableSingleFlight<T>(start: () => Promise<T>): () => Promise<T> {
  let active: Promise<T> | null = null;
  return () => {
    if (active) return active;
    const attempt = Promise.resolve().then(start);
    const guarded = attempt.catch((error: unknown) => {
      if (active === guarded) active = null;
      throw error;
    });
    active = guarded;
    return guarded;
  };
}
