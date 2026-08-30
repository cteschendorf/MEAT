import type { FoodProviderIssue } from '@/domain/food/source';
import type { ISODateTime } from '@/domain/shared/ids';

export type ApiErrorCode =
  | 'invalid-request'
  | 'offline'
  | 'aborted'
  | 'timeout'
  | 'http-error'
  | 'throttled'
  | 'invalid-response';

export interface ApiErrorOptions {
  readonly status?: number;
  readonly url?: string;
  readonly retryAt?: ISODateTime;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly url?: string;
  readonly retryAt?: ISODateTime;

  constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.url !== undefined) this.url = options.url;
    if (options.retryAt !== undefined) this.retryAt = options.retryAt;
  }

  toProviderIssue(): FoodProviderIssue {
    const kind = this.code === 'offline' ? 'offline' : this.code === 'throttled' ? 'throttled' : 'error';
    return {
      kind,
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.retryAt === undefined ? {} : { retryAt: this.retryAt }),
    };
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
