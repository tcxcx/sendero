# WhatsApp E2E — Dogfood Phases

Living checklist for the multi-tenant WhatsApp channel test. Each phase is dogfoodable end-to-end, with explicit success criteria. Tick boxes as we prove each tool in production-like conditions.

**Branch:** `whatsapp-e2e`
**Tracking:** unchecked = unvalidated; ✓ = dogfood-confirmed this branch; ▲ = wired but unproven on traveler path.

---

## Phase 0 — Wallets (DONE ✓)

Foundation. EVM + Solana both first-class. Treasury (operations + treasury kinds) and traveler DCWs auto-deposit on inbound USDC. JIT SOL gas via platform hot wallet. Email + WhatsApp + Slack notifications.

- [x] `traveler_balance` — unified across EVM + Solana
- [x] `treasury_balance` — operator-only
- [x] `moonpay_topup` + `get_moonpay_topup_status`
- [x] `moonpay_offramp` + `get_moonpay_offramp_status`
- [x] `gateway_balance` (legacy alias)
- [x] `gateway_transfer`
- [x] `send_cta_url_message` (link UX)
- [x] Treasury sweep (`operations` + `treasury` kinds, `depositFor` to EOA)
- [x] Traveler self-deposit (DCW = depositor)
- [x] Solana JIT SOL gas (`ensureSolanaGas`)
- [x] Email notification (treasury) + Slack low-balance alert
- [x] WhatsApp notification (traveler)
- [x] Resend domain verified (`sendero.travel` DKIM/SPF/DMARC)

---

## Phase A — Buy a ticket (search → confirm → book)

**Goal:** Traveler types `flight from EZE to LIM May 7` and ends with a PNR + USDC settlement tx.

### Tools

- [ ] `search_flights` — Duffel offers
- [ ] `find_airports_nearby` — origin/dest disambiguation
- [ ] `display_offer_conditions` — fare class / refund policy
- [ ] `export_route_map` — confirm-card header image
- [▲] `send_interactive_list` — tap-to-pick
- [▲] `send_interactive_buttons` — Confirm/Cancel
- [ ] `create_passenger` / `ensure_flight_customer` — Duffel passenger record
- [ ] `check_policy` / `check_travel_eligibility` — tenant policy gate
- [ ] `book_flight` — Duffel order + USDC settle
- [ ] `confirm_booking` — server-side reconciliation
- [ ] `settle_booking` — Gateway spend on Arc

### Dogfood script

```
WhatsApp → "EZE to LIM May 7 1 pax economy"
  → expect interactive list with ≥1 offer
  → tap an offer
  → expect confirm card with price + carrier
  → tap "Confirm X USDC"
  → expect "✅ Booked · PNR ABC123" + arcscan tx link within ~10s
  → expect WhatsApp template "BOOKING_CONFIRMED" (HSM)
  → expect boarding-pass image card within 15s
```

### Success criteria

- [ ] `Booking.status = 'ticketed'` in Postgres
- [ ] `Booking.metadata.usdcSettlement.settlementTxHash` is a valid Arc tx
- [ ] WhatsApp template fires (`BOOKING_CONFIRMED`)
- [ ] Boarding-pass image dispatcher fires (out-of-band, ≤15s)
- [ ] `Trip.events` contains `booked` and `paid` entries

---

## Phase A.4 — Real airline notification (PDF e-ticket + airline-direct comms)

**Goal:** The airline emails/SMS the traveler directly with their own confirmation, AND the traveler receives a Duffel-issued PDF e-ticket via Sendero email + WhatsApp. No more placeholder contact details flowing to the carrier; no more "PNR-only" travelers stranded at check-in counters that don't support PNR retrieval.

**Why:** Today `book_flight` falls back to `traveler@sendero.demo` (`packages/tools/src/book-flight.ts:170`) and `+447123456789` (`packages/duffel/src/index.ts:313`) when contact details are missing. Duffel forwards those placeholders to the airline's reservation system, so the airline emails a fake address and the carrier-side IROPS / schedule-change comms never reach the actual passenger. We also never fetch `GET /air/orders/{id}/documents`, so the airline-issued PDF e-ticket is invisible to Sendero — even though it's already minted in Duffel post-fulfilment.

### Gates (block before booking)

- [ ] **Email gate** — if `User.email` is null/placeholder/empty when `book_flight` runs, agent must collect a real email before calling Duffel. Use `send_flow_message` (Meta Flow) with a single-field intake or an inline interactive prompt. Persist on `User.email` so subsequent bookings inherit.
- [ ] **Phone gate** — relax: traveler phone IS already known from WhatsApp identity (`ChannelIdentity.externalUserId`). Use that as `passenger.phone_number` to Duffel. Drop the `+447…` literal fallback.
- [ ] **Hard validation** — reject placeholder values (`@sendero.demo`, `+447123456789`) at the Duffel-create boundary so a future regression can't slip junk data through. Add a unit test in `packages/duffel/src/__tests__/`.

### Post-ticket dispatch

- [ ] **Fetch PDF e-ticket** — after `payOrder` returns `ticketed`, call `GET /air/orders/{orderId}/documents` (Duffel REST). Returns `{ documents: [{ unique_identifier, type: 'electronic_ticket', ... }] }`. Type `electronic_ticket` is the airline-issued e-ticket; persist its identifier + retrieve the PDF (Duffel returns it as a separate fetch on the document URL).
- [ ] **Persist on Booking** — add `eTicketDocumentUrl: String?` and `eTicketIssuedAt: DateTime?` columns to `Booking`. Migration in `packages/database/prisma/migrations/`.
- [ ] **Email dispatch via Resend** — `@sendero/notifications` already has the wiring; extend the existing `emailBookingConfirmed` (`apps/app/lib/duffel-dispatcher.ts:157`) to attach the PDF (or link out when attachment size is awkward). Subject: `[Carrier] e-ticket · PNR <ref>`. Localized via `@sendero/locale`.
- [ ] **WhatsApp dispatch** — new helper `apps/app/lib/booking-eticket-pdf.ts` mirroring `booking-boarding-pass.ts`: looks up channel identity + WhatsApp install, calls `client.send({ type: 'document', document: { link, filename, caption } })`. Attach to `firePostTicketingFanout` so it lands alongside the Satori boarding pass and the BOOKING_CONFIRMED template.

### Carrier-side flow (no Sendero code; verify it works)

- [ ] After ticketing, the airline's own systems (Aerolíneas Argentinas, LATAM, etc.) email the passenger at the now-real email address with their reservation confirmation. Sandbox carriers in Duffel don't send these; real carriers do. Verify in production smoke after the gates ship.
- [ ] Schedule-change / IROPS / check-in reminders flow through the same channel (carrier → passenger email/SMS). Sendero never sees these; the gate ensures the passenger does.

### Dogfood script

```
Sign up new traveler with NO email on file
  → search & confirm flight
  → expect agent to ask for email before book_flight (Meta Flow or inline)
  → reply with real email
  → expect User.email persists, book_flight proceeds
  → expect ticketed status
  → within ~15s expect THREE inbound channels:
     1. WhatsApp BOOKING_CONFIRMED template
     2. WhatsApp send_image_message (Satori boarding-pass card)
     3. WhatsApp send_document_message (airline-issued PDF e-ticket)
  → expect Resend email with PDF attachment to the address you just gave
  → check inbox of that email — airline's own confirmation arrives separately (1-15 min depending on carrier)
```

### Success criteria

- [ ] `User.email` is populated for every booked traveler before `book_flight` is invoked
- [ ] No `traveler@sendero.demo` or `+447123456789` value reaches Duffel (validated at boundary)
- [ ] `Booking.eTicketDocumentUrl` populated within 30s of `status='ticketed'`
- [ ] WhatsApp document message lands with the PDF
- [ ] Resend email lands with PDF attachment
- [ ] (Real carrier only) Airline's own confirmation email arrives at the real address within 15 min

---

## Phase B — Insufficient funds → top-up → re-book

**Goal:** Empty wallet doesn't dead-end. MoonPay top-up triggered, balance verified, same offer re-booked.

### Tools

- [ ] `book_flight` returns `insufficient_funds` shape (offer-ID preserved 30 min)
- [x] `moonpay_topup`
- [ ] `get_moonpay_topup_status` (poll on "listo")
- [x] `traveler_balance` (verify before re-attempt)
- [ ] `book_flight` re-call with same offer ID

### Dogfood script

```
Drain traveler balance → search & confirm a $50 flight
  → expect insufficient-funds card with QR + "Top up MoonPay" button
  → tap → MoonPay flow → "listo"
  → expect status check → balance update → auto-rebook
  → expect PNR
```

---

## Phase C — NFT issuance (boarding pass + TripPassport)

**Goal:** Booking mints a SenderoStamps boarding-pass NFT. `complete_trip` mints a TripPassport.

### Tools

- [▲] `mint_stamp` — TokenERC1155 via Circle SCP (Arc deploy shipped)
- [ ] `demo_mint_boarding_pass` — idempotent helper
- [ ] `refresh_stamp_uri` — re-pin metadata via Pinata
- [ ] `complete_trip({tripId, rating?})` — TripPassport mint
- [ ] `read_reputation` / `give_feedback` — ERC-8004 hooks
- [▲] `send_image_message` — NFT card delivery

### Dogfood script

```
Complete Phase A booking → wait ~15s
  → expect NFT image card in WhatsApp
  → visit https://app.sendero.travel/stamps/<tokenId> → renders boarding-pass art
  → say "ya estoy de vuelta"
  → expect complete_trip → TripPassport mint
  → expect reputation entry on /agents/<id>
```

---

## Phase C.5 — eSIM ready (in parallel with Phase C)

**Goal:** Post-ticketing the traveler receives a destination-country eSIM activation card alongside the boarding pass — installed via WhatsApp tap, no app store, no SIM swap. Mirrors the boarding-pass dispatcher pattern: HMAC-signed token → public install page + signed QR PNG → unfurl-safe.

### Tools

- [▲] `book_esim` — provisions an Airalo/equivalent supplier order, persists `Esim` row, generates HMAC-signed install token. Tool exists at `packages/tools/src/book-esim.ts`; unit tests in `book-esim.test.ts`. Status `▲`: implementation present, not yet exercised end-to-end on the dogfood tenant.
- [ ] eSIM tariff lookup / search (TBD — depends on supplier API integration; `book_esim` currently takes a destination country code + plan size)
- [ ] eSIM upsert wired to `Trip` lifecycle on `book_flight` ticketed → kicks `book_esim` for the destination country (parallel with NFT mint trigger)
- [▲] `/api/esim/qr/[token]/route.ts` — public PNG endpoint (allowlisted in `proxy.ts:49`); HMAC token in path gates the lookup
- [▲] `/install/esim/[token]` — public install page (allowlisted in `proxy.ts:50`); deep-links to platform eSIM activation
- [ ] `send_image_message` (eSIM card delivery) — Sendero-branded card with QR + install CTA
- [ ] `send_cta_url_message` — single-tap "Install eSIM" button to `/install/esim/<token>`

### Dogfood script

```
Complete Phase A booking → wait ~10s
  → expect "📡 Your eSIM for <country>" image card in WhatsApp
  → expect tappable "Install eSIM" CTA button below the image
  → tap → land on /install/esim/<token>
  → page renders QR + step-by-step iOS/Android instructions
  → scan QR with phone camera → eSIM activates
  → traveler now has data on arrival, no roaming charges
```

### Success criteria

- [ ] `Esim` row written to DB (`status='provisioned'`, `iccid`, `plan`, `countryCode`)
- [ ] HMAC token in `/api/esim/qr/<token>.png` URL verifies + returns valid PNG
- [ ] `/install/esim/<token>` renders with correct trip + country context
- [ ] Card delivered to WhatsApp within ~10s of ticketing
- [ ] Trip.events `esim_ready` entry appended (kind: `esim_ready`, primaryKey: `Esim.id`)

### Known dependencies

- Supplier API (Airalo / Holafly / etc.) — set `ESIM_SUPPLIER_API_KEY` + base URL in env
- HMAC signing secret — `ESIM_TOKEN_SIGNING_SECRET` (mirror of `OG_SHARE_SIGNING_SECRET` pattern)
- Tenant policy gate — should this be auto-included in every booking, or a tenant-configurable upsell? (default: auto for free/basic; upsell for pro/enterprise per markup config)

---

## Phase D — Document intake (passport OCR)

**Goal:** Passenger details captured via WhatsApp Flow form OR via image-based passport scan.

### Tools

- [ ] `send_flow_message({flowKey: 'trip_intake'})` — Meta Flow form
- [ ] `scan_document` — explicit upload OCR
- [ ] `scan_document_auto` — auto-classify image kind
- [ ] `create_passenger` (with OCR'd data)
- [ ] `validate_travel_address` — address normalization
- [ ] `request_validation` / `read_validation` / `submit_validation_response`

### Dogfood script

```
Search flight → at confirm step expect Flow form
  → submit name/dob/passport
  → flight books with extracted data

Separate path:
WhatsApp → upload passport photo
  → expect OCR result + "Passport saved" reply
  → next booking auto-fills via recurringTraveler.hasSavedPassport
```

---

## Phase E — Concierge during trip

**Goal:** Traveler asks weather/restaurants/transfers and gets useful answers grounded in their trip context.

### Tools

- [ ] `geocode_trip_stop` — address → lat/lng (called BEFORE every concierge tool)
- [ ] `trip_weather_brief`
- [ ] `air_quality_brief`
- [ ] `elevation_risk_brief`
- [ ] `timezone_brief`
- [ ] `travel_safety_aid` — embassy + alerts
- [ ] `recommend_restaurants`
- [ ] `restaurant_route_card`
- [ ] `airport_transfer_coordinator`
- [ ] `airport_arrival_playbook`
- [ ] `request_location` — WhatsApp native GPS share
- [ ] `request_phone_number`

### Dogfood script

```
After booking → "weather in Lima next week" → expect 7-day card
"restaurants near my hotel" → expect interactive list with ≥3 entries
Share location → expect transfer options list
"what's the altitude in Cusco" → expect elevation card
```

---

## Phase F — Check-in & lifecycle (cron-driven)

**Goal:** Trip events fire at the right time without traveler prompting.

### Tools

- [ ] `trip_checkin_reminder` — T-24h dispatch
- [ ] `trip_delay_replanner` — Duffel disruption webhook handler
- [ ] `/api/cron/check-in-reminder` — Vercel cron
- [ ] `/api/cron/arrival-playbook` — T+1h post-arrival

### Dogfood script

```
Book a flight scheduled in 25h
  → at T-24h expect WhatsApp: "Online check-in opens in 1h for PNR ABC"
  → at T-2h expect departure reminder
  → at T+1h post-landing expect arrival playbook

For testing without waiting: hit /api/cron/check-in-reminder with CRON_SECRET
```

---

## Phase G — `/me` web wallet UX polish

**Goal:** Web traveler portal at `/me/wallet` mirrors WhatsApp wallet card behavior.

### Tools / surfaces

- [▲] `/me/wallet` page hydration via Clerk session + balance stream
- [▲] DepositDialog, SendDialog, SwapDialog, BridgeDialog (mounted in AppChrome)
- [ ] `send_tokens` traveler path
- [ ] `swap_tokens` / `swap_and_bridge` / `bridge_to_arc` traveler path
- [ ] `/me/wallet/history` transaction feed
- [ ] WhatsApp magic-link → land on `/me/wallet` flow

### Dogfood script

```
WhatsApp → "open my wallet on web"
  → expect signed magic link via send_cta_url_message
  → tap → land on /me/wallet
  → see Arc + Solana balances matching WhatsApp card
  → tap Deposit → MoonPay flow
  → tap Send → recipient flow
```

---

## Phase H — Operations (cancel / change / group / handoff / billing)

**Goal:** Edge cases and operator-side flows wired.

### Cancel / change

- [ ] `cancel_order_quote` / `confirm_cancel_order`
- [ ] `request_order_change` / `select_order_change_offer` / `confirm_order_change`
- [ ] `cancel_booking` (pre-ticketed)
- [ ] `list_airline_credits`

### Group + prefund

- [ ] `prefund_trip` / `guest_claim_link`
- [ ] `claim_group_seat({token})`
- [ ] `create_group_trip` / `add_passenger_to_group_trip` / `remove_passenger_from_group_trip` / `remove_passenger`
- [ ] `send_pay_link` — off-app pay magic link

### Handoff

- [ ] `request_human_handoff`
- [ ] `log_agent_action`
- [ ] Slack mirror of WhatsApp threads (operator handoff destination)
- [ ] Liveblocks `agent:customer-support` notification

### Billing / invoicing

- [ ] `generate_booking_invoice` (PDF + email)
- [ ] `get_tenant_pricing_policy` / `activate_tenant_pricing_policy`
- [ ] `list_flight_ancillaries` / `manage_stays_negotiated_rate`
- [ ] `quote_fx` / `settle_split`

---

## Monitoring playbook

For each phase as we work it:

1. **Probe script** — `bun apps/app/scripts/_local/check-phase-<letter>.ts` reads recent webhook events, DB rows touched by the phase's tools, and tx hashes.
2. **Server log markers** — every tool invocation should emit a `[<tool-name>]` line; absence = wiring gap.
3. **Trip.events ledger** — Phase A→F append to `Trip.events` for cross-channel state continuity.
4. **Failure classification** — server error vs SDK error vs prompt error vs DB drift; only one of these is ours to fix per turn.

## Source-of-truth tool registry

`packages/tools/src/index.ts` is the canonical list. New tools register there + appear in `/api/openapi.json` automatically. Kapso graph (`apps/kapso-functions/sendero-tenant-travel-agent/graph.json`) consumes via the `sendero-tool-call` function.
