# Duffel split-ticket integration

> **Status**: Design doc. Implementation lands on branch
> `tcxcx/duffel-split-ticket` (based on PR #48 head).
> **Owner**: gateway-v5 follow-up.

## What's a split ticket

A split-ticket itinerary is a multi-slice trip made of independent one-way
offers — often from different airlines — instead of a single round-trip /
multi-city ticket from one carrier. Duffel exposes this via
`include_split_ticket: true` + `view=itineraries` on the offer-request POST.
Each slice's `split_ticket` offer is its own bookable unit: one Duffel order,
one PNR, one airline-side reservation per slice.

Reference: <https://duffel.com/docs/guides/selling-split-ticket-itineraries>.

Per Duffel: median **300% more bookable itineraries** + 25% more combinable
departure times. The trade-off — Duffel's words — is "you expose more choice
to the customer, but you take on managing the slices separately."

## Why

Sendero today shows only `single_ticket` offers. On routes where two
one-ways from different carriers are cheaper or schedule-better than any
single round-trip, we silently lose the customer (or the booking) to a
competitor that surfaces both.

For corporate-travel buyers — our B2B customer — schedule flexibility is
often higher-value than airline brand consistency. Direct-flight pairs of
two short-haul carriers can beat one-stop round-trips on flag carriers.

## Today's flight surface (file:line refs)

| Component | File | Today |
|---|---|---|
| Duffel adapter — search | `packages/duffel/src/index.ts:182` (`searchFlights`) | Posts `offer_requests`, slices already projected per leg, returns flat `FlightOfferSummary[]` |
| Duffel adapter — hold | `packages/duffel/src/index.ts:452` (`createHoldOrder`) | One `offerId` → one Duffel order |
| `search_flights` tool | `packages/tools/src/search-flights.ts:78` | Calls `searchFlights`, returns `{ offers, share }` to the agent |
| `book_flight` tool | `packages/tools/src/book-flight.ts:456,485` (`createHoldOrder` call sites) | One booking per invocation |
| `confirm_booking` tool | `packages/tools/src/confirm-booking.ts` | Settles one Booking, writes per-Booking journal entries (Gateway v5) |
| `Booking` model | `packages/database/prisma/schema.prisma:1079` | `tripId → Trip` (1:N); `duffelOrderId @unique`; `pnr`; markup + take fields |
| `Trip` model | `packages/database/prisma/schema.prisma:857` | Many bookings; carries the merged conversation/inbox |
| Channel-render — flight card | `packages/tools/src/search-flights.ts:299` (`buildSearchFlightsShare`) | Single share card showing top offers |
| Gateway escrow | `packages/tools/src/guest-escrow.ts` + `SenderoGuestEscrow.sol` | One reserve → commit cycle per Booking |
| Journal entries | `packages/circle/src/journal.ts` (PR #48) | `transactionId` per logical settlement; legs balanced via deferred trigger |

## Architecture changes

Three layers, smallest-to-biggest blast radius:

### Layer 1 — Adapter (`@sendero/duffel`)

- New `FlightSearchParams.includeSplitTicket?: boolean`. Default false.
- When true, the request body adds `include_split_ticket: true` and the URL
  carries `view=itineraries` as a query param (the SDK passes through
  `extra` params or we go to fetch directly — TBD which is cleaner).
- New response surface: when `includeSplitTicket=true`, return a discriminated
  union: `{ kind: 'flat', offers: FlightOfferSummary[] }` (existing shape) OR
  `{ kind: 'itineraries', slices: ItinerarySlice[] }` where `ItinerarySlice`
  carries:
  - `originCode`, `destinationCode`, `departureDate`
  - `singleTicketOffers: FlightOfferSummary[]` — same as before but
    constrained to this slice (note: a single-ticket offer covers the whole
    trip — it appears under slice 0 with a flag, OR we surface them at the
    response root)
  - `splitTicketOffers: FlightOfferSummary[]` — one-way offers for this slice
- Each `FlightOfferSummary` gains `offerType: 'single_ticket' | 'split_ticket'`.

The cleanest shape: keep `{ singleTicket: FlightOfferSummary[], slices: [...] }`
at the response root. `singleTicket` carries multi-slice offers like today;
`slices` carries per-slice split-ticket offers. The agent picks ONE single
OR pairs of split per slice — never mixes.

### Layer 2 — Tool layer (`packages/tools`)

- `search_flights` extends to accept `includeSplitTicket?: boolean` (default
  reads from `tenant.config.flights.allowSplitTicket`). When true, output
  carries both `singleTicketOffers` and `splitTicketSlices[]`.
- **New tool: `book_trip`** that orchestrates N `book_flight` calls under one
  `tripId` + state machine. Keeps existing `book_flight` semantics intact
  for single-slice / single-ticket bookings.
- `confirm_booking` is per-Booking-row already, so it works as-is — each
  slice's Booking gets its own `confirm_booking` call. The shared `tripId`
  is what stitches them together at the merged-thread / journal-rollup
  level. **No changes to confirm_booking core**.

### Layer 3 — Channel-render

- New `ChannelMessage` kind: `flight_search_with_split` (or extend existing
  `flight_search` with a `mode: 'flat' | 'split'` discriminator).
- Web operator card: side-by-side compare — left column "single ticket"
  options, right column "split ticket" combos (we precompute the best
  per-slice pairs cheapest-first, top 3 combos).
- Slack: AI Elements `Card` with two `Tabs` (single vs split). Each tab
  has a numbered list of options, customer replies with number.
- WhatsApp interactive list: max 10 items per message. We pick the top
  single + top split-ticket combo, render both, link to "more options" web
  short-link if there are more.
- Each split-ticket combo is presented as one logical "option" — the
  customer doesn't pick two things, they pick one combo we precomputed.

## Partial-success state machine (load-bearing)

A multi-slice booking flow has 2+ Duffel orders, each independently fallible.
The chosen pattern: **hold every slice first, then pay every hold atomically.**
This sidesteps "money moved on slice 0 but slice 1 failed pricing" — the
worst recovery case.

```
states (per Trip):
  pending                 → no Duffel orders yet
  holding                 → at least one createHoldOrder in flight
  all_held                → every slice has a Duffel order in `awaiting_payment`
  paying                  → at least one payFromBalance in flight
  all_paid                → every slice paid + ticketed
  failed                  → terminal; some slices may be cancelled/refunded

transitions:
  pending → holding         book_trip starts
  holding → all_held        last createHoldOrder resolves cleanly
  holding → failed          a createHoldOrder errors → cancel any already-held
  all_held → paying         all Bookings reserved on Gateway escrow
  paying → all_paid         last payFromBalance settles + Duffel ticketing
  paying → failed           a payFromBalance errors → refund paid slices,
                            release held-not-yet-paid slices
  any → manual_review       on opaque failure (e.g. Duffel timeout); ops
                            queue picks up via /dashboard/handoffs
```

**State storage**: `Trip.metadata.splitTicketState` (Json) — single source.
Each Booking still carries its own status; the trip-level state is a rollup
plus the chosen recovery action when there's a mismatch.

**Idempotency keys**: `${tripId}:slice:${index}:hold` and
`${tripId}:slice:${index}:pay`. Per-slice keys so a retry of `book_trip` is
safe — already-held slices skip re-hold, already-paid slices skip re-pay.
The function reads each slice's current state, advances only the laggards.

**The recovery branch** (`paying → failed`) is the riskiest. Two sub-paths:

1. **Refundable**: every paid slice's airline rules allow a hold refund
   inside the post-payment window (typically 24h "Risk Free Cancellation"
   on US-DOT routes). `cancel-booking.ts` runs Duffel's `cancel_order`,
   Gateway escrow's `release_reserve` returns funds to the traveler wallet.
2. **Non-refundable**: at least one airline rules say "ticketed, no refund."
   We treat the whole trip as "partial commit" — the customer has one
   ticket they didn't fully want. Surface to operator via
   `/dashboard/handoffs` with a banner explaining the partial state and
   asking the operator to call the airline OR offer credit. We never
   silently leave the customer stranded.

## Tenant flag + safety guards

- `Tenant.metadata.flights.allowSplitTicket` (bool, default `false`).
  Off by default — TMCs opt in per-tenant after agreeing to the
  partial-disruption risk profile.
- **Min-layover guard**: `book_trip` refuses split-ticket combos where the
  layover between slice N and slice N+1 is `< 3h` (configurable per
  tenant, hard floor at 2h). Reason: schedule disruption on one slice
  doesn't propagate to the other; customer needs a real buffer to absorb
  a delay without missing the second carrier.
- **Origin/destination invariant**: split-ticket only when slice N+1 origin
  equals slice N destination (i.e., the customer doesn't change cities
  between flights). For trips like JFK → LHR → CDG round-trip, slice 1
  must start at CDG, not at LHR. Standard Duffel validation already enforces
  this at request time, but `book_trip` double-checks before any
  `createHoldOrder` call.
- **Insurance auto-add**: when split-ticket is selected, automatically
  bundle the cheapest "missed connection" travel insurance on
  `book_insurance` after both slices are held. Tenant can opt out.

## Ledger semantics

Each slice creates one Booking + one `confirm_booking` call → one balanced
journal transaction per Booking. The shared `tripId` lets us roll up at the
trip level for reporting:

```
trip total = SUM(bookings.totalUsd WHERE bookings.tripId = trip.id)
trip take  = SUM(bookings.senderoTakeMicroUsdc) / 1e6
```

The journal-entries `contextKind`/`contextRef` on each leg already carries
the Booking id, so a multi-Booking trip's full ledger story is queryable
without schema changes.

**SenderoGuestEscrow.sol**: one `reserve → commit` cycle per Booking. The
contract is per-booking by design; we don't batch. Gas cost: 2× a
single-slice trip. Acceptable on Arc (USDC-gas, sub-cent per tx).

## Rollback / kill switch

- Per-tenant: `Tenant.metadata.flights.allowSplitTicket = false` flips
  `search_flights` and `book_trip` back to single-ticket mode immediately.
  Already-completed split-ticket trips keep working (they're just two
  separate Bookings with the standard lifecycle).
- Platform-wide: `SENDERO_FLIGHTS_DISABLE_SPLIT_TICKET=true` env var checked
  by `search_flights` before adapter dispatch. Bypasses the per-tenant
  flag.

## What's NOT in this PR

- Split-ticket UPGRADE flow (post-booking, customer wants to change one
  slice) — deferred. For now, one slice can be canceled independently and
  rebooked separately as a new Booking with the same `tripId`.
- Multi-currency reconciliation per slice — assumed single currency per
  trip for v1. If Duffel returns different currencies on different slices,
  refuse the combo (rare; almost always Duffel converts).
- Loyalty / corporate-fare per-slice attribution — slice-level loyalty
  programmes already supported by `FlightSearchParams.loyaltyProgrammeAccounts`;
  the per-slice mapping comes for free since each slice's createHoldOrder
  carries its own loyalty payload.
- Carbon offset / sustainability scoring at the trip level — already a
  per-Booking concern; trip rollup is a follow-up dashboard concern, not
  a booking-time concern.
- Travel-insurance auto-add (mentioned in safety guards) — will land in a
  follow-up commit; for v1 we'll surface a recommendation in the
  confirmation card but not auto-attach.

## Test plan

1. **Adapter unit tests** (`packages/duffel/src/index.test.ts`): mock
   Duffel responses with both flat and itinerary shapes; assert the
   discriminated union surfaces correctly.
2. **`book_trip` state machine** (`packages/tools/src/book-trip.test.ts`):
   exhaust every transition. Inject fail at each `createHoldOrder` +
   `payFromBalance` step; assert correct recovery action.
3. **Channel-render snapshots** (`apps/app/lib/channel-render/__tests__/`):
   single + split modes for operator / Slack / WhatsApp / web.
4. **Integration**: against Duffel test mode (`api.duffel.com` with a test
   key), search MAD↔ATH dates and verify the response includes split-ticket
   slices. Don't actually book in CI.
5. **E2E smoke**: post-deploy, the validate script (sibling of
   `validate-kms-canary.ts`) creates a sandbox `book_trip` against test
   inventory and asserts both Bookings + ledger entries land.

## Rollout

1. Land this PR with `allowSplitTicket=false` for every tenant. Code is
   wired but inert.
2. Enable on `sendero-sandbox` tenant. Run the E2E smoke. Confirm:
   - search_flights returns split-ticket offers
   - book_trip orchestrates 2 Bookings under one tripId
   - confirm_booking writes balanced journal entries per Booking
   - cancel_booking releases escrow per slice
3. Enable on one volunteer pilot tenant for a week. Watch
   `wallet_access_logs` + `journal_entries` for anomalies.
4. Open to general availability with default still off; TMC ops can
   enable in admin UI.

## Open questions

1. **SDK pinning**: `@duffel/api` is `^4.0.0`. Does it surface
   `include_split_ticket` natively or do we go raw HTTP? Investigation
   in adapter PR.
2. **PNR-pair naming**: should we display "PNR ABC123 + DEF456" on the
   confirmation, or hide the airline-side detail behind a single
   sendero-trip-id? Lean toward hiding by default, expose on click.
3. **Refund accounting for partial-commit**: if slice 0 ticketed but
   slice 1 failed and we honor the customer with a travel credit for
   slice 1, where does that credit live? Tenant balance, traveler
   balance, or a new MetCredits row?
