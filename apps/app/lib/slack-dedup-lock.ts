/**
 * Per-event dedup + per-thread single-flight lock for Slack inbound.
 *
 * Slack delivers the same `event_id` more than once on retry (when an
 * endpoint fails to ack within 3s) and on rare network blips even after
 * a 200. Two concurrent inbound events for the same thread (e.g. a fast
 * second @-mention) can also race the agent turn — both runs pull the
 * same session state, both write back, last-write-wins.
 *
 * `claimSlackEvent` SETNX-claims the event_id for 1h. Returns true the
 * first time, false on duplicates → caller drops the event with 200.
 *
 * `acquireThreadLock` / `releaseThreadLock` SETNX a per-(team,channel,
 * thread) key with a 90s TTL. If another event holds the lock, the
 * caller drops with 200 + `dropped: thread_busy` (logged so an operator
 * can tell). The Lua release script verifies the holder token before
 * deleting so we don't free a lock that already timed out and was
 * re-taken by another instance.
 *
 * Fail-open: if Redis is unavailable (local dev without env vars,
 * transient outage), `claim` returns true and `acquire` returns a
 * sentinel — concurrency safety degrades, but the agent never falls
 * silent. This mirrors `api-key-auth.ts`'s posture.
 *
 * Pattern adapted from chat-sdk's `@chat-adapter/state-redis`
 * (`createRedisState`), which combines dedup + thread locks + state in
 * one helper. Sendero only needs the dedup + lock half because session
 * persistence already lives in `makeSessionStore()`.
 */

import { getRedis } from './redis';

const EVENT_DEDUP_TTL_SECONDS = 60 * 60; // 1h covers Slack's retry window plus operator-induced replays
const THREAD_LOCK_TTL_SECONDS = 90; // > maxDuration=60 plus cleanup cushion

/** Sentinel returned by `acquireThreadLock` when Redis is unavailable. */
const LOCK_FAIL_OPEN = '__fail_open__';

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function eventDedupKey(eventId: string): string {
  return `${envTag()}:slack:event:${eventId}`;
}

function threadLockKey(subjectKey: string): string {
  return `${envTag()}:slack:lock:${subjectKey}`;
}

/**
 * Returns true if this event_id is being seen for the first time.
 * Returns false if a previous call already claimed it (duplicate
 * delivery — caller should ack 200 and skip).
 *
 * `eventId` may be null/undefined for events Slack delivers without a
 * top-level id (rare). In that case we fail-open (return true) — there
 * is nothing to dedup on.
 */
export async function claimSlackEvent(eventId: string | null | undefined): Promise<boolean> {
  if (!eventId) return true;
  const redis = getRedis();
  if (!redis) return true;
  try {
    const r = await redis.set(eventDedupKey(eventId), '1', {
      nx: true,
      ex: EVENT_DEDUP_TTL_SECONDS,
    });
    return r === 'OK';
  } catch (err) {
    console.error('[slack-dedup-lock] dedup check failed, failing open', {
      eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}

/**
 * Acquires a thread-scoped single-flight lock. Returns a holder token
 * on success (must be passed to `releaseThreadLock`), or `null` when
 * another event already holds the lock (caller should drop the event).
 *
 * On Redis failure, returns the fail-open sentinel — the caller will
 * still run the turn but won't have concurrency protection. Better
 * than dropping every event during an Upstash incident.
 */
export async function acquireThreadLock(subjectKey: string): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return LOCK_FAIL_OPEN;
  const token = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  try {
    const r = await redis.set(threadLockKey(subjectKey), token, {
      nx: true,
      ex: THREAD_LOCK_TTL_SECONDS,
    });
    return r === 'OK' ? token : null;
  } catch (err) {
    console.error('[slack-dedup-lock] lock acquire failed, failing open', {
      subjectKey,
      error: err instanceof Error ? err.message : String(err),
    });
    return LOCK_FAIL_OPEN;
  }
}

/**
 * Releases a thread lock. The Lua script verifies the holder token
 * matches before deleting — if our TTL expired and another instance
 * already took the lock, we don't accidentally free theirs.
 */
export async function releaseThreadLock(subjectKey: string, token: string | null): Promise<void> {
  if (!token || token === LOCK_FAIL_OPEN) return;
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.eval(
      `if redis.call("get", KEYS[1]) == ARGV[1] then
         return redis.call("del", KEYS[1])
       else
         return 0
       end`,
      [threadLockKey(subjectKey)],
      [token]
    );
  } catch (err) {
    console.error('[slack-dedup-lock] lock release failed', {
      subjectKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
