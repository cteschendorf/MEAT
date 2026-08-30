export interface ResponseCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
  delete?(request: Request): Promise<boolean>;
}

interface CacheEnvelope<T> {
  expiresAt: number;
  value: T;
}

export type CacheHit<T> = CacheEnvelope<T>;

const fallbackEntries = new Map<string, Response>();

class InMemoryResponseCache implements ResponseCache {
  async match(request: Request): Promise<Response | undefined> {
    return fallbackEntries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    fallbackEntries.set(request.url, response.clone());
  }

  async delete(request: Request): Promise<boolean> {
    return fallbackEntries.delete(request.url);
  }
}

const fallbackCache = new InMemoryResponseCache();

export function resolveRuntimeCache(): ResponseCache {
  const cacheStorage = (globalThis as unknown as { caches?: { default?: ResponseCache } }).caches;
  return cacheStorage?.default ?? fallbackCache;
}

export async function createCacheRequest(namespace: string, value: string): Promise<Request> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return new Request(`https://api.meatnutrition.app/__internal-cache/${namespace}/${hash}`);
}

export async function readCached<T>(
  cache: ResponseCache,
  request: Request,
  now: number,
): Promise<CacheHit<T> | undefined> {
  try {
    const response = await cache.match(request);
    if (!response?.ok) return undefined;
    const envelope = (await response.json()) as Partial<CacheEnvelope<T>>;
    if (
      typeof envelope !== 'object' ||
      envelope === null ||
      typeof envelope.expiresAt !== 'number' ||
      envelope.expiresAt <= now ||
      !('value' in envelope)
    ) {
      await cache.delete?.(request);
      return undefined;
    }
    return { expiresAt: envelope.expiresAt, value: envelope.value as T };
  } catch {
    return undefined;
  }
}

export async function writeCached<T>(
  cache: ResponseCache,
  request: Request,
  value: T,
  ttlSeconds: number,
  now: number,
): Promise<void> {
  const envelope: CacheEnvelope<T> = { expiresAt: now + ttlSeconds * 1_000, value };
  try {
    await cache.put(
      request,
      new Response(JSON.stringify(envelope), {
        headers: {
          'Cache-Control': `public, max-age=${ttlSeconds}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
      }),
    );
  } catch {
    // Cache availability must not make the read-only food API unavailable.
  }
}
