# TEST_FIRST_MESSAGE — Trip Companion E2E stress test

A single message designed to push the Sendero agent end-to-end in one turn.
Multi-city, policy-bound, multi-pax, ancillary-heavy, mixed-payment, and
multi-channel. A passing run touches 80% of the Phase-11 surface in one
conversation.

Paste **the prompt** block verbatim into `/app/console` as an authenticated
`agency_admin` or `traveler` session. Let the agent run. Do not hand-hold.

---

## The prompt

> Planning a multi-city trip and I need this locked by end of week. Leaving
> NYC (JFK) **Monday May 18** late evening — I need to be in London by
> Tuesday 9am for a design review that runs through Thursday. Wednesday
> night I want to sneak over to Paris for dinner with a client (Eurostar
> Wed 6pm, back to London Thu 7am-ish). Then Thursday afternoon I fly
> London → Singapore for Friday meetings, and my wife is joining me there
> — she's flying separately from SFO but we fly home **together Sunday May 24**
> Singapore → JFK.
>
> Corporate rules: business class for anything over 6 hours, **$10k total
> budget** across flights + hotels. Marriott Bonvoy gold preferred. I've
> got a **$350 American Airlines credit** from a cancelled Q1 trip — use it
> if the fare makes sense. I'm coeliac so flag carriers that don't do
> gluten-free meals.
>
> Hotels: King Edward in London Mon–Thu (or County Hall if materially
> cheaper), something central in Singapore Fri–Sun. Send the invoice to
> finance@acme.travel and CC my EA lisa@acme.travel. Brief me on
> weather + air quality for all three cities — my wife's coming off a
> wildfire-smoke week in SF and I want to know if we need masks in Paris
> or Singapore.
>
> Last thing: check-in nudges via **WhatsApp**, not email. And when I land at
> LHR I want a pre-cleared route to the hotel, not a generic taxi app
> link. Make it good.

---

## Why this is hard (decision surface the agent has to chew through)

| Signal | The trap |
|---|---|
| "leaving Monday May 18 late evening, need to be in London by Tuesday 9am" | Overnight transatlantic — arrives early Tue. Must be a redeye, not a Tuesday morning flight. |
| "sneak over to Paris for dinner … Eurostar Wed 6pm" | Eurostar isn't on Duffel. Agent should flag rail-outside-scope, not hallucinate a flight. |
| "business class for anything over 6 hours" | JFK→LHR (~7h), LHR→SIN (~13h), SIN→JFK (~19h with stop). Three business-class long-hauls. |
| "$10k total budget" | Business fares on three long-hauls easily exceed $10k. Forces tradeoff surfacing. |
| "$350 American Airlines credit" | Must apply on an AA-operated segment. Likely JFK→LHR if AA/BA codeshare. Agent must check credit validity, segment carrier match, FX. |
| "Marriott Bonvoy gold" | Stays search must pass loyalty programme account on both hotel bookings. |
| "coeliac — flag carriers that don't do gluten-free meals" | Must surface per-carrier meal ancillary availability, not silently book. |
| "my wife is joining me … we fly home together Sunday" | Multi-pax on the SIN→JFK leg only. Others single-pax. Don't book her on the London legs. |
| "invoice to finance@acme.travel CC lisa@acme.travel" | Must route `generate_booking_invoice` with both recipients. |
| "weather + air quality for all three cities" | Three parallel `travel_safety_brief` runs (LHR, CDG, SIN). |
| "check-in nudges via WhatsApp" | `trip_checkin_reminder` + `CheckInNudge` channel='whatsapp', not the default email path. |
| "pre-cleared route to the hotel" at LHR | `sendero.arrival_playbook` — not a generic transfer card. Specific to LHR → stays_in_london. |

---

## Expected agent behavior (pass criteria)

### Phase 0 — Identity
- [ ] Calls `ensure_duffel_customer` before the first `search_flights` so Travel Support Assistant is scoped. `User.duffelCustomerUserId` is populated in Prisma after this turn.
- [ ] `Tenant.duffelCustomerUserGroupId` is present (or gets populated via the same flow).

### Phase 1 — Planning + policy frame
- [ ] Parses **four** transport legs: JFK→LHR, LHR↔CDG (rail), LHR→SIN, SIN→JFK.
- [ ] Acknowledges Eurostar is outside Duffel scope; does NOT pretend to book it. Either skips or suggests TMC rail desk.
- [ ] Surfaces the $10k-vs-3-business-fares conflict explicitly before searching. Does not just run searches and dump offers.
- [ ] Notes the spouse is only on SIN→JFK — does not add her as a passenger on the outbound legs.

### Phase 2 — Search
- [ ] Calls `search_flights` with `cabinClass: 'business'` on the two long-hauls (JFK→LHR, LHR→SIN) and SIN→JFK.
- [ ] Passes `loyaltyProgrammeAccounts` on the AA leg where applicable.
- [ ] For SIN→JFK, `passengers: 2` with the spouse as a second traveler on that leg only.
- [ ] For each offer set, surfaces a 2–3 option shortlist, not the raw 50+ offer dump.

### Phase 3 — Ancillaries + credit
- [ ] Calls `list_flight_ancillaries` on the chosen outbound offer and checks meal availability, surfaces any carrier that doesn't support gluten-free.
- [ ] If AA credit is applicable, `book_flight` is invoked with `airlineCreditId: 'acd_…'` on the AA-operated leg. Split-payment confirmed with the user.
- [ ] Ancillary selection writes an `AncillarySelection` row (post-11f — audit visible).

### Phase 4 — Stays
- [ ] Calls `quote_stay` and `book_stay` for both London and Singapore.
- [ ] London stay compares King Edward vs County Hall; surfaces the price delta in plain language.
- [ ] Both stays include the Bonvoy loyalty id on the search/quote.
- [ ] Does not auto-book without user confirmation at the pause step.

### Phase 5 — Safety brief
- [ ] Fires `sendero.travel_safety_brief` for LHR, CDG, SIN (3 runs or a single composed call).
- [ ] Surfaces air quality for Paris specifically (the user asked about wildfires); does not bury it.
- [ ] One `SafetyBrief` row per destination in Prisma.

### Phase 6 — Post-book companion setup
- [ ] Schedules a `CheckInNudge` per flight leg with `channel: 'whatsapp'`.
- [ ] Queues a `sendero.arrival_playbook` run scoped to LHR → London hotel (uses the booked hotel address).
- [ ] Fires `generate_booking_invoice` with `to: finance@acme.travel`, `cc: lisa@acme.travel`.
- [ ] Emits a single summary card at the end: 4 legs + 2 stays + credit applied + invoice sent + nudges scheduled.

### Phase 7 — Discipline checks
- [ ] Every tool call on the web chat shows a corresponding workflow-log event.
- [ ] `Trip.status` transitions draft → searching → awaiting_approval → booked.
- [ ] No direct Duffel sdk errors leak to the user (errors come back through `TripToolCard` error state).
- [ ] Meter hook is either quiet (no CORS noise — post-11d fix) or cleanly "degraded" if the edge URL isn't set.

---

## Followup round (if the agent survives round 1)

Inject a disruption once everything's booked. Paste this as the *next* message:

> Just got a BA alert — they're moving my LHR → SIN two hours later, I'll
> miss the Friday morning meeting. What are my options?

### Expected response
- [ ] Recognizes this as a `schedule_changed` disruption (not a cancellation).
- [ ] Fires `sendero.cancellation_recovery` with `kind: 'schedule_changed'`.
- [ ] Presents **rebook vs refund with equal weight** (per spec). Not "here's a refund" or "here's a rebook" — both, side by side.
- [ ] Rebook option surfaces the fare delta before committing.
- [ ] Writes a `DisruptionRun` row, source='traveler', status='awaiting_decision'.
- [ ] If the fare delta is > 15%, pauses for ops approval via the Slack adapter (Phase 11j — if not landed yet, note that's expected behavior once 11j ships).

---

## Failure modes to watch for

These are the known landmines. A passing agent avoids all of them:

1. **Silent Eurostar hallucination** — agent searches for a JFK airline flying LHR↔CDG. (It must flag this as out of scope.)
2. **Spouse auto-added to outbound** — multi-pax propagates across unrelated segments.
3. **Credit applied to wrong carrier** — $350 AA credit shows up on a BA-operated leg. Duffel will reject at payment; the agent should catch it in planning.
4. **Budget blown silently** — three business-class fares priced + booked without surfacing the $10k breach.
5. **Safety brief degraded to a link** — "here's a weather.com URL" instead of running the actual `travel_safety_brief` tool.
6. **Check-in scheduled on the wrong channel** — defaults to email despite explicit "via WhatsApp".
7. **Arrival playbook substituted with generic taxi link** — must be the composed card (airport → transfer → route map → hotel), not a Google Maps URL.
8. **Invoice not fired** — agent books everything but forgets to call `generate_booking_invoice`.
9. **No pause before booking** — goes straight from search to `book_flight` without user confirmation.
10. **Workflow log silent** — tools run but the `workflow-log` panel shows nothing, meaning the event dispatch is broken.

---

## Dev pre-flight (run before pasting the prompt)

```bash
# From repo root
bunx prisma migrate status --schema packages/database/prisma/schema.prisma
# Expect: all 11f migrations applied (incl. 20260423224504_phase_11f_trip_companion_audit).

# Dev server
bun run dev -F @sendero/app
# Open http://localhost:3000/app/console — sign in as the test traveler.
```

If the Duffel webhook is not pointed at your dev tunnel, `service.refunded`
and `order.issued` lifecycle events won't flow — the post-book experience
will look silent. Either register the webhook against your ngrok URL first,
or accept that part of the test scores "not verified".
