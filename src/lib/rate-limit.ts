import "server-only";

/**
 * In-process sliding-window rate limiter.
 *
 * Good enough for a single-container deployment. For a horizontally scaled
 * deployment, swap the Map for Redis (the interface stays identical).
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => t > cutoff);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0]!;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  bucket.hits.push(now);

  // Periodic sweep so the map does not grow without bound.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) {
      if (v.hits.every((t) => t <= cutoff)) buckets.delete(k);
    }
  }

  return {
    allowed: true,
    remaining: limit - bucket.hits.length,
    retryAfterSeconds: 0,
  };
}

export function resetRateLimit(key: string) {
  buckets.delete(key);
}

export const LIMITS = {
  login: { limit: 8, windowMs: 10 * 60_000 },
  loginPerIp: { limit: 25, windowMs: 10 * 60_000 },
  punch: { limit: 12, windowMs: 5 * 60_000 },
  nonce: { limit: 30, windowMs: 5 * 60_000 },
  networkCheck: { limit: 60, windowMs: 5 * 60_000 },
  adminWrite: { limit: 120, windowMs: 60_000 },
} as const;
