/**
 * watch-trip-completion — Phase F lifecycle watcher.
 *
 * Kicked off once per `book_flight` ticketed event from
 * `firePostTicketingFanout`. The workflow sleeps until the trip's
 * last segment arrives + 24 hours, then sends a WhatsApp
 * interactive-button card asking the traveler to wrap up:
 *
 *   *Welcome back from <destination>!*
 *   How was your trip?
 *   [✅ Wrap up · mint NFT] [✈️ Still traveling]
 *
 * Tap routing happens in the agent prompt:
 *   - `trip_wrap:<tripId>`   → `complete_trip` → TripPassport mints
 *   - `trip_extend:<tripId>` → `set_trip_kind` → flips to open_journey,
 *                              traveler keeps booking leg-by-leg
 *
 * After sending the prompt, the workflow sleeps 7 more days and then
 * auto-completes the trip if it's still `in_progress` or `booked`
 * (no human response). Failure modes are all fail-soft via WDK retry
 * envelopes; the trip stays in_progress otherwise.
 *
 * Skip-conditions handled inside steps (workflow itself is dumb):
 *   - Trip kind === 'open_journey' (those auto-complete via going-home
 *     detection in book_flight, no watcher needed).
 *   - Trip already in terminal state (completed / canceled / failed)
 *     by the time the sleep ends.
 *
 * Idempotency note: book_flight may fire this multiple times per trip
 * (round-trip = 1 booking = 1 watcher; multi-leg open_journey =
 * skipped). Duplicate watchers all converge on the same status check
 * before closing — wasteful but correct. Future: dedup via
 * `Trip.watcherWorkflowId` column.
 */

import { sleep } from 'workflow';

import { closeIfStillOpen } from './steps/close-if-still-open';
import { loadCompletionContext } from './steps/load-completion-context';
import { sendWrapUpPrompt } from './steps/send-wrap-up-prompt';

const WRAP_UP_GRACE_HOURS = 24;
const SILENT_AUTO_CLOSE_DAYS = 7;

export const watchTripCompletion = async (args: {
  tripId: string;
  tenantId: string;
}): Promise<void> => {
  'use workflow';

  const ctx = await loadCompletionContext({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });
  if (!ctx) return;
  if (ctx.skipReason) {
    // Most common skip: kind === 'open_journey' (going-home auto-completes
    // via book_flight) or no arrivalAt (sandbox carriers, missing
    // segment data).
    return;
  }

  const wakeForPromptMs =
    new Date(ctx.lastArrivalAt!).getTime() + WRAP_UP_GRACE_HOURS * 60 * 60 * 1000;
  const wakeForPrompt = new Date(wakeForPromptMs);
  // WDK rejects past-date sleeps. When the arrival is already in the
  // past (rare — same-day tickets), skip directly to sending the
  // prompt.
  if (wakeForPrompt.getTime() > Date.now()) {
    await sleep(wakeForPrompt);
  }

  await sendWrapUpPrompt({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });

  await sleep(`${SILENT_AUTO_CLOSE_DAYS}d`);

  await closeIfStillOpen({
    tripId: args.tripId,
    tenantId: args.tenantId,
  });
};
