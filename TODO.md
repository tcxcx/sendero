# TODO

Product TODO for **Sendero** — prioritized around tools that reduce coordination overhead, not just tools that sell more travel.

> Baseline today: **Duffel** is our primary supplier for flights and stays. We should treat each new tool the same way: one clear owner, one initial provider, one fallback provider, and one workflow where the tool materially reduces ops work.

---

## Priority order

1. Visa / passport readiness
2. Intake-to-itinerary parsing from messy chat/email
3. Policy and approval orchestration
4. Ground transport + disruption recovery
5. Trip communications automation
6. Trip document pack generation
7. Expense capture + reconciliation
8. Vendor payout orchestration
9. eSIM sales
10. Travel insurance
11. Lounge access
12. Traveler memory / loyalty / preferences

---

## 1) Visa / passport readiness

### Why
Prevent trips from failing upstream by checking whether the traveler can actually board and enter.

### What to build
- Visa and transit requirement checks
- Passport expiration validation
- Destination health / entry docs
- Pre-departure reminders
- Missing-document alerts inside agent flows

### Initial provider
- **IATA Timatic** — best fit for travel-document requirements and restriction checks

### Candidate providers
- **IATA Timatic**
  - Travel document requirements, visa, passport, and health guidance
  - Useful surfaces: Widget / Web / AutoCheck depending on integration style
- Internal fallback: human-reviewed guidance queue for unsupported routes or edge cases

### TODO
- [ ] Add `sendero.check_entry_requirements`
- [ ] Add traveler profile fields for passport country, expiration date, residency, destination history
- [ ] Add reminder triggers at T-90 / T-30 / T-7
- [ ] Add “go / no-go” preflight gate in booking workflows
- [ ] Add manual override + operator note path

### Notes
- Best tool for reducing failed bookings and last-minute ops chaos
- This should be first-class in corporate and guest travel workflows

---

## 2) Intake-to-itinerary parsing from messy chat/email

### Why
This is likely one of the highest-ROI tools. Most requests arrive messy and incomplete.

### What to build
- Parse WhatsApp, Slack, email, and chat messages into a structured trip brief
- Extract traveler names, dates, city pairs, preferences, budget, policy constraints, and urgency
- Detect missing fields before quote generation
- Convert unstructured messages into workflow-ready objects

### Initial provider / stack
- **Internal Sendero tool** using Gemini + MCP + channel connectors
- Input sources: Gmail, Slack, WhatsApp, web chat, pasted text
- Optional document parsing:
  - **Google Gmail / Microsoft Graph** for email intake
  - **Google Places** for destination enrichment
  - OCR / PDF parser only when needed

### Candidate providers
- **Google Gemini** for extraction and structured normalization
- **Gmail API / Microsoft Graph** for email ingestion
- **Twilio WhatsApp** or WhatsApp BSP for message intake
- **Slack API** for travel desk channels

### TODO
- [ ] Add `sendero.parse_trip_request`
- [ ] Output a normalized `TripRequest` object
- [ ] Add missing-info detection and clarification prompts
- [ ] Add confidence score and human-review threshold
- [ ] Save parsed intent and entities into traveler / trip memory
- [ ] Support attachments: PDFs, screenshots, pasted itinerary fragments

### Notes
- This is the tool that makes the whole system feel agent-native
- Great place to use memory and workflow branching

---

## 3) Policy and approval orchestration

### Why
Critical for corporate travel, guest travel, and finance control.

### What to build
- Approval routing before booking
- Fare class / hotel cap / budget enforcement
- Exception requests
- Audit trail tied to trip and settlement

### Initial provider / stack
- **Internal Sendero workflow**
- Notifications and approvals in **Slack**, **WhatsApp**, and email

### Candidate providers
- Slack API
- Gmail / Microsoft Graph
- Internal policy engine
- Future ERP / travel policy integrations as needed

### TODO
- [ ] Add `sendero.check_policy`
- [ ] Add `sendero.request_approval`
- [ ] Add policy objects by tenant / traveler group / guest type
- [ ] Add exception capture with reason + approver + timestamp
- [ ] Add approvals into escrow and invoice trail

---

## 4) Ground transport + disruption recovery

### Why
Travel breaks after the flight is booked. This is where operational value compounds.

### What to build
- Airport transfers
- Rail / bus / intercity booking where relevant
- Rebooking after delays or missed connections
- Late hotel check-in and driver update flows

### Initial provider
- **Mozio** for airport transfers
- **Distribusion** for rail / bus / broader ground transport

### Candidate providers
- **Mozio**
  - Strong airport transfer coverage
  - Good fit for agencies and corporate travel
- **Distribusion**
  - Ground transport distribution API
  - Strong fit for rail / bus / intercity and TMC-like coverage

### TODO
- [ ] Add `sendero.book_transfer`
- [ ] Add `sendero.book_ground_segment`
- [ ] Add disruption recovery workflow triggered by flight status changes
- [ ] Add transfer auto-rebook logic for arrival delays
- [ ] Add hotel late-arrival communication action

### Notes
- Ground transport is one of the fastest ways to move from “booking tool” to “travel ops platform”

---

## 5) Trip communications automation

### Why
Many agencies and travelers do not want another app. Sendero should meet them in their existing channels.

### What to build
- WhatsApp trip updates
- Approval nudges
- Check-in reminders
- Delay / gate / transfer notifications
- Payment / escrow confirmations
- eSIM QR and voucher delivery in chat

### Initial provider / stack
- **Slack** and **WhatsApp** as first-class surfaces
- Email fallback for formal artifacts

### Candidate providers
- Slack API
- WhatsApp Business / BSP
- Gmail API / Microsoft Graph

### TODO
- [ ] Add `sendero.notify_trip_update`
- [ ] Add outbound message templates by event type
- [ ] Add channel preferences per traveler and per tenant
- [ ] Add message delivery / read-state logging
- [ ] Add operator takeover in-thread

### WhatsApp audio processing

#### Why
A lot of real travel requests arrive as WhatsApp voice notes, especially for urgent or mobile-first users. Sendero should be able to turn those into structured trip intents without forcing the traveler to type.

#### What to build
- Ingest inbound WhatsApp audio notes
- Normalize and compress audio before transcription
- Transcribe and extract trip intent, dates, destinations, traveler count, urgency, and policy cues
- Attach transcript + parsed entities to the trip thread
- Fall back to a human queue when transcription confidence is low

#### Initial provider / stack
- **WhatsApp Business / BSP** for inbound media webhook delivery
- **Vercel Workflows + Sandbox + FFmpeg** for durable audio preprocessing
- **Gemini** for transcription / extraction after normalization

#### Candidate providers
- WhatsApp Business / BSP
- **Vercel Workflows**
  - Durable workflow orchestration
  - Good fit for media jobs that should not block the request thread
- **FFmpeg in Vercel Sandbox**
  - Convert inbound voice notes to a consistent format before transcription
  - Example pattern: `createSandbox` -> `setupFfmpeg` -> `transcode` -> `streamOutput` -> `stopSandbox`

#### TODO
- [ ] Add `sendero.process_whatsapp_audio`
- [ ] Accept inbound audio from WhatsApp media webhooks
- [ ] Convert OGG/Opus and other inbound formats to a transcription-friendly normalized format
- [ ] Store transcript, summary, and extracted trip entities on the trip thread
- [ ] Add confidence threshold and clarification prompt when speech is unclear
- [ ] Add retry / dead-letter handling for failed media jobs
- [ ] Add cost and duration metrics for audio jobs


---

## 6) Trip document pack generation

### Why
Extremely practical for agencies, corporate desks, and guest travel.

### What to build
- Consolidated itinerary pack
- Hotel confirmations
- Transfer vouchers
- Visa support letters
- Interview / candidate travel letters
- Reimbursement-ready receipt bundle

### Initial provider / stack
- **Internal Sendero document pipeline**
- HTML → PDF generation
- Cloud storage + signed delivery links

### Candidate providers
- Internal renderer
- PDF generation service if needed
- E-sign provider later if approvals / traveler acknowledgements matter

### TODO
- [ ] Add `sendero.generate_trip_pack`
- [ ] Add branded PDF templates
- [ ] Add locale-aware formatting
- [ ] Add per-trip artifact bundle page
- [ ] Add resend / regenerate actions

---

## 7) Expense capture + reconciliation

### Why
This connects travel ops to finance and makes settlement legible.

### What to build
- Receipt capture from email / chat
- Invoice parsing
- Normalize booked vs paid vs refunded
- Export-ready finance records

### Initial provider / stack
- **Internal Sendero reconciliation layer**
- Intake from email / chat / uploaded docs

### Candidate providers
- Gmail API / Microsoft Graph
- OCR / document extraction vendor if needed
- ERP / accounting exports later

### TODO
- [ ] Add `sendero.capture_receipt`
- [ ] Add `sendero.reconcile_trip_spend`
- [ ] Add refund / credit memo tracking
- [ ] Add export format for finance teams
- [ ] Add discrepancy flags

---

## 8) Vendor payout orchestration

### Why
This is one of the most differentiated parts of Sendero given Arc, Circle, escrow, and guest travel.

### What to build
- Split settlements by vendor
- Partial escrow release
- Candidate / contractor / guest disbursements
- FX-aware payout recommendations
- Treasury routing logic

### Initial provider / stack
- **Arc + Circle + SenderoGuestEscrow**
- **Rain** for card / spend / stablecoin-linked money movement extensions

### Candidate providers
- **Circle** for treasury, wallets, and stablecoin rails
- **Rain** for stablecoin-powered cards, money-in, and payouts
- Banking / PSP partners later for fiat-only corridors

### TODO
- [ ] Add `sendero.route_payouts`
- [ ] Add split payout model per trip / vendor
- [ ] Add escrow-state-aware vendor release rules
- [ ] Add finance controls and replay-safe settlement jobs
- [ ] Add vendor payout dashboard

---

## 9) eSIM sales

### Why
High-convenience ancillary with strong fit for chat delivery.

### What to build
- Offer eSIM during booking or pre-departure
- Deliver QR install in chat
- Link package choice to destination and trip dates
- Add traveler support / re-send flow

### Initial provider
- **Airalo Partners**

### Candidate providers
- **Airalo Partners**
  - API and SDK options
  - Good fit for embedded eSIM sales and business integrations
- Backup option: a second eSIM wholesaler after launch if margin or coverage requires it

### TODO
- [ ] Add `sendero.offer_esim`
- [ ] Add `sendero.purchase_esim`
- [ ] Add QR code delivery in WhatsApp / Slack / email
- [ ] Add country / region package recommendation logic
- [ ] Add support and replacement flow

---

## 10) Travel insurance

### Why
Natural attach product that is useful when embedded into the booking flow.

### What to build
- Quote and bind in flow
- Offer based on trip type, traveler profile, and destination risk
- Claim support artifact bundle later

### Initial provider
- **battleface**

### Candidate providers
- **battleface**
  - Developer-facing partner API
  - Quote and bind model fits embedded travel workflows
- Secondary option later: region-specific insurers if compliance or pricing requires local alternatives

### TODO
- [ ] Add `sendero.quote_insurance`
- [ ] Add `sendero.bind_insurance`
- [ ] Add insurance upsell rules by trip type / destination
- [ ] Add policy artifact delivery
- [ ] Add claims-support checklist

---

## 11) Lounge access

### Why
Useful premium ancillary, especially for business and delayed travelers.

### What to build
- Offer lounge purchase or entitlement check
- Surface lounge access during long layovers or disruptions
- Deliver QR / pass in chat or app

### Initial provider
- **DragonPass** (API evidence is public)
- Explore **LoungePass** commercially as a partnership path

### Candidate providers
- **DragonPass**
  - Public developer platform with lounge E-pass / QR flows
- **LoungePass**
  - Strong commercial fit to explore, but partnership/API details should be confirmed directly

### TODO
- [ ] Add `sendero.offer_lounge_access`
- [ ] Add delay-triggered lounge upsell
- [ ] Add pass delivery and redemption status
- [ ] Compare DragonPass vs LoungePass economics

---

## 12) Traveler memory / loyalty / preferences

### Why
This is how the agent gets better over time and reduces repetitive ops work.

### What to build
- Airline / hotel loyalty numbers
- Seating and room preferences
- Visa history
- Preferred airports
- Baggage habits
- Communication preferences
- Approval tendencies by company or manager

### Initial provider / stack
- **Internal Sendero memory system**

### TODO
- [ ] Add traveler preference profile
- [ ] Add loyalty program fields
- [ ] Add inferred preferences from past bookings
- [ ] Add consent / privacy controls
- [ ] Add tenant-level retention rules

---

## Provider map at a glance

| Tool | Initial provider | Why |
|---|---|---|
| Flights + stays | **Duffel** | Already integrated baseline |
| Visa / passport rules | **IATA Timatic** | Travel document authority |
| Intake parsing | **Gemini + Sendero internal tooling** | Best product leverage |
| Ground transfers | **Mozio** | Airport transfer fit |
| Rail / bus / intercity | **Distribusion** | Broad ground network |
| eSIM | **Airalo Partners** | Embedded API / SDK |
| Insurance | **battleface** | Quote + bind API |
| Lounge access | **DragonPass** | Public API evidence |
| Stablecoin cards / payouts | **Rain** | Card and money movement fit |
| Channel delivery | **Slack / WhatsApp / Email** | Meet users where they are |
| WhatsApp audio processing | **Vercel Workflows + FFmpeg + Gemini** | Voice-note intake for mobile-first travel ops |

---

## Suggested implementation sequence

### Phase 1 — highest leverage
- [ ] `sendero.parse_trip_request`
- [ ] `sendero.process_whatsapp_audio`
- [ ] `sendero.check_entry_requirements`
- [ ] `sendero.check_policy`
- [ ] `sendero.request_approval`

### Phase 2 — operational moat
- [ ] `sendero.book_transfer`
- [ ] `sendero.book_ground_segment`
- [ ] `sendero.notify_trip_update`
- [ ] `sendero.generate_trip_pack`

### Phase 3 — attach revenue + treasury depth
- [ ] `sendero.offer_esim`
- [ ] `sendero.quote_insurance`
- [ ] `sendero.offer_lounge_access`
- [ ] `sendero.route_payouts`

### Phase 4 — finance and memory
- [ ] `sendero.capture_receipt`
- [ ] `sendero.reconcile_trip_spend`
- [ ] traveler memory and loyalty layer

---

## Decision rules

- Prefer tools that remove coordination overhead, not just tools that increase basket size
- Prefer providers with embeddable APIs and operationally realistic support paths
- Each tool should have:
  - one clear workflow owner
  - one initial provider
  - one fallback path
  - one measurable operational KPI
- Build for **Slack / WhatsApp / email first**, dedicated app second
- Tie every major action to trip state, approvals, and settlement state

---

## Tech debt — post-hackathon (traveler-wallet flow, Steps 1–6, 2026-04-25)

Items deferred during the hackathon push. Surfaced by `/review` + `/browse` e2e on
`ship/2026-04-24-platform-release` after Steps 3–6 + connection layer landed.
None are demo-blocking; all are real follow-ups before this flow goes to mainnet.

### Pay-link bearer credential — referrer leak

- [ ] Add `<meta name="referrer" content="no-referrer" />` to
  `apps/app/app/pay/[bookingId]/page.tsx` head, OR set
  `Referrer-Policy: same-origin` on the response. The single-use `?t=<token>`
  in the URL would otherwise leak via `Referer` header if the success state
  ever links out to an external page (it doesn't today, but the audit trail
  surfaces an explorer link in `result.txHash` rendering).

### Pay-link rotation tooling

- [ ] Build an admin "revoke this pay link" action (operator dashboard or
  internal tool) instead of leaving it as manual SQL
  (`UPDATE booking_pay_tokens SET consumedAt = now() WHERE id = …`).
  Bearer token, 30-min TTL, single-use — the surface is small but rotation
  on a leak should be a tool, not a runbook step.

### Booking reconcile retry queue

- [ ] `apps/app/lib/booking-reconcile/reconcile.ts` is fire-and-forget from
  `executeTransferSpend` with only `console.warn` on failure. If the booking
  flip throws (DB blip, tenant cascade race) the spend stays settled on-chain
  but `Booking.status` stays `pending`, and operators have to flip via Slack.
  Wire a retry queue (Trigger.dev task or Vercel Workflow) that re-runs the
  reconciler on `TransferAttempt(status='executed', metadata.bookingId NOT NULL)`
  rows whose booking is still `pending` after N minutes.

### Step 3 commit message attribution

- [ ] Step 3 of the wallet queue (treasury pre-fund + `kit.depositFor`) landed
  under commit subject `fix(agent-chat): prefer direct provider over gateway
  for streaming surface` (`bfb768c`) because a parallel Claude session's
  `git commit` swept up the staged files. The diff is correct; only the
  message lies. Fix via `git notes add bfb768c -m "Actually: Step 3 …"` or a
  follow-up `chore(notes)` empty commit pointing at it. Won't change behavior;
  just makes `git log --oneline` honest.

### TransferAttempt double-spend defense (defense-in-depth)

- [x] Pay-link path: race-safe token consume before spend (commit `1e94af7`).
- [ ] Add a unique partial index on `transfer_attempts (tenantId,
  metadata->>'bookingId') WHERE status IN ('executed', 'passed', 'pending')`
  so the database itself rejects duplicate in-flight spends for the same
  booking, regardless of which surface (settle-action, pay-action, agent
  dispatch, future) tries to create the row. Belt-and-suspenders with the
  per-surface idempotency checks already in place.

### Slack rebroadcast on spend-driven booking-confirmed

- [ ] When `reconcileBookingAfterSpend` flips a booking to `confirmed`, the
  Slack approval thread (if it exists for this booking) doesn't get an
  update. Operators see the email + WhatsApp confirmation but the original
  Slack approval card stays as "awaiting approval". Mirror the
  `chat.update` call from `slack/interactions/route.ts` so the spend-driven
  path closes the Slack card too.

### `prefund_traveler_balance` agent tool

- [ ] We shipped `send_pay_link` so the agent can dispatch the magic link.
  We did NOT ship a tool for the pre-fund step itself — operators can
  pre-fund only via the wallet-page UI. Mirror the same shape:
  internal route `/api/wallet/prefund` (auth: `AGENT_DISPATCH_SECRET`),
  tool `prefund_traveler_balance` in `@sendero/tools`, scope `treasury`,
  add to `PRIVILEGED_TOOLS`. Agent gains a fully programmatic
  end-to-end pre-fund + dispatch + reconcile loop.

### WhatsApp `cta_url` test coverage

- [ ] The fix in `apps/app/lib/channel-render/channels/whatsapp.ts` to
  render single `open_link` CTAs as `interactive.type: 'cta_url'` (instead
  of broken `reply` buttons) doesn't have unit-test coverage in the
  parallel session's new `__tests__/whatsapp.test.ts`. Add a snapshot
  test for the `cta_url` branch and the mixed-CTA inline-fallback branch.

### E2E test infrastructure for authenticated wallet UI

- [ ] The headless `/browse` e2e couldn't drive the operator wallet UI
  because the dev-mode `Agentation` overlay (rendered when
  `NODE_ENV === 'development'` in `apps/app/app/layout.tsx`) intercepts
  clicks. Either gate Agentation behind a separate env flag
  (`NEXT_PUBLIC_ENABLE_AGENTATION`) so QA can disable it, or move the
  e2e harness to `/open-gstack-browser` (real Chrome via the
  setup-browser-cookies skill).

---

## Open questions

- [ ] Which WhatsApp BSP should we standardize on?
- [ ] Do we want Timatic via widget first or deeper integration first?
- [ ] Do we want Mozio only for airport transfers and Distribusion for everything else?
- [ ] Is DragonPass the right launch provider for lounge access, with LoungePass as commercial backup?
- [ ] Should Rain be the first card / payout partner, or should we compare one more stablecoin-card stack?
- [ ] Which finance export should be first: CSV, ERP sync, or accounting API?

---

## Post-hackathon — platform-release ship/2026-04-24 follow-ups

Surfaced by /review on 2026-04-25 (hackathon-deadline session). All deferred,
none block the submission demo.

### P1 — fix in the first post-hackathon PR

- [ ] **MeterEvent FK violation on first-time Clerk sign-in** —
  `apps/app/app/api/agent/chat/route.ts:134` falls back to `a.userId`
  (Clerk-format string) when `prisma.user.findUnique({clerkUserId})`
  returns null. `MeterEvent.userId` is FK'd to `User.id` so the
  `onFinish` write throws P2003. Race window: between Clerk sign-up
  and the `apps/app/app/api/webhooks/clerk` user-created webhook
  landing. Fix: reject with 401 ("first sign-in still provisioning")
  OR auto-provision the User row inline. Option A is safer for
  billing integrity.

- [ ] **`submit_validation_response` enum schema fails Vertex** —
  `packages/tools/src/submit-validation-response.ts:53` defines
  `enum: [0, 100]` (numeric integers). Vertex AI's tool function-
  declaration schema requires string enums. Gateway is more lenient
  and accepts it; once we move chat traffic to Vertex direct (paid
  credits or ADC), every turn that includes this tool fails.
  Fix (1 line): drop the `enum`, keep `type: 'integer'`, document
  allowed values (0=fail, 100=pass) in the description.

### P2 — hardening, schedule when convenient

- [ ] **Slack bot avatar from app config** — the Slack setup wizard
  installs Sendero correctly but the bot ships without a profile pic
  (Slack defaults to the workspace avatar block). Two ways to fix:
  (a) upload the avatar in `https://api.slack.com/apps/{appId}` →
  Basic Information → App Icon (per-Slack-app, applies to every
  install), OR (b) add `users.profile:write` to `DEFAULT_BOT_SCOPES`
  and call `users.setPhoto` once on install with the Sendero
  vermillion mark. (a) is simpler and survives reinstalls; (b) lets
  each tenant theme it. Do (a) for the demo Slack app, leave (b) as
  a multi-tenant TODO.

- [ ] **Slack connected panel — debug tab** — operators need a way to
  see recent bot activity (postMessage out + events in) without
  leaving the dashboard. Add a "Debug" tab to
  `apps/app/components/channels/slack-connected-panel.tsx` showing
  the last 50 events captured at
  `apps/app/app/api/webhooks/slack/events/route.ts` plus outbound
  posts logged from `slack_send_test_message` and the workflow
  poster. Use the existing `MeterEvent` table or add a tiny
  `SlackEventLog` model — keep it append-only and 30-day TTL.

- [ ] **Console NanopayPanel: per-tool MeterEvent granularity** —
  `/api/chat`, `/api/agent/chat`, and `runAgentTurn` all write ONE
  `chat_reply` row per turn. The console's NanopayWorkflowsPanel
  surfaces per-tool ledger rows from the `useChat` stream as a
  visual proxy (heuristic prices via `PRICE_HINT_USD` in
  `apps/app/components/console/meta-inbox.tsx`). For truly
  authoritative per-tool prices, write one MeterEvent per
  `finish.toolCalls[]` step in `@sendero/billing/meter` +
  `runAgentTurn`. Schema already supports it via `toolName`. After
  this lands, drop `PRICE_HINT_USD` and source the ledger directly
  from `meterEvents`.

- [ ] **`/api/chat` flat $0.001 placeholder price** —
  `apps/app/app/api/chat/route.ts::onFinish` writes
  `priceMicroUsdc: 1_000n` per turn. Should match `/api/agent/chat`:
  resolve `segment = await resolveSegment(tenantId)`, call
  `priceFor({ action: 'chat_reply', segment, overrides: buildPlanOverrides(tier) })`,
  use the resolved micro-USDC. Also wire `preflight()` for cap
  enforcement so console turns can't blow through the same plan
  cap dispatch respects.

- [ ] **`/api/meter/stream` EventSource cookie-only auth** —
  `apps/app/app/api/meter/stream/route.ts` reads the Clerk session
  from cookies (browser EventSource sends them automatically). Fine
  for `/dashboard/*` use, but any non-browser consumer (CLI, Node
  test harness) needs a cookie jar. Document or accept an API key
  via query param as a fallback if we ever surface this stream
  outside the dashboard.

- [ ] **Share-image token has no TTL** —
  `apps/app/lib/og/share-url.ts`. Once signed, valid forever. JSDoc
  explicitly accepts this for unfurl-bot caching. Add a `signedAt`
  field + max-age check before any leak/rotation event makes it
  load-bearing.

- [ ] **Split `INVOICE_SIGNING_SECRET` -> dedicated `SHARE_SIGNING_SECRET`** —
  Currently both invoice signing and share-image signing share one
  secret. Rotating breaks both at once. Add a getter in
  `@sendero/env`, prefer it with fallback to `INVOICE_SIGNING_SECRET`,
  document the migration path.

- [ ] **`/api/og/share` rate limit** — public route, edge runtime,
  fail-soft on bad token. Each VALID token triggers a Satori render
  (CPU). Add Upstash-Redis-backed per-IP rate limit (e.g. 30/min).
  Cache-control `public, max-age=86400, immutable` already mitigates
  the cache-fronted case.

- [ ] **`CREATE INDEX CONCURRENTLY`** in three migrations on this
  branch (`20260424_slack_user_binding`, `20260425_transfer_attempt_kind`,
  `20260425_wallet_dcw_fields`). Lefthook already warns. All three
  tables are young (<few hundred rows in dev) so the lock is sub-
  second today, but follow the runbook on next migration.

### P2 (cont.) — channel platform Stages 2 + 3

Plan: `~/.gstack/projects/tcxcx-sendero/ship-2026-04-24-platform-release-multi-tenant-channel-apps-plan-20260427-140826.md`. Stage 1 approved + ships separately. Stages 2 + 3 deferred until customer demand surfaces.

- [ ] **Channel platform Stage 2 — tenant brand fields + branded public install page** (~4-5 days). Trigger: first paying TMC asks for "remove Sendero footer / use my brand on the install page." Adds `Tenant.brandDisplayName/brandLogoUrl/brandAccentColor/brandLongDesc` columns, gates white-label public install page to Pro+ tier, ships trust signals (logo at 96px, scopes in human language, social proof). Tier-gating tone: "Hosted on Sendero" partner footer (NOT "Upgrade to remove" coercion — Design subagent finding).

- [ ] **Channel platform Stage 3 — full per-tenant `SlackApp` + `WhatsAppApp` model** (~2 weeks; was 1, doubled after review). Trigger: signed TMC contract specifically requires "Acme TravelDesk" branded bot in customer workspaces. Implementation MUST include all of:
  - Managed KMS encryption (AWS KMS or Vercel Marketplace; NOT a hand-rolled `@sendero/crypto` package)
  - Slack distribution policy validation BEFORE building (Marketplace listing path or Slack Connect / shared-channels reframe)
  - Per-app URL routing only after `slackAppId` column lands and a header-based dispatch cut-over completes
  - Credential rotation dual-verify columns: `signingSecretEncPrevious Bytes?` + `previousValidUntil DateTime?` (without these, every rotation = 5min silent dead-air)
  - Slack manifest YAML pre-fill in wizard (cuts TTHW from 25min → 8min for ~30 LOC)
  - Error envelope pattern `{ code, message, fix, docsUrl }` referenced from `docs/channels/error-codes.md`
  - Per-tenant generated runbook at `/dashboard/channels/slack/[slackAppId]/runbook` (templated MDX, NOT a hardcoded `docs/slack.md`)
  - New `channels.admin` scope for `slack_app_create/update_brand/pause/rotate_signing_secret` tools; update `toolToScope()` in `packages/auth/src/dispatch-auth.ts`
  - Apps list at 50 rows: filter chips, search, primary/secondary/tertiary visual hierarchy
  - Full missing-state matrix per surface (loading / empty / error / partial / paused / "already installed")
  - Wizard credential paste UX (monospace, paste-only, validate shape, last-4 confirm, never echo secret)
  - Routing model: app-level rules + per-install overrides
  - Public install Persona C success page + tenant email notification on new install
  - Will-haunt-implementer specs (icon dimensions/format/storage, accent color picker, wizard back-nav, verify-failure retry, multi-app-same-workspace UX warning)

### P3 — confusing-but-not-broken

- [ ] **AI Gateway "Free credits restricted" error is misleading on
  paid accounts** — `tcxcxs-projects` Vercel team has $4.62 paid
  balance + $0.38 used. The gateway's abuse-protection error
  message implies free-tier even when balance is paid. Likely a
  model-specific rate limit on the preview-tier `gemini-3.1-pro-preview`
  / `gemini-3-flash` handles. Verify by switching to a stable
  model (`gemini-2.5-pro`) and confirm the error class clears.
  Root cause: Vercel AI Gateway error taxonomy. File issue
  upstream after demo.

- [ ] **Dev server's Turbopack module cache holds stale
  `apps/app/lib/agent-models.ts`** — even after a kill+restart, the
  Vertex direct path (`directModelFromString` for `vertex/...`)
  doesn't activate without a hard cache wipe. `bun run` works
  immediately. Workaround: `rm -rf apps/app/.next-turbo` before
  `bun dev`.

- [ ] **Cross-file `Date` mock pollution** in
  `apps/app/lib/channel-render/__tests__/`. Slack approval-block
  snapshot freezes Date in `beforeAll`; needs an `afterAll` cleanup
  to stop pollution into other test files. 73/73 pass file-by-file;
  72/73 when run together. Fix: add `afterAll(() => { ... })`
  restoring the original Date global.

### P4 — tech debt / cosmetic

- [ ] **Unused deps from failed AI Elements CLI runs** —
  `@radix-ui/react-progress` and `@radix-ui/react-scroll-area` (0
  usages each). `apps/app/components/ui/accordion.tsx` and
  `apps/app/components/ai-elements/inline-citation.tsx` are wrapper-
  only with no downstream consumers (~25KB combined gzipped). Remove
  in a cleanup PR.

- [ ] **Concurrency-collision commit messages** — eight commits
  this session bundle parallel session WIP into my commit messages
  (e.g. `6434c10`, `9703425`, `5ad55e8`, `bfb768c`, `6a96e1f`,
  `d6e1cc7`). PR squash-merge collapses. Don't try to rewrite local
  history.

- [ ] **Wallet-dropdown 404 spam on unprovisioned org** — `GET
  /api/wallet/balance?address=…` 404s when the org's `arcWalletAddress`
  in Clerk metadata points at a placeholder (e.g. dogfood's
  `0x1111…1111`) that has no `CircleWallet` row. The 404 is correct
  behavior (route can't tell "not provisioned" from "not yours"
  without leaking) but the UI fires this on every dashboard mount,
  filling console with red. Found by /qa cycle 31 (2026-04-26). Two
  fixes: (a) `wallet-dropdown.tsx:62` skips fetch when the address
  matches the placeholder pattern, or (b) the route returns 200 with
  `{ provisioned: false }` for wallet-not-found-in-tenant and keeps
  401/404 only for auth/tenant lookup. (b) is the right fix but
  bigger blast radius — every caller of /api/wallet/balance.

---

## Booking margin split (spec)

Today `confirm_booking` settles everything into the tenant's Operations
surface (Circle Gateway depositor / Squads V4 vault DCWs). Treasury
shows but no booking-margin flow lands there. Needs its own spec.

### Why it matters
On every booking, Sendero takes the lion's share of the markup because
**we front the supplier payment to Duffel out of platform liquidity**.
The tenant's markup is layered on top of Sendero's, not under it.
Conflating "settle the booking" with "split margins" was the right call
for v0 — for v1 the wallets that get credited need to encode who owns
the money:

| Source                              | Destination                                      | Owner               |
|------------------------------------- |--------------------------------------------------|---------------------|
| Vendor wholesale (Duffel net rate)   | Sendero platform vault (cross-tenant treasury)   | Sendero (us)         |
| Sendero markup (Duffel resale spread + take-rate) | Sendero platform vault                | Sendero (us)         |
| Tenant markup (configured per product) | Tenant Treasury (Squads V4 / Arc MSCA)          | Tenant agency / TMC |
| Tenant operating cap (Gateway pull)  | Tenant Operations (Gateway DCWs)                 | Tenant agency / TMC |

### Acceptance criteria
- `confirm_booking` performs a 3-way (or 4-way) on-chain split in a
  single tx: vendor net → platform vault, Sendero markup → platform
  vault, tenant markup → tenant Treasury, tenant operating cap →
  tenant Operations.
- Splits are computed from `TenantPricingPolicy.markupConfig` +
  Duffel net rate at settle time. No off-chain reconciliation step.
- Per-booking ledger row in `Settlement` carries each leg explicitly
  so the operator dashboard can show "this trip contributed $X to
  Treasury, $Y to Operations, $Z to Sendero" without re-deriving.
- The Treasury wallet dropdown's balance must now reflect inflows
  from settled bookings. Treasury balance fetch needs to go through
  Squads vault SDK / MSCA balance — not the existing
  `/api/wallet/balance` route (Circle DCW-shaped, returns 0 for
  vault PDAs).
- RBAC: Treasury Send is multisig-gated (see
  `apps/admin/lib/treasury/propose-solana.ts` for Sol;
  `@sendero/multisig/userop-builder` for Arc). Operations Send /
  Swap / Bridge stay autonomous (agent-driven via Gateway).

### Why it's its own spec
The settlement contract on Arc (`SenderoGuestEscrow.sol`,
`AgenticCommerce.sol`) and the Anchor programs (`sendero_guest_escrow`,
`agentic_commerce`) both encode a single destination today. Adding the
4-way split requires either (a) extending the on-chain commit to take
N destinations + amounts, or (b) a post-settle sweep step that fans
out from the single destination to the four sinks. (b) ships faster
but loses the atomic guarantee that the split actually happens; (a)
requires a contract upgrade. Pick the right tradeoff in the spec
before writing code.

### Not in scope
- Cross-tenant netting (Sendero platform vault → tenant Treasury
  payouts for promo credits, refunds, etc.). Separate spec.
- Sendero's own treasury management (where does the platform vault
  hold liquidity, multisig governance over it, etc.). Separate spec.

---

## Tenant-set markups on products (user story)

### User story
> As a tenant operator (TMC / agency), I want to set my own markup on
> top of every product Sendero offers through my channels — flights,
> stays, ground transport, eSIM, lounge access, insurance, ancillaries
> like seat selection or bag fees — so that my margin is configurable
> per product and per route without me having to renegotiate with
> Sendero or touch the contract.

### Background — why this is layered on top, not replacing Sendero's
- Sendero fronts the wholesale supplier payment (Duffel net rate +
  inventory deposits to Stripe-fronted ancillary providers).
- That capital risk is real. Sendero's markup on top of the wholesale
  rate covers the float, the dispute exposure, the chargeback risk,
  and the underlying provider operational cost.
- So **the majority of the markup goes to Sendero** by construction.
- Tenant markup is a **second-layer spread** applied on top of the
  Sendero-side price the agent quotes to the traveler. The tenant
  picks a per-product (and optionally per-route, per-supplier, per-
  traveler-class) markup; the agent rolls it into the quoted price;
  on settle, the tenant markup flows to the Tenant Treasury.

### Acceptance criteria
- `TenantPricingPolicy.markupConfig` extends to support per-product
  granularity. Today it has `{ flight, hotel, rail, car, other }`;
  expand to:
  ```
  {
    flight: { strategy, bps | flat, perRouteOverrides[] },
    hotel: { strategy, bps | flat, perCityOverrides[] },
    ancillaries: {
      seat_selection: { strategy, bps | flat },
      bag_fee: { strategy, bps | flat },
      insurance: { strategy, bps | flat },
      esim: { strategy, bps | flat },
      lounge: { strategy, bps | flat },
    },
    ...
  }
  ```
- Operator UI to edit each value. Live preview of "your markup on a
  $500 SFO→LHR flight: $X" so the operator sees what they're charging.
- Plan-tier guardrails on the spread: free / basic tier caps the
  total markup so resellers can't price-gouge their travelers. Pro /
  enterprise unlocks higher ceilings.
- Per-channel override (optional, post-MVP): a TMC's WhatsApp number
  for traveler X could carry a different markup from their Slack
  channel, e.g. higher margin for off-platform direct travelers.
- Agent surfacing: when the tenant updates a markup, every in-flight
  quote refreshes (or carries an explicit "price expires when policy
  changes" disclaimer to the traveler).
- Audit trail: `TenantPricingPolicy.version` increments on every
  change; the active version is recorded on each `Booking` so we can
  trace what markup was applied to a historical trip.

### Why this matters strategically
- Today the tenant gets a flat take-rate discount from their billing
  tier (5% basic, 10% pro, 15% enterprise on Sendero's markup). That's
  a kickback model, not a margin model. Tenants don't get to *price
  their own product*.
- Letting tenants set markup makes Sendero the platform their book
  runs on rather than a margin competitor. It's also the only way
  Tier 3 ("Stay for Network", per the wedge findings) makes sense —
  resellers won't co-brand a channel if the prices are dictated.
- Ancillary markup is the prize. Seat selection, bag fees, lounge
  access, insurance, eSIM — each is a Duffel/Stripe wholesale rate
  Sendero exposes. Tenants who set their own ancillary spread can
  build a P&L on top of Sendero without owning the supply.

### Dependencies / sequencing
- Settlement split (above spec) must land first — the tenant markup
  needs a destination wallet to flow into. Without the on-chain split,
  there's no Treasury sink for tenant margins.
- Per-product pricing requires the agent to know the product
  taxonomy at quote time. Flight/hotel/rail are already separated
  in `confirm_booking`. Ancillaries need explicit kind tags on the
  Duffel offer parse.
- Operator UI surface (probably `/dashboard/money-policy/pricing`)
  needs design pass.

### Not in scope (yet)
- Dynamic / rule-based markup ("apply 12% on routes ≤ $500, 8% above").
  v1 is flat per-product rates with optional route overrides. Rule
  engine is post-network-effect.
- Travelers seeing the markup breakdown. Tenant markup stays opaque
  to the end customer by default — they see one price.

---

## Treasury balance — Solana RPC fallback

Treasury balance in the wallet dropdown reads from `CircleWallet.
usdcBalanceMicro`, which is the Circle webhook's cached column. For
Arc MSCAs this is the canonical authority. For Sol Squads V4 vault
PDAs it's a **convenience cache** — the on-chain truth lives in the
vault's USDC associated-token-account (ATA), and there's no guarantee
Circle's Sol balance sync covers vault PDAs the same way it covers
their DCW wallets. The vault PDA itself is a CircleWallet row (created
by `provisionTenantSolanaTreasury`), but its on-chain holdings can
diverge from the cached column if:

- The Circle webhook for that wallet kind doesn't fire (Squads vaults
  aren't a Circle-managed wallet in the usual sense; they're just an
  address Circle's listWallets API returned).
- Funds land via paths Circle doesn't observe (manual user deposit,
  cross-program invocation from a sweeper, on-chain settlement from
  a future booking-margin split).
- The webhook is slow and the operator wants the live value now.

For hackathon parity we treat `CircleWallet.usdcBalanceMicro` as the
single source. Post-hackathon we should add a Solana RPC fallback that
queries the vault's USDC ATA directly via `getParsedTokenAccountsByOwner`.

### Why
Today the Treasury USDC card shows `0` even when funds have landed via
a path Circle doesn't observe. That breaks operator trust in the
balance widget and makes the booking-margin split spec (above) much
harder to debug — operators won't know whether a missing balance means
"split didn't fire" or "balance widget is stale".

### What to build
- New helper in `apps/app/lib/solana-balance.ts` (or extend the
  existing `apps/app/lib/prefund-submit/sol.ts`): wraps
  `@solana/web3.js` `Connection.getParsedTokenAccountsByOwner(vault,
  { mint: USDC_DEVNET_MINT })`. Returns `{ usdcMicro, ata, updatedAt }`.
  The pattern lives in `apps/app/scripts/_local/diagnose-sol-deposit.ts`
  — copy verbatim into a server-only helper.
- Extend `/api/wallet/balance` (or add a `?live=1` flag): when the
  tenant's primaryChain is `sol` AND the queried address is the
  treasury vault, hit Solana RPC after the DB read and reconcile:
  if RPC's number is higher than the cached column by more than a
  threshold (say 1 USDC), use the RPC value and persist it back to
  `CircleWallet.usdcBalanceMicro` (so the next webhook fires don't
  regress).
- Client side: WalletDropdown's refresh button hits the live path
  unconditionally. SSE stream stays cached (don't spam RPC from
  many subscribers).

### Files to touch
- `apps/app/lib/solana-balance.ts` (new) — RPC helper.
- `apps/app/app/api/wallet/balance/route.ts` — opt-in `?live=1`
  branch for Sol vault addresses.
- `apps/app/components/wallet-dropdown.tsx` — refresh button passes
  `?live=1` when mode=treasury.
- `packages/circle/src/balance-sync.ts` — confirm whether Sol vault
  PDAs are skipped by the webhook sync today; if so, add them or
  document that the RPC fallback is the canonical reader.

### Dependencies
- `@solana/web3.js` already in tree (used by `prefund-submit/sol.ts`).
- `SENDERO_SOLANA_RPC_URL` env (already set, falls back to devnet).
- `SENDERO_SOLANA_USDC_MINT` env (already set).

### Not in scope
- Live RPC for Arc MSCAs. Circle webhook is the canonical authority
  there and we don't want every dashboard mount to viem-poll Arc.
- Per-DCW live reads on Operations side. Gateway already has
  `/api/gateway/balance` with its own fetch path; Treasury is the
  only mode where the DB-cached value is at risk of being a lie.
