import { ApiError } from '@/data/providers/api-error';
import type { FetchLike, ProviderClock } from '@/data/providers/contracts';
import type { ISODateTime } from '@/domain/shared/ids';

export const MEAT_USER_AGENT = 'MEAT/0.1.0 (https://api.meatnutrition.app)';
export const DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS = 8_000;

function isAbort(value: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (value instanceof Error && value.name === 'AbortError');
}

function retryAt(response: Response, clock: ProviderClock): ISODateTime | undefined {
  const header = response.headers.get('retry-after');
  if (!header) return undefined;
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds)
    ? clock().getTime() + Math.max(0, seconds) * 1_000
    : Date.parse(header);
  return Number.isFinite(milliseconds)
    ? (new Date(milliseconds).toISOString() as ISODateTime)
    : undefined;
}

export async function fetchJson(
  fetcher: FetchLike,
  url: string,
  options: {
    readonly signal?: AbortSignal;
    readonly headers?: Readonly<Record<string, string>>;
    readonly clock: ProviderClock;
    readonly timeoutMs?: number;
  },
): Promise<unknown> {
  if (options.signal?.aborted) {
    throw new ApiError('aborted', 'The food request was cancelled.', { url });
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError('invalid-request', 'The food request timeout must be a positive integer.', { url });
  }

  const controller = new AbortController();
  let termination: 'aborted' | 'timeout' | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let removeAbortListener: (() => void) | undefined;
  const terminationPromise = new Promise<never>((_resolve, reject) => {
    const abort = () => {
      termination = 'aborted';
      controller.abort();
      reject(new ApiError('aborted', 'The food request was cancelled.', { url }));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    removeAbortListener = () => options.signal?.removeEventListener('abort', abort);
    timer = setTimeout(() => {
      termination = 'timeout';
      controller.abort();
      reject(new ApiError('timeout', 'The food provider took too long to respond.', { url }));
    }, timeoutMs);
  });

  let response: Response;
  try {
    response = await Promise.race([
      fetcher(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': MEAT_USER_AGENT,
          ...options.headers,
        },
        signal: controller.signal,
      }),
      terminationPromise,
    ]);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (termination === 'timeout') {
      throw new ApiError('timeout', 'The food provider took too long to respond.', { url, cause: error });
    }
    if (isAbort(error, options.signal)) {
      throw new ApiError('aborted', 'The food request was cancelled.', { url, cause: error });
    }
    throw new ApiError('offline', 'The food provider could not be reached.', { url, cause: error });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    removeAbortListener?.();
  }

  if (!response.ok) {
    if (response.status === 429) {
      const retry = retryAt(response, options.clock);
      throw new ApiError('throttled', 'The food provider is temporarily rate limited.', {
        status: response.status,
        url,
        ...(retry === undefined ? {} : { retryAt: retry }),
      });
    }
    throw new ApiError('http-error', `The food provider returned HTTP ${response.status}.`, {
      status: response.status,
      url,
    });
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    throw new ApiError('invalid-response', 'The food provider did not return JSON.', {
      status: response.status,
      url,
    });
  }

  try {
    return (await response.json()) as unknown;
  } catch (error) {
    throw new ApiError('invalid-response', 'The food provider returned malformed JSON.', {
      status: response.status,
      url,
      cause: error,
    });
  }
}
