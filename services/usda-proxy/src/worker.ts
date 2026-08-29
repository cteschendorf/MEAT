import {
  API_VERSION,
  USDA_SOURCE,
  type ErrorEnvelope,
  type FoodDetailData,
  type HealthData,
  type SearchData,
  type SuccessEnvelope,
} from './contracts.ts';
import {
  createCacheRequest,
  readCached,
  resolveRuntimeCache,
  writeCached,
  type ResponseCache,
} from './cache.ts';
import { ApiError } from './errors.ts';
import {
  CloudflareRateLimiter,
  InMemoryRateLimiter,
  privateRateLimitKey,
  type ApplicationRateLimiter,
  type RateLimitBinding,
} from './rate-limit.ts';
import { UsdaClient, type FetchImplementation } from './usda-client.ts';

const SEARCH_TTL_SECONDS = 15 * 60;
const FOOD_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_LIMIT = 25;

const corsHeaders: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type',
  'Access-Control-Max-Age': '86400',
};

export interface Env {
  USDA_FDC_API_KEY?: string;
  RATE_LIMITER?: RateLimitBinding;
}

export interface WorkerDependencies {
  fetchImplementation?: FetchImplementation;
  cache?: ResponseCache;
  rateLimiter?: ApplicationRateLimiter;
  now?: () => number;
}

export interface MeatWorker {
  fetch(request: Request, env: Env, context?: ExecutionContext): Promise<Response>;
}

function baseHeaders(): Headers {
  const headers = new Headers(corsHeaders);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

function jsonResponse<T>(
  body: SuccessEnvelope<T> | ErrorEnvelope,
  status: number,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  const headers = baseHeaders();
  for (const [name, value] of Object.entries(extraHeaders ?? {})) headers.set(name, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function successResponse<T>(
  data: T,
  cacheControl = 'no-store',
): Response {
  return jsonResponse(
    { apiVersion: API_VERSION, data },
    200,
    { 'Cache-Control': cacheControl },
  );
}

function errorResponse(error: ApiError): Response {
  return jsonResponse(
    {
      apiVersion: API_VERSION,
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    },
    error.status,
    { 'Cache-Control': 'no-store', ...(error.headers ?? {}) },
  );
}

function normalizeQuery(raw: string | null): string {
  const query = raw?.trim().replace(/\s+/g, ' ') ?? '';
  if (query.length < 2 || query.length > 80) {
    throw new ApiError(400, 'INVALID_QUERY', 'q must be between 2 and 80 characters.');
  }
  return query;
}

function normalizeLimit(raw: string | null): number {
  if (raw === null) return DEFAULT_LIMIT;
  if (!/^(?:[1-9]|1\d|2[0-5])$/.test(raw)) {
    throw new ApiError(400, 'INVALID_LIMIT', 'limit must be an integer between 1 and 25.');
  }
  return Number(raw);
}

function normalizeFdcId(raw: string): number {
  if (!/^[1-9]\d{0,9}$/.test(raw)) {
    throw new ApiError(400, 'INVALID_FDC_ID', 'fdcId must be a positive integer.');
  }
  return Number(raw);
}

function requireApiKey(env: Env): string {
  const key = env.USDA_FDC_API_KEY?.trim();
  if (!key) {
    throw new ApiError(
      503,
      'SERVICE_NOT_CONFIGURED',
      'The food-data service is not configured.',
      true,
    );
  }
  return key;
}

function requesterIp(request: Request): string {
  const value = request.headers.get('CF-Connecting-IP')?.trim();
  return value && value.length <= 128 ? value : 'unknown';
}

function isUsdaRoute(pathname: string): boolean {
  return pathname === '/v1/usda/search' || /^\/v1\/usda\/foods\/[^/]+$/.test(pathname);
}

export function createWorker(dependencies: WorkerDependencies = {}): MeatWorker {
  const now = dependencies.now ?? Date.now;
  const cache = dependencies.cache ?? resolveRuntimeCache();
  const fallbackRateLimiter = dependencies.rateLimiter ?? new InMemoryRateLimiter(30, 60_000);
  const fetchImplementation = dependencies.fetchImplementation ?? ((input, init) => fetch(input, init));
  const usda = new UsdaClient(fetchImplementation);

  async function enforceRateLimit(request: Request, env: Env): Promise<void> {
    const limiter = env.RATE_LIMITER
      ? new CloudflareRateLimiter(env.RATE_LIMITER)
      : fallbackRateLimiter;
    const key = await privateRateLimitKey(requesterIp(request));
    const decision = await limiter.check(key, now());
    if (!decision.allowed) {
      throw new ApiError(
        429,
        'RATE_LIMITED',
        'Too many requests. Please try again shortly.',
        true,
        { 'Retry-After': String(decision.retryAfterSeconds) },
      );
    }
  }

  async function search(url: URL, env: Env): Promise<Response> {
    const query = normalizeQuery(url.searchParams.get('q'));
    const limit = normalizeLimit(url.searchParams.get('limit'));
    const apiKey = requireApiKey(env);
    const cacheRequest = await createCacheRequest(
      `${API_VERSION}/usda/search`,
      `${query.toLowerCase()}\u0000${limit}`,
    );
    const timestamp = now();
    const cached = await readCached<SearchData>(cache, cacheRequest, timestamp);
    if (cached) {
      return successResponse(cached.value, 'private, no-store');
    }

    const normalized = await usda.search(apiKey, query, limit, new Date(timestamp).toISOString());
    const data: SearchData = {
      source: USDA_SOURCE,
      foods: normalized.foods,
      pagination: {
        limit,
        returned: normalized.foods.length,
        ...(normalized.totalHits === undefined ? {} : { totalHits: normalized.totalHits }),
      },
    };
    await writeCached(cache, cacheRequest, data, SEARCH_TTL_SECONDS, timestamp);
    return successResponse(data, 'private, no-store');
  }

  async function food(fdcId: number, env: Env): Promise<Response> {
    const apiKey = requireApiKey(env);
    const cacheRequest = await createCacheRequest(`${API_VERSION}/usda/food`, String(fdcId));
    const timestamp = now();
    const cached = await readCached<FoodDetailData>(cache, cacheRequest, timestamp);
    if (cached) {
      return successResponse(cached.value, 'private, no-store');
    }

    const normalized = await usda.food(apiKey, fdcId, new Date(timestamp).toISOString());
    const data: FoodDetailData = { source: USDA_SOURCE, food: normalized };
    await writeCached(cache, cacheRequest, data, FOOD_TTL_SECONDS, timestamp);
    return successResponse(data, 'private, no-store');
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      const url = new URL(request.url);
      if (request.method !== 'GET') {
        return errorResponse(
          new ApiError(405, 'METHOD_NOT_ALLOWED', 'Only GET requests are supported.', false, {
            Allow: 'GET, OPTIONS',
          }),
        );
      }

      if (url.pathname === '/v1/health') {
        const data: HealthData = { service: 'meat-usda-proxy', status: 'ok' };
        return successResponse(data);
      }

      try {
        if (!isUsdaRoute(url.pathname)) {
          throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
        }
        await enforceRateLimit(request, env);

        if (url.pathname === '/v1/usda/search') return await search(url, env);
        const match = /^\/v1\/usda\/foods\/([^/]+)$/.exec(url.pathname);
        if (!match?.[1]) throw new ApiError(404, 'NOT_FOUND', 'Route not found.');
        return await food(normalizeFdcId(match[1]), env);
      } catch (error) {
        if (error instanceof ApiError) return errorResponse(error);
        return errorResponse(
          new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.', true),
        );
      }
    },
  };
}
