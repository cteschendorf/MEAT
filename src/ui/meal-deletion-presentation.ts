import type { ISODateTime } from '@/domain/shared/ids';

export function remainingUndoSeconds(expiresAt: ISODateTime | null, now: number): number {
  if (!expiresAt || !Number.isFinite(now)) return 0;
  const expiration = Date.parse(expiresAt);
  if (!Number.isFinite(expiration)) return 0;
  return Math.max(0, Math.ceil((expiration - now) / 1_000));
}
