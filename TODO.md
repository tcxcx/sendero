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
