/**
 * Slack subscribed-thread tracking.
 *
 * Without this gate, every message in a channel the bot is a member of
 * triggers an agent turn — quickly becomes a #general firehose. The
 * intended chat-sdk semantic is: bot only responds in a thread if it
 * was @-mentioned OR has previously replied (subscribed). DMs always
 * respond.
 *
 * Pattern: when the agent posts into a thread, we mark it subscribed
 * for 24h. The events route checks the subscription state for
 * channel/group messages before dispatching the agent. App-mentions
 * and DMs bypass this entirely.
 *
 * Storage: Upstash Redis SETEX. Env-scoped keys (`<envTag>:slack:sub:
 * <teamId>:<channelId>:<threadTs>`) so Preview / Production sharing
 * one Upstash DB stays safe. Fail-open if Redis is down — the events
 * route falls back to the @-mention-only filter, which is conservative
 * (drops follow-ups) but never spammy.
 */

import { getRedis } from './redis';

const SUBSCRIPTION_TTL_SECONDS = 24 * 60 * 60; // 24 hours — long enough for a same-day follow-up

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function subscriptionKey(teamId: string, channelId: string, threadTs: string): string {
  return `${envTag()}:slack:sub:${teamId}:${channelId}:${threadTs}`;
}

/**
 * Mark a thread as subscribed. Called from `runSlackAgentTurn` after a
 * successful post so the next message in the same thread will trigger
 * the agent without requiring a fresh @-mention.
 */
export async function markThreadSubscribed(args: {
  teamId: string;
  channelId: string;
  threadTs: string;
}): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(subscriptionKey(args.teamId, args.channelId, args.threadTs), '1', {
      ex: SUBSCRIPTION_TTL_SECONDS,
    });
  } catch (err) {
    console.error('[slack-thread-sub] mark failed (non-fatal)', {
      teamId: args.teamId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Returns true if the (team, channel, thread) is currently subscribed.
 * Returns false if not subscribed or if Redis is unavailable — the
 * caller treats both as "no follow-up subscription, fall back to
 * @-mention filter". Conservative on Redis outage.
 */
export async function isThreadSubscribed(args: {
  teamId: string;
  channelId: string;
  threadTs: string;
}): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    const v = await redis.get(subscriptionKey(args.teamId, args.channelId, args.threadTs));
    return v !== null;
  } catch (err) {
    console.error('[slack-thread-sub] check failed (treat as not-subscribed)', {
      teamId: args.teamId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
