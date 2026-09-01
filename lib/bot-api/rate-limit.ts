import { botApiError, createBotApiRequestId } from "@/lib/bot-api/http";

export const BOT_API_RATE_LIMIT_PER_MINUTE = 60;
export const BOT_API_RATE_LIMIT_BURST = 10;

type TokenBucketState = {
  tokens: number;
  refilledAt: number;
  lastSeenAt: number;
};

export type BotRateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

type BotApiTokenBucketOptions = {
  requestsPerMinute?: number;
  burst?: number;
  clock?: () => number;
  idleTtlMs?: number;
  maxBuckets?: number;
};

export class BotApiTokenBucket {
  private readonly requestsPerMinute: number;
  private readonly burst: number;
  private readonly refillPerMillisecond: number;
  private readonly clock: () => number;
  private readonly idleTtlMs: number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, TokenBucketState>();
  private operations = 0;

  constructor(options: BotApiTokenBucketOptions = {}) {
    this.requestsPerMinute = positiveNumber(options.requestsPerMinute, BOT_API_RATE_LIMIT_PER_MINUTE);
    this.burst = positiveNumber(options.burst, BOT_API_RATE_LIMIT_BURST);
    this.refillPerMillisecond = this.requestsPerMinute / 60_000;
    this.clock = options.clock ?? Date.now;
    this.idleTtlMs = positiveNumber(options.idleTtlMs, 10 * 60_000);
    this.maxBuckets = Math.max(1, Math.floor(positiveNumber(options.maxBuckets, 1_024)));
  }

  consume(tokenDigest: string): BotRateLimitDecision {
    const now = this.clock();
    this.operations += 1;
    if (this.operations % 256 === 0) this.pruneExpired(now);
    if (!this.buckets.has(tokenDigest) && this.buckets.size >= this.maxBuckets) this.evictOldest();

    const existing = this.buckets.get(tokenDigest);
    const elapsed = existing ? Math.max(0, now - existing.refilledAt) : 0;
    const available = existing
      ? Math.min(this.burst, existing.tokens + elapsed * this.refillPerMillisecond)
      : this.burst;
    const state: TokenBucketState = {
      tokens: available,
      refilledAt: now,
      lastSeenAt: now
    };

    if (available >= 1) {
      state.tokens = available - 1;
      this.buckets.set(tokenDigest, state);
      return { allowed: true, remaining: Math.floor(state.tokens) };
    }

    this.buckets.set(tokenDigest, state);
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((1 - available) / this.refillPerMillisecond / 1_000))
    };
  }

  clear(): void {
    this.buckets.clear();
    this.operations = 0;
  }

  private pruneExpired(now: number): void {
    for (const [key, state] of this.buckets) {
      if (now - state.lastSeenAt >= this.idleTtlMs) this.buckets.delete(key);
    }
  }

  private evictOldest(): void {
    let oldest: { key: string; lastSeenAt: number } | undefined;
    for (const [key, state] of this.buckets) {
      if (!oldest || state.lastSeenAt < oldest.lastSeenAt) oldest = { key, lastSeenAt: state.lastSeenAt };
    }
    if (oldest) this.buckets.delete(oldest.key);
  }
}

type EnforceBotRateLimitOptions = {
  requestId?: string;
  limiter?: BotApiTokenBucket;
};

export type EnforceBotRateLimitResult =
  | {
      ok: true;
      remaining: number;
    }
  | {
      ok: false;
      retryAfterSeconds: number;
      response: Response;
    };

const defaultLimiter = new BotApiTokenBucket();

export function enforceBotRateLimit(
  tokenDigest: string,
  options: EnforceBotRateLimitOptions = {}
): EnforceBotRateLimitResult {
  const decision = (options.limiter ?? defaultLimiter).consume(tokenDigest);
  if (decision.allowed) return { ok: true, remaining: decision.remaining };

  const retryAfterSeconds = decision.retryAfterSeconds ?? 1;
  return {
    ok: false,
    retryAfterSeconds,
    response: botApiError("RATE_LIMITED", {
      requestId: options.requestId ?? createBotApiRequestId(),
      headers: { "Retry-After": String(retryAfterSeconds) }
    })
  };
}

export function resetBotRateLimitsForTests(): void {
  defaultLimiter.clear();
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
