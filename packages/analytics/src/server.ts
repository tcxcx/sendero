/**
 * Server-side PostHog client.
 *
 * Lazy-inited on first use so routes that never capture don't pay for
 * the init. When `POSTHOG_KEY` is unset, `capture*` is a no-op — same
 * semantics as next-forge. Never throws on missing config.
 */

import { PostHog } from 'posthog-node';
import type { CapturedEvent, SenderoEventName, SenderoEventPayload } from './events';

let _client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (_client !== undefined) return _client;
  const key = process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY || null;
  const host =
    process.env.POSTHOG_HOST || process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!key) {
    _client = null;
    return null;
  }
  _client = new PostHog(key, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
  return _client;
}

/**
 * Hash any PII identifier into a stable distinctId. Consuming apps pass
 * the Clerk userId / tenant slug / MSCA address — we never want the
 * email / phone / passport numbers reaching PostHog.
 */
export function hashDistinctId(input: string): string {
  // Constant-time-friendly hash: FNV-1a 32-bit. Good enough for funnel
  // attribution; NOT cryptographic. We're not auth'ing with this.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `dx_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function capture<K extends SenderoEventName>(event: CapturedEvent<K>): Promise<void> | void {
  const client = getClient();
  if (!client) return;
  client.capture({
    distinctId: event.distinctId,
    event: event.event,
    properties: event.properties as Record<string, unknown>,
    timestamp: event.timestamp,
  });
}

export function identify(args: {
  distinctId: string;
  properties: Record<string, string | number | boolean | null>;
}): void {
  const client = getClient();
  if (!client) return;
  client.identify({
    distinctId: args.distinctId,
    properties: args.properties,
  });
}

export function groupIdentify(args: {
  groupType: 'tenant' | 'agency';
  groupKey: string;
  properties: Record<string, string | number | boolean | null>;
}): void {
  const client = getClient();
  if (!client) return;
  client.groupIdentify({
    groupType: args.groupType,
    groupKey: args.groupKey,
    properties: args.properties,
  });
}

/** Flush pending events — call before a serverless function exits. */
export async function flush(): Promise<void> {
  const client = getClient();
  if (!client) return;
  await client.flush();
}

export type { SenderoEventName, SenderoEventPayload } from './events';
