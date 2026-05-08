/**
 * Phase C-2 — WhatsApp adapter (v1: operator-only, no-op).
 *
 * v1 scope decision: operators don't receive WhatsApp notifications
 * by default. Traveler-side WhatsApp routing stays in the existing
 * `apps/app/lib/channel-routing.ts::sendShareOnTrip` path — the
 * dispatcher does not centralize tenant Meta-direct vs Kapso-proxy
 * resolution (codex outside-voice #6 + locked /plan-eng-review C8).
 *
 * The adapter exists in v1 so the channel kind is wired and the
 * dispatcher tests pass; it returns `ok: false, error: 'no
 * adapter for operator whatsapp in v1'` for every call. v2 wires
 * traveler routing once the dispatcher proves itself on operator
 * channels.
 *
 * If a tenant configures `whatsapp` in `UserNotificationPref` for
 * an operator, the adapter no-sends and the dispatch row records
 * `status: 'failed'` with the v1 error. The composer UI in
 * `/dashboard/settings/notifications` should disable the WhatsApp
 * checkbox for v1 to make this state unreachable in the happy path.
 */

import type { ChannelAdapter } from '../dispatch';

export const whatsappAdapter: ChannelAdapter = async () => {
  return {
    ok: false,
    error: 'WhatsApp adapter not wired for operator notifications in v1 (deferred to v2)',
  };
};
