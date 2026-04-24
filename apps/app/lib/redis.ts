/**
 * Upstash Redis client — HTTP-based, edge-compatible, shared across
 * Fluid Compute instances. Used for:
 *   - API key verify cache (apps/app/lib/api-key-auth.ts)
 *   - Future: rate limiting, session state, balance-change pub-sub
 *
 * Provisioned via `vercel integration add upstash/upstash-kv` which
 * stamps KV_URL, KV_REST_API_URL, KV_REST_API_TOKEN on every
 * environment scope. `Redis.fromEnv()` reads them automatically.
 *
 * Safe to import without the env being set — returns `null` so tests
 * and local environments without Upstash don't hard-fail. Callers must
 * handle the null case (typically by treating it as cache-miss).
 */

import { Redis } from '@upstash/redis';

let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    cached = null;
    return cached;
  }
  cached = new Redis({ url, token });
  return cached;
}
