/**
 * Per-message dedup + replay-window check for WhatsApp inbound.
 *
 * Meta's webhook signature (`x-hub-signature-256`) signs only the body,
 * not a timestamp — so we can't detect a captured-and-replayed request
 * at the HTTP layer. Instead we enforce freshness per-message using the
 * `messages[].timestamp` field that Meta stamps server-side, and dedup
 * on `messageId` (wamid) so the same message processed twice runs the
 * agent once.
 *
 * Mirrors `slack-dedup-lock.ts`'s SETNX + fail-open posture so a Redis
 * outage degrades to "potential dupe" rather than total silence.
 *
 * Replay window: ±5 minutes around now. Tighter than Slack's 5-minute
 * window only on the future side; Meta has been observed to deliver
 * webhooks up to a few minutes after the message timestamp on rare
 * occasions, so 5 min past is the safe floor.
 */

import { getRedis } from './redis';

const MESSAGE_DEDUP_TTL_SECONDS = 60 * 60; // 1h covers Meta retry budget plus replay attempts
const REPLAY_WINDOW_SECONDS = 5 * 60;

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function messageDedupKey(messageId: string): string {
  return `${envTag()}:wa:msg:${messageId}`;
}

/**
 * Returns true if `timestamp` is within ±REPLAY_WINDOW_SECONDS of now.
 * Pure function — no Redis. Caller drops the message on false.
 *
 * Slightly asymmetric in spirit: future-skew tolerated up to the same
 * window, since clock drift on Meta's edge can push a fresh delivery
 * a few seconds into the future from our wall clock.
 */
export function isWithinReplayWindow(timestamp: Date, now: Date = new Date()): boolean {
  const deltaMs = Math.abs(now.getTime() - timestamp.getTime());
  return deltaMs <= REPLAY_WINDOW_SECONDS * 1000;
}

/**
 * Returns true if `messageId` (wamid) is being seen for the first time.
 * Returns false if a previous call already claimed it (caller should
 * skip processing — Meta delivered the same message twice).
 *
 * Fail-open semantics: if Redis is unavailable, returns true. The
 * channel-identity upsert downstream is keyed on stable BSUID/phone, so
 * a duplicate dispatch produces a duplicate agent turn but not data
 * corruption — better than dropping legitimate inbound traffic during
 * an Upstash incident.
 */
export async function claimWhatsAppMessage(messageId: string | null | undefined): Promise<boolean> {
  if (!messageId) return true;
  const redis = getRedis();
  if (!redis) return true;
  try {
    const r = await redis.set(messageDedupKey(messageId), '1', {
      nx: true,
      ex: MESSAGE_DEDUP_TTL_SECONDS,
    });
    return r === 'OK';
  } catch (err) {
    console.error('[whatsapp-dedup] dedup check failed, failing open', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
