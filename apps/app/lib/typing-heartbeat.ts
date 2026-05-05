/**
 * WhatsApp typing-indicator heartbeat.
 *
 * Meta's typing presence (`typing_indicator: { type: 'text' }` on the
 * `/messages` read endpoint) auto-clears after 25s OR when the bot
 * sends any outbound. Long-running flows (post-ticket fanout, NFT
 * mint, document scan) take longer than 25s, and the user sees a
 * silent thread that looks broken.
 *
 * Strategy: stamp the most recent inbound `wamid` per
 * `(tenantId, externalUserId)` into Redis when the webhook fires, then
 * wrap every long-running outbound flow with `withTypingHeartbeat()`
 * which re-acks that wamid every 20s. The indicator stays alive until
 * the flow finishes (or 25s after the heartbeat stops, whichever is
 * first — typically when the actual outbound message lands).
 *
 * Strictly cosmetic. Every error here is swallowed; the wrapped flow
 * always runs to completion regardless of typing failures.
 */

import { WhatsAppClient } from '@sendero/whatsapp';
import { env } from '@sendero/env';
import { prisma } from '@sendero/database';

import { getRedis } from './redis';

const HEARTBEAT_INTERVAL_MS = 20_000; // re-ack just before Meta's 25s expiry
const LAST_INBOUND_TTL_SECONDS = 30 * 60; // 30 min — well past any single tool window

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function lastInboundKey(tenantId: string, externalUserId: string): string {
  return `${envTag()}:wa:lastinbound:${tenantId}:${externalUserId}`;
}

/**
 * Stamp the most recent inbound `wamid` for a (tenant, traveler) pair.
 * Called from the WhatsApp webhook handler alongside `markReadAndTyping`.
 * Best-effort — Redis outage is tolerated, the heartbeat helper just
 * skips re-ticking when no key exists.
 */
export async function recordInboundForTyping(args: {
  tenantId: string;
  externalUserId: string;
  messageId: string;
}): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(
      lastInboundKey(args.tenantId, args.externalUserId),
      args.messageId,
      { ex: LAST_INBOUND_TTL_SECONDS }
    );
  } catch (err) {
    console.warn('[typing-heartbeat] record failed (non-fatal)', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Look up the most recent inbound wamid we've cached for this
 * (tenant, traveler). Null when the key isn't set or Redis is down.
 */
async function lookupLastInbound(
  tenantId: string,
  externalUserId: string
): Promise<string | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const v = await redis.get<string>(lastInboundKey(tenantId, externalUserId));
    return typeof v === 'string' && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the WhatsApp install + access token for a tenant. Mirrors
 * the lookup pattern in `booking-boarding-pass.ts` so the heartbeat
 * uses the exact same outbound credentials.
 */
async function resolveClient(tenantId: string): Promise<WhatsAppClient | null> {
  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId },
    select: { phoneNumberId: true, status: true },
  });
  if (!install?.phoneNumberId || install.status === 'disabled') return null;

  const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
  if (!accessToken) return null;

  const apiBaseUrl =
    env.whatsappApiBaseUrl() ??
    (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);

  return new WhatsAppClient({
    phoneNumberId: install.phoneNumberId,
    accessToken,
    apiBaseUrl,
  });
}

/**
 * Run an async function while keeping the typing indicator alive on
 * the traveler's WhatsApp thread. Re-acks the most recent inbound
 * every 20s until the function resolves or rejects.
 *
 * Usage:
 *
 *   await withTypingHeartbeat(
 *     { tenantId, externalUserId },
 *     async () => {
 *       await sendBoardingPass(...);   // 5s
 *       await mintNftStamp(...);       // 30s
 *       await sendNftCard(...);        // 5s
 *     },
 *   );
 *
 * The wrapped function's return value is forwarded; errors propagate.
 */
export async function withTypingHeartbeat<T>(
  args: { tenantId: string; externalUserId: string },
  fn: () => Promise<T>
): Promise<T> {
  const messageId = await lookupLastInbound(args.tenantId, args.externalUserId);
  const client = messageId ? await resolveClient(args.tenantId) : null;

  // No inbound to ack OR no install configured — just run the work.
  if (!client || !messageId) return fn();

  let stopped = false;
  // Tick immediately so the indicator shows up at the start of the flow.
  void client.markReadAndTyping(messageId).catch(() => {});
  const interval = setInterval(() => {
    if (stopped) return;
    void client.markReadAndTyping(messageId).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    return await fn();
  } finally {
    stopped = true;
    clearInterval(interval);
  }
}

/**
 * Convenience: resolve traveler's WhatsApp identity from a tenantId +
 * userId, then run a heartbeat-wrapped function. Used by flows that
 * have a Sendero User reference but not a raw phone number.
 */
export async function withTypingHeartbeatForUser<T>(
  args: { tenantId: string; userId: string },
  fn: () => Promise<T>
): Promise<T> {
  const identity = await prisma.channelIdentity.findFirst({
    where: { tenantId: args.tenantId, userId: args.userId, kind: 'whatsapp' },
    select: { externalUserId: true },
  });
  if (!identity?.externalUserId) return fn();
  return withTypingHeartbeat(
    { tenantId: args.tenantId, externalUserId: identity.externalUserId },
    fn
  );
}
