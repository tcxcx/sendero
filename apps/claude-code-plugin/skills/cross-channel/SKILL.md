---
description: Operate Sendero across WhatsApp, Slack, MCP, and the web console without losing trip state. Trigger when the user asks why a thread looks fragmented, requests an approval routed to Slack, references a WhatsApp traveler conversation from another channel, or asks how a single trip flows across channels.
---

# Sendero — Cross-channel

A Sendero trip lives in one place: the `Trip.events` ledger. Every
channel — WhatsApp from the traveler, Slack from the operator, MCP
from a partner agent, web console from finance — reads and writes to
that single thread. This skill helps Claude reason about the
traveler's full conversation regardless of which surface the current
message arrived on.

## When to use this skill

- "What did the traveler say on WhatsApp last night?"
- "Approve this booking from the #travel channel."
- "Forward the operator's note back to the WhatsApp thread."
- "Why does this trip have replies from 3 channels?"
- "Pause WhatsApp escalation and move to Slack approval."

## Operating rules

1. **Trip.events is canonical.** Don't try to reconstruct the thread
   from a single channel's history. Pull `get_trip_events(tripId)`;
   that's the unified stream.
2. **Channel-aware rendering.** Sendero ships a canonical
   `ChannelMessage` union; every reply you generate flows through it.
   The user might see Block Kit on Slack and a card on WhatsApp from
   the same canonical input — that's intentional.
3. **Approvals always go to the operator channel.** Travelers don't
   approve their own bookings; an operator does (Slack approval card
   by default). Use `request_approval(tripId, requesterChannelId)`;
   the operator channel is resolved from the workspace config, not
   the requester's channel.
4. **Don't cross-post.** If a traveler says something private on
   WhatsApp, don't auto-mirror it to Slack. The operator can quote
   into Slack manually if needed; surface a redaction summary, not
   the raw text.
5. **Locale follows the user, not the channel.** Spanish on WhatsApp
   ↔ Spanish in the Slack quote ↔ Spanish in the audit log. The tool
   surface is locale-agnostic; the skill mirrors the user's language.

## Useful tools

- `get_trip_events(tripId)` — unified ledger across all channels.
- `request_approval(tripId, requesterChannel)` — routes to operator
  Slack channel; returns approval ticket id.
- `send_to_channel(tripId, channel, message)` — explicit cross-post,
  requires user opt-in.
- `subscribe_thread(tripId, channel)` — flag a thread so the next
  channel-side reply auto-reaches Sendero.

## Channel-specific gotchas

**WhatsApp:** 24-hour customer service window applies. Outside the
window you must use a pre-approved template. `send_to_channel` will
return `OUTSIDE_24H` if you try to send freeform after the window;
fall back to a template or wait for the traveler to message first.

**Slack:** Approvals use Block Kit cards. The user can click ✓ / ✗;
the result lands in `Trip.events` as `approved_by` / `rejected_by` +
the Slack user id of the operator who clicked.

**MCP:** A partner agent can write to `Trip.events` via the tool
surface, but only with a Bearer key authorized for the workspace.
Verify the `apiKey.tenantId` matches the trip's tenant before
trusting the write.

**Web console:** Operator messages in the dashboard's `<Composer />`
write to `Trip.events` with `channel: "operator-web"` so finance can
distinguish operator action from agent action.

## Pattern

```
User:  "The traveler texted me they missed their flight on WhatsApp.
        Can you find them a replacement and ping me on Slack to
        approve?"
Agent: → get_trip_events("tr_4d9")
       "I see the WhatsApp note from 14:22 UTC — flight AA-1234
        BUE→MIA missed (delayed taxi). Searching replacements..."
       → search_flights({ origin: "BUE", destination: "MIA",
                          date: "today", maxLayovers: 1 })
       "3 options. Best: AA-2120 BUE 18:30 → MIA 02:15+1, $912 USDC,
        same fare class. Hold 24h while finance approves?"
       → hold({ offerId: "off_b22", holdMinutes: 1440 })
       → request_approval(tripId="tr_4d9", requesterChannel="whatsapp")
       "Held off_b22 (24h). Approval card posted to #travel-approvals
        on Slack. Notifying you when it's clicked."
```

## Anti-patterns

- ❌ Re-typing a traveler's message into Slack verbatim. Quote it
  with attribution + timestamp.
- ❌ Approving on the user's behalf because they replied "yes" in the
  trip thread — approval is a structured Slack action, not a chat
  reply.
- ❌ Treating channel as identity. The traveler messages from many
  numbers; the SlackUser is many people; resolve to the canonical
  `User` in our DB before stamping audit rows.
