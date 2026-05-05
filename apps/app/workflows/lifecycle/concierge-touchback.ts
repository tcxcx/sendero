/**
 * concierge-touchback — Phase G concierge touch-back watcher.
 *
 * Kicked off once per `book_flight` ticketed event from
 * `firePostTicketingFanout` alongside `watchTripCompletion`. The
 * workflow sleeps until 48 hours before the trip's first segment
 * departs, then fires Touch-1: a single WhatsApp card composing
 * `local_color_brief` (3-5 destination bullets) + the open ancillary
 * checklist for the traveler to tap their way through.
 *
 * Mirrors the watcher pattern from `watch-trip-completion.ts`:
 *   - 1 worker per trip
 *   - durable sleep until the trigger time
 *   - send + done (no follow-up cron tick)
 *
 * Skip-conditions handled inside steps (workflow itself is dumb):
 *   - First segment departure already passed (rare — same-day book)
 *   - Trip in terminal state by the time sleep ends
 *   - Touch-back already sent (`Trip.metadata.ancillaryChecklist
 *     .touchBackSentAt`) — idempotent against duplicate kickoffs
 *   - No traveler identity (channel-less booking) — surfaces email
 *     fallback when wired (Phase G.2; today logs + skips)
 *
 * Spec: docs/architecture/concierge-magic.md §6.2.
 */

import { sleep } from 'workflow';

import { loadTouchbackContext } from './steps/load-touchback-context';
import { sendTouchbackPrompt } from './steps/send-touchback-prompt';

const TOUCHBACK_LEAD_HOURS = 48;

export const conciergeTouchback = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<void> => {
  'use workflow';

  const ctx = await loadTouchbackContext({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });
  if (!ctx) return;
  if (ctx.skipReason) {
    // Most common: no firstSegmentDepartureAt (sandbox carriers,
    // segments not yet projected) or trip already terminal.
    return;
  }

  const wakeMs =
    new Date(ctx.firstSegmentDepartureAt!).getTime() - TOUCHBACK_LEAD_HOURS * 60 * 60 * 1000;
  const wakeAt = new Date(wakeMs);
  // WDK rejects past-date sleeps. When the trigger is already in the
  // past (booked <48h before departure — common), fire immediately.
  if (wakeAt.getTime() > Date.now()) {
    await sleep(wakeAt);
  }

  await sendTouchbackPrompt({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });
};
