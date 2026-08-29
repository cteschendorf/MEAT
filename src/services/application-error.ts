export type ApplicationErrorCode =
  | 'unexpected'
  | 'validation'
  | 'not-found'
  | 'unavailable';

export class ApplicationError extends Error {
  readonly code: ApplicationErrorCode;
  readonly cause?: unknown;

  constructor(code: ApplicationErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ApplicationError';
    this.code = code;
    this.cause = cause;
  }
}
