export const JOURNAL_PAGE_SIZE = 100;

export function nextJournalLimit(currentLimit: number): number {
  if (!Number.isInteger(currentLimit) || currentLimit < JOURNAL_PAGE_SIZE) {
    throw new Error(`Journal limit must be an integer of at least ${JOURNAL_PAGE_SIZE}.`);
  }
  return currentLimit + JOURNAL_PAGE_SIZE;
}
