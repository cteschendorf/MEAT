import type { ApiErrorCode } from './contracts.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class UpstreamShapeError extends Error {
  constructor() {
    super('The upstream response did not match the expected schema.');
    this.name = 'UpstreamShapeError';
  }
}
