/**
 * Phase C-2 — email adapter.
 *
 * Thin delegation to the existing email Notifier (Resend). The
 * adapter doesn't render new email templates — it routes to the
 * canonical share-card template for v1 and lets dedicated templates
 * (`sendBookingConfirmed`) ship in v2 once the dispatcher proves
 * itself.
 *
 * For v1 every event kind goes through `sendShareCard` with payload
 * data the dispatcher's caller provides via `event.data`. This is
 * intentionally simple: the call site retrofits already construct
 * email-shaped payloads, and the dispatcher's adapter just relays.
 */

import { clerkClient } from '@clerk/nextjs/server';
import { notifier } from '@sendero/notifications';

import type { ChannelAdapter } from '../dispatch';

export const emailAdapter: ChannelAdapter = async ({ event, recipient }) => {
  let to: string | null = null;
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(recipient.userId);
    to =
      user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null;
  } catch (err) {
    return {
      ok: false,
      error: `clerk lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!to) return { ok: false, error: 'recipient has no email address' };

  const data = (event.data ?? {}) as Record<string, unknown>;
  const title =
    typeof data.title === 'string' ? data.title : defaultTitleFor(event.kind);
  const body = typeof data.message === 'string' ? data.message : '';
  const bullets = Array.isArray(data.bullets)
    ? (data.bullets.filter(b => typeof b === 'string') as string[])
    : undefined;
  const primaryCta =
    typeof data.ctaLabel === 'string' && typeof data.url === 'string'
      ? { label: data.ctaLabel, href: data.url }
      : event.tripId
        ? {
            label: 'Open trip',
            href: `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/dashboard/console?tripId=${event.tripId}`,
          }
        : undefined;
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : undefined;

  try {
    const result = await notifier().sendShareCard(to, {
      title,
      body,
      bullets,
      primaryCta,
      imageUrl,
    });
    return { ok: result.ok, error: result.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

function defaultTitleFor(eventKind: string): string {
  switch (eventKind) {
    case 'handoff.requested':
      return 'Operator handoff needed';
    case 'booking.confirmed':
      return 'Booking confirmed';
    case 'mention.received':
      return 'You were mentioned in Sendero';
    default:
      return 'Sendero notification';
  }
}
