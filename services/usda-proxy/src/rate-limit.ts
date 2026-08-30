export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface ApplicationRateLimiter {
  check(key: string, now: number): Promise<RateLimitDecision>;
}

interface WindowState {
  count: number;
  startsAt: number;
}

export class InMemoryRateLimiter implements ApplicationRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  constructor(
    private readonly maximum = 30,
    private readonly windowMs = 60_000,
  ) {}

  async check(key: string, now: number): Promise<RateLimitDecision> {
    let state = this.windows.get(key);
    if (!state && this.windows.size >= 10_000) {
      for (const [candidateKey, candidate] of this.windows) {
        if (now >= candidate.startsAt + this.windowMs) this.windows.delete(candidateKey);
      }
    }
    if (!state || now >= state.startsAt + this.windowMs) {
      state = { count: 0, startsAt: now };
      this.windows.set(key, state);
    }

    if (state.count >= this.maximum) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((state.startsAt + this.windowMs - now) / 1_000)),
      };
    }

    state.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export class CloudflareRateLimiter implements ApplicationRateLimiter {
  constructor(private readonly binding: RateLimitBinding) {}

  async check(key: string): Promise<RateLimitDecision> {
    const result = await this.binding.limit({ key });
    return { allowed: result.success, retryAfterSeconds: result.success ? 0 : 60 };
  }
}

export async function privateRateLimitKey(ipAddress: string): Promise<string> {
  const bytes = new TextEncoder().encode(`usda-proxy:${ipAddress}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
