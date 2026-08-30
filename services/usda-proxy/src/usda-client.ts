import type { CanonicalFood } from './contracts.ts';
import { ApiError, UpstreamShapeError } from './errors.ts';
import { normalizeUsdaFood, normalizeUsdaSearch } from './normalization.ts';

export type FetchImplementation = (input: string, init?: RequestInit) => Promise<Response>;

const USDA_BASE_URL = 'https://api.nal.usda.gov/fdc/v1';
const UPSTREAM_TIMEOUT_MS = 8_000;

function retryAfterHeader(response: Response): Readonly<Record<string, string>> | undefined {
  const raw = response.headers.get('Retry-After');
  if (!raw || !/^\d{1,5}$/.test(raw)) return undefined;
  const seconds = Math.min(86_400, Number(raw));
  return { 'Retry-After': String(seconds) };
}

async function parsePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ApiError(
      502,
      'UPSTREAM_INVALID_RESPONSE',
      'The food-data provider returned an invalid response.',
      true,
    );
  }
}

export class UsdaClient {
  constructor(private readonly fetchImplementation: FetchImplementation) {}

  private async request(url: URL, notFoundIsFood = false): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await this.fetchImplementation(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (notFoundIsFood && response.status === 404) {
        throw new ApiError(404, 'FOOD_NOT_FOUND', 'The requested USDA food was not found.');
      }
      if (response.status === 429) {
        throw new ApiError(
          429,
          'UPSTREAM_RATE_LIMITED',
          'Food data is temporarily unavailable. Please try again shortly.',
          true,
          retryAfterHeader(response),
        );
      }
      if (!response.ok) {
        throw new ApiError(
          502,
          'UPSTREAM_FAILURE',
          'The food-data provider is temporarily unavailable.',
          true,
        );
      }
      return await parsePayload(response);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        502,
        'UPSTREAM_FAILURE',
        'The food-data provider is temporarily unavailable.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(
    apiKey: string,
    query: string,
    limit: number,
    retrievedAt: string,
  ): Promise<{ foods: CanonicalFood[]; totalHits?: number }> {
    const url = new URL(`${USDA_BASE_URL}/foods/search`);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('query', query);
    url.searchParams.set('pageSize', String(limit));
    url.searchParams.set('pageNumber', '1');

    const payload = await this.request(url);
    try {
      return normalizeUsdaSearch(payload, retrievedAt);
    } catch (error) {
      if (!(error instanceof UpstreamShapeError)) throw error;
      throw new ApiError(
        502,
        'UPSTREAM_INVALID_RESPONSE',
        'The food-data provider returned an invalid response.',
        true,
      );
    }
  }

  async food(apiKey: string, fdcId: number, retrievedAt: string): Promise<CanonicalFood> {
    const url = new URL(`${USDA_BASE_URL}/food/${fdcId}`);
    url.searchParams.set('api_key', apiKey);

    const payload = await this.request(url, true);
    try {
      return normalizeUsdaFood(payload, retrievedAt, fdcId);
    } catch (error) {
      if (!(error instanceof UpstreamShapeError)) throw error;
      throw new ApiError(
        502,
        'UPSTREAM_INVALID_RESPONSE',
        'The food-data provider returned an invalid response.',
        true,
      );
    }
  }
}
