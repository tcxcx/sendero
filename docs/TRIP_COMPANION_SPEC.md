# Trip Companion + Disruption Recovery — Product + Workflow Spec

Date: 2026-04-23
Branch: `feat/phase-11-invoicing`
Status: spec + implementation contract. Most of the atomic pieces exist on branch (48 tools, 16 workflows, 5 new AI-Elements cards). This document ties them into one coherent post-book experience and enumerates what's still missing.

## Product summary

After a traveler clicks book, **one durable conversation** follows them across WhatsApp, Slack, email, and web. That conversation survives:

- airline behaviour (ticketing delays, schedule changes, cancellations)
- channel switches (start on WA, approve on Slack, read the receipt in email)
- device switches and offline stretches
- multi-day waits between steps

The mechanism is one `@sendero/workflows` run per trip leg. The run pauses on external events, carries the canonical `share` shape on every pause payload, and is resumable by a shareable URL that the Slack button, WA CTA, and web card all hit. Chat is ephemeral; the email is the durable receipt.

Five surfaces make the product pay off:

1. **Ancillary sell-up at book time** (bags, seats, CFAR) via `sendero.book_with_ancillaries`.
2. **In-chat Duffel Travel Support Assistant** — unlocked the moment `ensure_duffel_customer` runs.
3. **Disruption recovery** — two entry points (`trip_delay_replanner`, `cancellation_recovery`); one share shape.
4. **Pre-departure nudge** — T-24h check-in via `sendero.check_in_reminder`.
5. **Destination readiness + arrival playbook** — composed of 9 atomic tools into 1 card.

Every terminal state ships an email with the on-chain proof (settle tx hash or refund tx hash) in traveler-friendly framing — "Booked · paid · tx 0x12a…feb" — never a raw hex dump.

## User journeys

### Traveler (individual, WA-first)

1. Books LIS→MAD on WhatsApp.
2. Ancillary picker renders inline: 23kg bag ✓, window seat ✓, CFAR skipped. Card shows running delta in traveler currency + "within budget" badge.
3. `book_flight` holds with `services[]` attached.
4. `await_duffel_ticket` pause — 48h max; Duffel webhook resolves in minutes.
5. On ticket: `generate_booking_invoice` fires. Traveler receives: WA receipt card + email with PDF + settle-split tx hashes surfaced as "paid to supplier · paid commission · settled on Arc".
6. Mid-trip: "can I add a bag?" — same chat, resolves via Duffel Travel Support Assistant session (scoped to her `icu_…`), no new search. `list_flight_ancillaries` + `book_flight` with services attaches the bag, `air.airline_credit.*` events reconcile the cache.
7. T-24h: `trip_checkin_reminder` fires → WA nudge + ICS email. Tap opens in-trip chat.
8. On landing: `airport_arrival_playbook` + `airport_transfer_coordinator` + `restaurant_route_card` push one card — gate → transit → first meal.

### Traveler (corporate, policy-gated)

1. Books within policy via `sendero.book_with_ancillaries`.
2. Night before: airline cancels. `sendero.cancellation_recovery` fires — WA pauses for the traveler AND Slack pauses for the `agency_admin` simultaneously (same run, two adapters).
3. Traveler taps rebook on WA. Fare delta exceeds 20%. Slack adapter shows the agency_admin a policy.reasons block + Approve / Deny / Counter-offer buttons.
4. Operator approves. Resume token fires → `book_flight` holds the replacement → new invoice + disruption email + Slack thread archived with outcome.

### Guest (Navan-style prepaid)

1. `agency_admin` runs `sendero.guest_prefund` (or `sendero.agency_cohort` for bulk). Escrow reserved; WA + email claim link emitted.
2. Guest opens WA → claims with Modular Wallet passkey → arrives in chat.
3. Same `book_with_ancillaries` flow as above, but capped by the prefund budget.
4. Post-trip: receipt emails split — traveler gets trip confirmation, the prefunding `agency_admin` gets the settlement breakdown.

### agency_admin (TMC operator)

- Lives in the **web `/app` operator workspace** + **Slack**. Sees the whole cohort's disruption queue.
- Can: override a rebook (policy exception), approve a fare delta, trigger a manual `cancel_order_quote` + `confirm_cancel_order`, issue a guest pass, view `SupportTurn` audit per traveler.
- Cannot: impersonate a traveler into their WA thread without a logged `log_agent_action` breadcrumb.

### finance

- Web + email. Sees `generate_booking_invoice` output, `settle_split` tx list, refund ledger.
- Cannot book or cancel. Tool handlers re-check `ToolContext.traveler.tenantId` role on every call — the constraint is enforced at the tool layer, not the UI.

## Domain model additions

| Entity | Purpose | Status |
|---|---|---|
| `User.duffelCustomerUserId` (Prisma) | Per-user icu_… — unlocks Travel Support Assistant | ✅ phase_11d migration |
| `Tenant.duffelCustomerUserGroupId` | Per-tenant usg_… | ✅ phase_11d migration |
| `AirlineCredit` table | Cached credit state mirroring Duffel wire | ✅ phase_11e migration |
| `AncillarySelection` | Per-offer services[] with per-segment caveats | **new — phase_11f** |
| `DisruptionRun` | { kind: delay \| cancellation, source: traveler \| webhook, tripId, workflowRunId, status } | **new — phase_11f** |
| `CheckInNudge` | { scheduledAt, firedAt, actionedAt, channel, leaveByIso } | **new — phase_11f** |
| `SafetyBrief` | Composed weather/AQ/timezone/elevation result + per-provider outputs | **new — phase_11f** |
| `ArrivalPlaybookRun` | { airport, transferId?, restaurantIds, routeMapCid } | **new — phase_11f** |
| `SupportTurn` | Duffel TSA call log with outcome + nanopayment tx | **new — phase_11f** |
| `InvoiceReceipt` / `RefundReceipt` | Resend id + surface tag + tx hash per email leg | **partial — extend existing `Invoice` model** |

The new tables are thin audit/cache rows, not sources of truth — Duffel remains canonical for orders/cancellations/credits, workflow runs remain canonical for state transitions. Indexes on `(tenantId, tripId)` + `(userId, state, createdAt)` are enough for every UI query.

## Workflow orchestration wiring (existing + new)

### What already exists on branch

| Workflow id | Steps | Status |
|---|---|---|
| `sendero.book_with_ancillaries` | ensure_customer → search → list_ancillaries → pause → book_flight → pause for Duffel ticket → invoice or cancel | ✅ |
| `sendero.cancellation_recovery` | pause for rebook-vs-refund → trip_delay_replanner OR cancel + refund | ✅ |
| `sendero.trip_delay_replanner` | plan → branch on selectable → pause → book_flight | ✅ |
| `sendero.check_in_reminder` | fetch_booking → geocode_origin → trip_checkin_reminder → pause | ✅ v2 |
| `sendero.travel_safety_brief` | geocode → parallel(weather, AQ, timezone, elevation, safety_aid) | ✅ |
| `sendero.book_stay_with_loyalty` | ensure → search → pause → quote → pause for loyalty → book | ✅ |
| `sendero.cancel_order_with_credits` | quote → pause for approval → confirm | ✅ |
| `sendero.ops_channel_intake` | channel intake → identity → next action | ✅ |
| `sendero.ops_rebook_refund` | evidence → options → approval → cancel or replacement search | ✅ |

### New workflow to add

**`sendero.arrival_playbook`** — fires after landing OR on traveler ask:

```
1. geocode_trip_stop(destinationStayAddress) → stop
2. parallel:
   - airport_arrival_playbook(airport, destinationAddress) → playbook
   - airport_transfer_coordinator(airport, destinationAddress) → transfer
   - restaurant_route_card(location, fromLabel=stay) → firstMeal
3. pause(via='originating_channel', share=combined) for traveler tap
4. (branch) if tap "book transfer": book_flight pattern adapted for ground transport
```

Dormant until a Duffel webhook emits a "landed" signal OR the traveler explicitly pings in-trip chat. No polling.

### Pause pattern — the non-negotiable

Every pause carries:

```ts
{
  reason: 'user_reply' | 'approval' | 'external_event',
  payload: {
    via: 'whatsapp' | 'slack' | 'email' | 'web' | 'originating_channel',
    promptId: string,            // stable id for adapter template mapping
    share: SharePayload,         // canonical shape — see catalog below
    resumeToken: string,         // URL-safe — the same token unlocks the run from any channel
  },
  timeoutMs: number,
}
```

The engine never branches on `via`. Adapters read `share` + `resumeToken` and translate. A traveler can start the pause on WA and finish it on web because the `resumeToken` is the same. This is the UX unlock.

### Durability budgets

| Pause | Timeout | Fallback |
|---|---|---|
| `await_duffel_ticket` | 48h | `cancel_booking` + refund |
| `await_selection` (ancillary) | 24h | book without ancillaries |
| `await_recovery_decision` | 6h | escalate to `ops_channel_intake` |
| `await_traveler_approval` (rebook) | 2h | escalate to agency_admin in Slack |
| `await_traveler_reply` (check-in) | 12h | mark nudge timed_out, keep trip active |
| `await_agent_handoff` | open-ended | operator drives |
| `await_guest_claim` | 30d | `cancel_booking` + refund to buyer |

All persisted. None polled.

## Share-shape catalog

One shape per card type. Rendered identically on every channel via adapters.

### Ancillary picker (existing)

```ts
{
  title: string,            // "Ancillaries on BA2490"
  body: string,
  bullets: string[],        // "Carry-on · 7kg · 25 GBP"
  offerId: string,
  bags: BagOption[],
  cancelForAnyReason: CfarOption[],
  seats: SeatOption[],
  currency: string,
}
```

Web: `AncillaryPickerCard`. WA: bullets + "Reply 1 = bag, 2 = seat, 3 = CFAR". Slack: Block Kit checkboxes in a single block. Email: non-interactive (visual only) with deep-link to web card.

### Disruption card (new)

```ts
{
  title: string,                  // "Flight cancelled · LIS → MAD"
  body: string,
  disruption: { kind, reason, originalDeparture },
  rebook: { offerSummary, price, delta, selectable: boolean } | null,
  refund: { amount, currency, destination: 'balance' | 'credit' | 'original_form' },
  primaryCta: { label: 'Rebook' | 'Refund' | 'Hand off', kind, resumeToken },
  secondaryCtas: [...],
  share: { bullets, whatsappUrl, slackMrkdwn, emailHtmlBlock },
}
```

### Check-in card (existing — extend)

Add `ics: string` (base64 ICS calendar data) to the existing `trip_checkin_reminder` share so email can attach it directly.

### Safety brief (existing)

Already carries composed `summary + weather + airQuality + timezone + elevation + riskLevel`. Adapter work is rendering it into Slack Block Kit blocks today — that's the gap.

### Arrival playbook (new)

```ts
{
  title: "Arrived at MAD · first 2 hours",
  body: string,
  arrivalSteps: Array<{ id, label, detail, href? }>,
  transfer: { mode, meetingPoint, routeMapUrl, backups[] },
  firstMeal: { name, shortAddress, priceTier, routeUrl },
  routeMapStaticUrl: string,    // static Maps image — attachable to WA / email
  share: { bullets, whatsappUrl, slackMrkdwn, emailHtmlBlock },
}
```

## Channel adapter matrix

| Share shape | WhatsApp | Slack | Email | Web |
|---|---|---|---|---|
| ancillary_picker | bullets + reply map | Block Kit checkboxes + ephemeral confirm | static render + deep-link | `AncillaryPickerCard` |
| disruption | headline + 2 inline CTAs | Block Kit `actions` w/ Approve/Deny/Counter | text + link to recovery board | `DisruptionCard` (new) |
| check_in | countdown + "check in now" CTA | `actions` + ephemeral ack | ICS attached + leave-by callout | `CheckinReminderView` |
| safety_brief | concise bullets + risk badge | Block Kit section per provider | HTML cards + `text` fallback | `SafetyBriefCard` (new) |
| arrival_playbook | single CTA + static map | thread post with steps | static map inline + meal card | `ArrivalPlaybookView` |
| invoice_receipt | link (WA attachment limits) | one-line Slack confirmation | PDF + publicUrl + tx hashes | existing invoice route |
| refund_receipt | amount + tx hash short | one-line ops confirmation | refund email + tx hash | new `/app/billing/refunds` row |

Adapter owners:
- WA: `packages/whatsapp/src/client.ts` + new `renderShareForWhatsApp()` helper that consumes `SharePayload`.
- Slack: `packages/slack/src/client.ts` + new `renderShareForSlack()` — maps primaryCta/secondaryCtas to Block Kit `actions`.
- Email: `packages/notifications/src/templates.ts` + new `renderShareForEmail()`.

One source function (`toWhatsAppText(share)`, `toSlackBlocks(share)`, `toEmailHtml(share)`) per channel. No bespoke rendering inside tool handlers.

## Email template additions

Existing: `invoice-email.ts` (Arc cream + Pretext orange palette, text fallback mandatory).

To add in `packages/notifications/src/templates.ts`:

| Template | Surface tag | Trigger | Attachments |
|---|---|---|---|
| `disruption_notice` | `surface=disruption` | cancellation_recovery start | diff card (PDF optional) |
| `rebook_confirmed` | `surface=rebook` | successful rebook ticket | new PNR + ICS |
| `refund_issued` | `surface=refund` | `send_tokens` refund lands | refund receipt + tx hash callout |
| `check_in_reminder` | `surface=checkin` | T-24h cron | ICS |
| `arrival_playbook` | `surface=arrival` | landing/tap | static map image |
| `ancillary_added` | `surface=ancillary_midtrip` | Duffel TSA mid-trip `book_flight` w/ services | updated itinerary |
| `guest_claim_ready` | `surface=guest_claim` | `sendero.guest_prefund` start | WA deep-link card |

Every template: HTML body + `text` fallback + Resend tags `{ tenantId, tripId, surface }`. The Resend `tag` discipline is how the finance team greps receipts later — enforce it in `sendInvoice`-style helpers, not ad-hoc per-template.

## Privacy + policy re-check points

Re-check `ToolContext.traveler.tenantId` + role at every tool handler boundary, plus:

- **Every workflow tool step** — the runner resolves the handler freshly per step; don't trust the caller's traveler snapshot.
- **Every webhook dispatch** — confirm `Booking.tenantId` matches before any state transition.
- **Every pause resume** — the resume token binds to a specific `(tenantId, runId)`; reject cross-tenant resumes with 404 (not 403, to avoid leaking existence).
- **Every email send** — don't include trip metadata in the subject that the recipient's identity doesn't already entitle them to.

Explicit role table (tool access):

| Role | Can | Cannot |
|---|---|---|
| traveler | search_flights, list_flight_ancillaries, book_flight (own trip), trip_checkin_reminder, list_airline_credits (own) | cancel_booking on others, manage_stays_negotiated_rate, policy override |
| guest | search_flights (within prefund), book_flight (within budget), list_airline_credits (own) | anything referencing other trips, settle_split, policy override |
| agency_admin | everything traveler can + manage_stays_negotiated_rate, override rebook, ops_* workflows, prefund_trip | finance-exclusive settle operations |
| finance | generate_booking_invoice, read-only access to settlements + meters | book_flight, cancel_booking, any write to trip state |
| traveler (post-claim guest) | own trip only | other travelers' trips even within same prefund cohort |

Audit trail: every support turn + policy override fires `log_agent_action` on-chain.

## Accessibility checklist per card

Applied across all share renderers:

- [ ] 44×44px minimum hit-target on every interactive control
- [ ] WCAG AA contrast (4.5:1 body, 3:1 UI) — verified per token combo in the brand book
- [ ] Keyboard tab order matches visual order; escape closes any overlay
- [ ] Every airline logo has a semantic `alt` (airline name + IATA), never empty
- [ ] `aria-live="polite"` on budget totals + countdowns
- [ ] `prefers-reduced-motion` respected — pulses and slide-ins collapse to opacity-only transitions
- [ ] Status never communicated by color alone (icon + label on every state chip)
- [ ] Text scales to 200% without layout breakage
- [ ] Screen reader announces CTA intent before destination ("Open route in Google Maps" not "Open")
- [ ] Form errors tied to fields with `aria-describedby`
- [ ] Motion pulses (live nodes) ≤ 2Hz — no flicker triggers

Per-card specifics:

- **Ancillary picker**: stepper buttons have `aria-label="Add checked bag"`, running total in `aria-live`.
- **Disruption card**: rebook vs refund have equal visual weight; icons for "cancelled" / "delayed" distinct from color.
- **Check-in card**: countdown is `aria-live="off"` until under an hour (avoid nagging SR).
- **Safety brief**: each risk row is its own `role="group"` with a title; aggregate risk is `aria-labelled` separately.
- **Arrival playbook**: ordered list is a real `<ol>`; step numbers are not decorative.

## Edge cases

| Case | Handling |
|---|---|
| Network loss mid-pause | `resumeToken` persists; traveler re-opens same URL and the pause state is intact |
| WA 24h message window | If pause exceeds the window, adapter falls back to email + "tap to continue in-app" link |
| Slack thread archived | Adapter posts a new message in the same channel with `thread_ts` reference; operator context intact |
| Duffel webhook retried | `WebhookEvent` table dedupes by `externalId`; repeat deliveries return 200 without re-firing |
| Cron missed fire | Next cron run checks `CheckInNudge.scheduledAt < now AND firedAt IS NULL`, fires catch-ups (capped at last 24h) |
| FX drift between quote and confirm | `await_duffel_ticket` resumption re-prices via `duffel.offers.get` before payment; delta >5% pauses for re-approval |
| Guest claim link expiry | 30d default; `cancel_booking` + refund to buyer on expiry, email both parties |
| Airline credit expires mid-flow | `list_airline_credits` state check; if credit expires between pick and book, auto-drop from payments[] + notify |
| Multi-tenant collision on ChannelIdentity | Scoped by `(tenantId, kind, externalUserId)` unique; whatsapp phone-number-id lookup table maps to tenantId |
| Duffel API 5xx | Retry with exp backoff inside the wrapper; after 3 tries, emit a workflow failure → operator escalation |
| Policy.version drift during approval | `hold_after_approval` step re-runs policy check against current version; blocks on policy regression |
| Operator Slack approval after timeout | Resume token 404s gracefully; Slack ephemeral "this decision expired" |
| Refund tx fails on-chain | Workflow loops back to `await_operator_override` — never silently drops a refund |
| Ancillary picker result changes (seat sold) | Re-fetch before book; if any selected service_id is gone, show a diff + re-confirm |
| Traveler opens on web what they started on WA | Resume token verifies; web loads the pause state from Prisma; WA thread sees an "opened on web" event |

## MVP scope vs later scope

### MVP (ship within 2 weeks)

1. Ancillary picker rendered on web + WA text fallback — Slack + email deep-link to web. ✅ web exists; WA adapter + email deep-link to add.
2. `book_with_ancillaries` fully wired + durable. ✅ exists.
3. Disruption recovery — WA + web renders, email notice, Slack approval for fare delta > 15%. Web card new.
4. Check-in nudge via cron + WA + email with ICS. ✅ tool exists; email template + cron hookup missing.
5. Arrival playbook composed card (no landing-webhook — traveler-tap only for MVP). New workflow.
6. Travel Support Assistant in-chat: works for seat + bag mid-trip. Uses existing tools.
7. Email templates: `disruption_notice`, `rebook_confirmed`, `refund_issued`, `check_in_reminder` (with ICS), `arrival_playbook`.
8. Airline credit redemption in `book_flight` — already shipped this branch. UI affordance in the composer is new.
9. Prisma migrations 11f (audit tables).
10. Slack approval adapter for ops fare-delta.

### Later scope

- Landing-detection (Duffel airline-initiated `flight.landed` event if/when Duffel ships it; otherwise traveler-tap is canonical).
- `manage_stays_negotiated_rate` full admin UI (tools exist; web UI form deferred).
- Multi-tenant WA phone-number-id → tenantId routing (today: single default tenant).
- Cars — no public API yet.
- `sendero.arrival_playbook` auto-trigger (currently traveler-initiated).
- Webhook-driven "trip complete" settlement verification.
- Risk-threshold auto-escalation (safety brief → ops_channel_intake when risk ≥ high).

## Recommended implementation order (atomic commits)

Each step is one commit. Each typecheck-passes before landing. Each is reviewable in ≤ 30 min.

### Phase 11f — Audit + cache tables (unblocks analytics + finance UI)
1. Prisma: add `AncillarySelection`, `DisruptionRun`, `CheckInNudge`, `SafetyBrief`, `ArrivalPlaybookRun`, `SupportTurn` (phase_11f migration). Client regen. No handler changes yet.
2. Write-through helpers in `apps/app/lib/{disruption,support,checkin,arrival}-sync.ts` — called from workflow step handlers via runner metadata.

### Phase 11g — Email template set
3. Add 5 new templates to `packages/notifications/src/templates.ts`: `disruption_notice`, `rebook_confirmed`, `refund_issued`, `check_in_reminder` (with ICS), `arrival_playbook`. HTML + text fallback + Resend tags.
4. Add `@sendero/notifications/src/ics.ts` helper to emit ICS strings from a booking.
5. Wire email sends into the existing workflows at terminal branches (`await_duffel_ticket.then[invoice]` already fires invoice; extend the `otherwise` branch to fire `refund_issued`).

### Phase 11h — WhatsApp + Slack share renderers
6. `packages/whatsapp/src/render-share.ts` + `packages/slack/src/render-share.ts` — two tiny mappers. Each reads `SharePayload`, emits channel-native format. Tested.
7. Refactor dispatch/webhook routes to call these helpers instead of inline rendering.

### Phase 11i — Arrival playbook workflow
8. New workflow `sendero.arrival_playbook` in `packages/workflows/src/catalog.ts`.
9. Composed `ArrivalPlaybookView` React component (AI-Elements, follows arrival_playbook share shape).
10. Register + LLM catalog + docs.

### Phase 11j — Disruption web card + Slack approval
11. `components/ai-elements/disruption-card.tsx` with rebook vs refund equal weight.
12. Slack approval adapter for ops fare-delta > 15%. Wire into `cancellation_recovery.then[rebook]` pause.

### Phase 11k — Check-in cron + ICS wiring
13. Cron job (Vercel cron or trigger.dev) that queries trips with departure in T-24h window, fires `sendero.check_in_reminder` runs.
14. Wire `check_in_reminder` template with ICS attachment.

### Phase 11l — Ancillary composer affordance + TSA chat hook
15. Extend `TripThreadComposer` with a "Pay with credit" split control + ancillary quick-add (seat / bag).
16. Wire `list_flight_ancillaries` into the mid-trip TSA path — the chat surface auto-detects an active icu_… and exposes the tool without re-entering search.

### Phase 11m — Accessibility + cross-channel QA sweep
17. A11y audit per card with the checklist above; fix gaps.
18. Cross-channel e2e — WA → web → Slack → email — one full loop per share shape. Dedicated report under `.gstack/qa-reports/`.

## Open questions for product

1. **Do we auto-trigger `travel_safety_brief` 48h before arrival, or only on traveler ask?** Default: on-ask for MVP; auto-trigger deferred to v2 behind a per-tenant flag.
2. **Does the arrival playbook surface restaurants by default, or wait for traveler prompt?** Default: surface if tenant has Google API key configured; skip otherwise. Controlled per tenant in `Tenant.metadata.features`.
3. **When an airline credit covers part of a new booking, who decides the split?** Default: auto — `min(creditAmount, orderTotal)` up to 100% of credit. Override UI lives in the ancillary composer (v2).
4. **What's the SLA on the refund email after `send_tokens` lands?** Target: within 60s of the tx. Resend retry policy: 3 attempts over 10min.
5. **Does `finance` get a single digest email or one per refund?** Default: one per refund tagged `surface=refund`; daily digest as an opt-in per tenant.

## Closing note

The thesis: **the AI agent + durable workflow engine + on-chain settlement + email receipts combine so the traveler's whole post-book journey happens inside one conversation that survives channels, devices, airlines, and time.**

Every piece of this spec is already on branch in atomic form — 48 tools, 16 workflows, 5 AI-Elements cards, 2 Prisma migrations pending deploy, 2 utility scripts. The work remaining is connective tissue, not new capability: email templates, share-shape adapters, audit tables, one new workflow (arrival playbook), one UI composer extension (credit split).

Two sibling documents accompany this spec:
- `docs/TECH_DEBT_AUDIT.md` — what's owed on the existing code
- `.gstack/qa-reports/qa-report-localhost-2026-04-23-trip-companion.md` — what the live app actually shows today
