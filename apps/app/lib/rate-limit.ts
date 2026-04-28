/**
 * Tiny sliding-window rate limiter on top of Upstash Redis (REST).
 *
 * Edge-runtime safe — uses HTTP transport via `getRedis()`. Keys are
 * env-scoped per CLAUDE.md so Preview deploys don't trip Production
 * counters when sharing the same Upstash DB.
 *
 * Behaviour:
 *   - Returns `{ ok: true, remaining }` when under the cap.
 *   - Returns `{ ok: false, retryAfter }` when over.
 *   - Fail-open if Redis is unreachable — better to serve than 429.
 *     Callers that want strict gating should treat null Redis as a
 *     hard failure themselves.
 */

import { getRedis } from './redis';

interface RateLimitArgs {
  /** Logical bucket: 'og-share', 'playground-chat', etc. */
  bucket: string;
  /** Identity key inside the bucket: IP, userId, sessionId. */
  key: string;
  /** Window length in seconds. */
  windowS: number;
  /** Allowed requests inside the window. */
  limit: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterS: number;
}

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export async function checkRateLimit(args: RateLimitArgs): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) {
    return { ok: true, remaining: args.limit, retryAfterS: 0 };
  }
  const bucket = Math.floor(Date.now() / 1000 / args.windowS);
  const redisKey = `${envTag()}:rl:${args.bucket}:${args.key}:${bucket}`;
  try {
    const count = await redis.incr(redisKey);
    if (count === 1) await redis.expire(redisKey, args.windowS * 2);
    const remaining = Math.max(0, args.limit - count);
    return {
      ok: count <= args.limit,
      remaining,
      retryAfterS: count > args.limit ? args.windowS : 0,
    };
  } catch (err) {
    console.warn(`[rate-limit:${args.bucket}] redis error (failing open)`, err);
    return { ok: true, remaining: args.limit, retryAfterS: 0 };
  }
}

/**
 * Pull the caller's IP from forwarded headers, falling back to a
 * stable "unknown" sentinel so all unidentifiable callers share one
 * bucket (more conservative than per-call randomness).
 */
export function clientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}
