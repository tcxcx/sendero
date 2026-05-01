/**
 * Canonical Sendero workflows.
 *
 * Each workflow is a declarative plan the runner executes. The LLM in
 * /api/agent/dispatch can either produce free-form tool calls OR name a
 * workflow id and let the runner drive. Consumers compose these into
 * bigger flows (book-flight + send-approval + settle → one group-trip
 * workflow).
 *
 * Scratchpad shape:
 *   input.*           — args passed to startRun()
 *   <stepId>          — the raw output of that step
 *   <as>              — if step.as is set, alias into the scratchpad
 */

import { $, type WorkflowDef } from './types';

// ─── book-flight: search → policy → hold → confirm → settle ───────────

export const bookFlightWorkflow: WorkflowDef = {
  id: 'sendero.book_flight',
  version: 2,
  label: 'Book a flight',
  description:
    'Escrow-backed booking: the trip must already be prefunded via prefund_trip. Checks traveler eligibility (passport + visa) before touching any supplier, then searches Duffel inventory, validates policy, reserves escrow upper-bound, holds the offer, commits the actual vendor amount, waits for Duffel ticketing (via webhook), then releases escrow to vendor + fee legs on ticket confirmation, or refunds the buyer on failure.',
  steps: [
    // ── Eligibility precondition — runs BEFORE any supplier call ──
    //
    // The traveler's passport + visa status is verified first. A
    // `block` verdict pauses the workflow indefinitely; the admin UI
    // surfaces the verdict's reason codes and lets the traveler
    // update their declared profile or upload a fresh passport. Once
    // fixed, `resumeRun()` continues past the pause into the normal
    // search → policy → hold → commit path.
    //
    // Warn verdicts (passport expires < 6 months, visa required but
    // not on file) continue to search — the trip card surfaces the
    // warnings + ancillary CTAs so the traveler decides.
    {
      kind: 'tool',
      id: 'eligibility',
      tool: 'check_travel_eligibility',
      label: 'Verify travel documents',
      as: 'eligibility',
      args: {
        travelerUserId: $('input.travelerUserId'),
        originIso3: $('input.originIso3'),
        destinationIso3: $('input.destinationIso3'),
        departureDate: $('input.departureDate'),
        returnDate: $('input.returnDate'),
        purpose: $('input.purpose'),
      },
      retries: 0,
      timeoutMs: 10_000,
    },
    {
      kind: 'branch',
      id: 'eligibility_gate',
      label: 'Eligibility gate',
      when: $('eligibility.status'),
      equals: 'block',
      then: [
        {
          kind: 'pause',
          id: 'await_eligibility_fix',
          label: 'Blocked — traveler documents must be updated',
          reason: 'eligibility_blocked',
          payload: {
            verdict: $('eligibility'),
            reasons: $('eligibility.reasons'),
            actions: $('eligibility.actions'),
          },
          // Seven days: long enough for a passport upload + visa
          // application turnaround, short enough that stale trips
          // don't linger in `paused` forever.
          timeoutMs: 7 * 24 * 60 * 60 * 1000,
        },
      ],
      otherwise: [],
    },
    {
      kind: 'tool',
      id: 'search',
      tool: 'search_flights',
      label: 'Search flights',
      as: 'offers',
      args: {
        origin: $('input.origin'),
        destination: $('input.destination'),
        departureDate: $('input.departureDate'),
        returnDate: $('input.returnDate'),
        passengers: $('input.passengers'),
        cabinClass: $('input.cabinClass'),
      },
      retries: 1,
      timeoutMs: 15_000,
    },
    {
      kind: 'tool',
      id: 'policy',
      tool: 'check_policy',
      label: 'Check policy',
      as: 'policy',
      args: {
        policyId: $('input.policyId'),
        offer: $('offers.topOffer'),
      },
    },
    {
      kind: 'tool',
      id: 'reserve',
      tool: 'reserve_booking',
      label: 'Reserve upper-bound from escrow',
      as: 'reservation',
      args: {
        tripId: $('input.tripId'),
        upperBoundUsdc: $('offers.topOffer.priceUsdc'),
      },
    },
    {
      kind: 'branch',
      id: 'policy_gate',
      label: 'Policy gate',
      when: $('policy.allowed'),
      equals: true,
      then: [
        {
          kind: 'tool',
          id: 'hold',
          tool: 'book_flight',
          label: 'Hold offer',
          as: 'hold',
          args: { offerId: $('offers.topOffer.id') },
          timeoutMs: 30_000,
        },
      ],
      otherwise: [
        {
          kind: 'pause',
          id: 'await_approval',
          label: 'Approver decision',
          reason: 'approval',
          payload: {
            via: 'slack',
            reasons: $('policy.reasons'),
          },
        },
        {
          kind: 'tool',
          id: 'hold_after_approval',
          tool: 'book_flight',
          label: 'Hold offer (approved)',
          as: 'hold',
          args: { offerId: $('offers.topOffer.id') },
        },
      ],
    },
    {
      kind: 'tool',
      id: 'commit',
      tool: 'commit_booking',
      label: 'Commit vendor amount + release slack',
      args: {
        bookingId: $('reservation.bookingId'),
        vendorAmountUsdc: $('hold.vendorAmountUsdc'),
        feeAmountUsdc: $('hold.feeAmountUsdc'),
        vendorAddress: $('hold.vendorAddress'),
        itineraryHash: $('hold.itineraryHash'),
        itineraryCID: $('hold.itineraryCID'),
      },
    },
    {
      kind: 'pause',
      id: 'await_duffel_ticket',
      label: 'Awaiting Duffel ticketing',
      reason: 'external_event',
      payload: { via: 'duffel_order_ticketed' },
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'duffel_gate',
      label: 'Duffel outcome',
      when: $('await_duffel_ticket.status'),
      equals: 'ticketed',
      then: [
        {
          kind: 'tool',
          id: 'confirm',
          tool: 'confirm_flight',
          label: 'Confirm Duffel ticket on-chain',
          args: {
            bookingId: $('reservation.bookingId'),
            duffelOrderHash: $('hold.orderHash'),
          },
        },
        {
          kind: 'tool',
          id: 'settle_escrow',
          tool: 'settle_booking',
          label: 'Release escrow to vendor + fee',
          args: { bookingId: $('reservation.bookingId') },
        },
        {
          kind: 'tool',
          id: 'invoice',
          tool: 'generate_booking_invoice',
          label: 'Issue booking invoice',
          args: {
            bookingId: $('reservation.bookingId'),
            settleTxHash: $('settle_escrow.txHash'),
          },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking + refund',
          args: {
            bookingId: $('reservation.bookingId'),
            tripId: $('input.tripId'),
            reason: 'duffel_failed',
          },
        },
      ],
    },
    {
      kind: 'tool',
      id: 'settle',
      tool: 'settle_split',
      label: 'Settle commission fan-out',
      as: 'settlement',
      args: {
        gross: $('hold.totalUsd'),
        supplier: $('hold.supplierAddress'),
        commissionBps: 1000,
        senderoFeeBps: 50,
      },
    },
  ],
};

// ─── group-trip: parallel search across travelers → liveblocks → confirm

export const groupTripWorkflow: WorkflowDef = {
  id: 'sendero.group_trip',
  version: 1,
  label: 'Plan a group trip',
  description:
    'Searches in parallel for N travelers, joins them to a Liveblocks shared room for itinerary consensus, then confirms the approved set and settles.',
  steps: [
    {
      kind: 'parallel',
      id: 'search_per_traveler',
      label: 'Search flights per traveler',
      failFast: false,
      branches: [
        // Note: runtime fans this out dynamically in consuming code —
        // this static definition is the "all eligible travelers" slot
        // that the caller expands before handing the workflow to the runner.
        {
          id: 'primary',
          steps: [
            {
              kind: 'tool',
              id: 'search',
              tool: 'search_flights',
              label: 'Search for primary traveler',
              args: $('input.primarySearch'),
              as: 'offers',
            },
          ],
        },
      ],
    },
    {
      kind: 'pause',
      id: 'await_group_consensus',
      label: 'Group confirms itinerary in Liveblocks room',
      reason: 'user_reply',
      payload: { via: 'liveblocks' },
    },
    {
      kind: 'tool',
      id: 'confirm_all',
      tool: 'book_flight',
      label: 'Confirm bookings per traveler',
      args: $('await_group_consensus.selections'),
    },
    {
      kind: 'tool',
      id: 'settle',
      tool: 'settle_split',
      label: 'Settle group commission',
      args: {
        gross: $('confirm_all.totalUsd'),
        supplier: $('confirm_all.supplierAddress'),
        commissionBps: 1000,
        senderoFeeBps: 50,
      },
    },
  ],
};

// ─── refund: get_booking → compute → cancel → refund-settle ───────────

export const refundWorkflow: WorkflowDef = {
  id: 'sendero.refund',
  version: 1,
  label: 'Cancel + refund a booking',
  steps: [
    {
      kind: 'tool',
      id: 'fetch',
      tool: 'check_treasury',
      label: 'Check treasury can cover refund',
      as: 'treasury',
      args: {},
    },
    {
      kind: 'tool',
      id: 'cancel',
      tool: 'book_flight',
      label: 'Cancel booking with supplier',
      args: { offerId: $('input.bookingId') },
    },
    {
      kind: 'tool',
      id: 'refund_settle',
      tool: 'send_tokens',
      label: 'Refund traveler wallet',
      args: {
        to: $('input.travelerAddress'),
        amount: $('input.refundAmount'),
        token: 'USDC',
      },
    },
  ],
};

// ─── check-in-reminder: cron-triggered 24h before departure ───────────

export const checkInReminderWorkflow: WorkflowDef = {
  id: 'sendero.check_in_reminder',
  version: 2,
  label: 'Check-in reminder',
  description:
    'Fires before departure. Geocodes the origin airport, reads its timezone, builds the canonical check-in nudge (check-in window + airport transit note + leave-by), then pauses awaiting the traveler reply so the in-trip chat can open with one tap.',
  steps: [
    {
      kind: 'tool',
      id: 'fetch_booking',
      tool: 'check_treasury', // placeholder — swap for `get_booking_status` when added
      label: 'Fetch booking context',
      args: {},
    },
    {
      kind: 'tool',
      id: 'geocode_origin',
      tool: 'geocode_trip_stop',
      label: 'Geocode departure airport',
      as: 'origin',
      args: {
        address: $('input.origin'),
        languageCode: $('input.language'),
      },
    },
    {
      kind: 'tool',
      id: 'reminder',
      tool: 'trip_checkin_reminder',
      label: 'Build canonical check-in reminder',
      as: 'reminder',
      args: {
        pnr: $('input.pnr'),
        flightNumber: $('input.flightNumber'),
        carrier: $('input.carrier'),
        origin: $('input.origin'),
        destination: $('input.destination'),
        departureDateTimeIso: $('input.departureDateTimeIso'),
        airportLatitude: $('origin.latitude'),
        airportLongitude: $('origin.longitude'),
        stayLabel: $('input.stayLabel'),
        stayAddress: $('input.stayAddress'),
        stayLatitude: $('input.stayLatitude'),
        stayLongitude: $('input.stayLongitude'),
        transferMode: $('input.transferMode'),
        travelerName: $('input.travelerName'),
        checkInWindowHours: $('input.checkInWindowHours'),
      },
    },
    {
      kind: 'pause',
      id: 'await_traveler_reply',
      label: 'Traveler replies',
      reason: 'user_reply',
      payload: {
        via: $('input.channel'),
        promptId: 'check-in-reminder',
        share: $('reminder.share'),
      },
      timeoutMs: 12 * 60 * 60 * 1000, // 12h
    },
  ],
};

// ─── travel-safety-brief: geocode → parallel risk checks ─────────────

export const travelSafetyBriefWorkflow: WorkflowDef = {
  id: 'sendero.travel_safety_brief',
  version: 1,
  label: 'Generate a travel safety brief',
  description:
    'Travel-risk workflow for destination readiness. Geocodes the stop, then runs weather, air quality, timezone, elevation, and composed safety checks in parallel so agents can brief the traveler before departure or reroute decisions.',
  steps: [
    {
      kind: 'tool',
      id: 'geocode_stop',
      tool: 'geocode_trip_stop',
      label: 'Normalize the requested stop',
      as: 'stop',
      args: {
        address: $('input.locationText'),
        languageCode: $('input.languageCode'),
        regionCode: $('input.regionCode'),
      },
    },
    {
      kind: 'parallel',
      id: 'risk_checks',
      label: 'Run weather, air quality, timezone, elevation, and safety checks',
      failFast: false,
      branches: [
        {
          id: 'weather',
          steps: [
            {
              kind: 'tool',
              id: 'weather',
              tool: 'trip_weather_brief',
              label: 'Read current weather conditions',
              as: 'weather',
              args: {
                latitude: $('stop.latitude'),
                longitude: $('stop.longitude'),
                languageCode: $('input.languageCode'),
              },
            },
          ],
        },
        {
          id: 'air_quality',
          steps: [
            {
              kind: 'tool',
              id: 'air_quality',
              tool: 'air_quality_brief',
              label: 'Read current air quality',
              as: 'airQuality',
              args: {
                latitude: $('stop.latitude'),
                longitude: $('stop.longitude'),
                languageCode: $('input.languageCode'),
              },
            },
          ],
        },
        {
          id: 'timezone',
          steps: [
            {
              kind: 'tool',
              id: 'timezone',
              tool: 'timezone_brief',
              label: 'Read local timezone context',
              as: 'timezone',
              args: {
                latitude: $('stop.latitude'),
                longitude: $('stop.longitude'),
              },
            },
          ],
        },
        {
          id: 'elevation',
          steps: [
            {
              kind: 'tool',
              id: 'elevation',
              tool: 'elevation_risk_brief',
              label: 'Read elevation and altitude risk',
              as: 'elevation',
              args: {
                latitude: $('stop.latitude'),
                longitude: $('stop.longitude'),
              },
            },
          ],
        },
        {
          id: 'safety_aid',
          steps: [
            {
              kind: 'tool',
              id: 'safety_aid',
              tool: 'travel_safety_aid',
              label: 'Generate the composed safety brief',
              as: 'safetyAid',
              args: {
                latitude: $('stop.latitude'),
                longitude: $('stop.longitude'),
                travelerNotes: $('input.travelerNotes'),
                languageCode: $('input.languageCode'),
              },
            },
          ],
        },
      ],
    },
  ],
};

// ─── guest-prefund: Navan-style but WA-native + AI-native ─────────────
//
// Corporate buyer funds a trip on-chain (prefund_trip) → Sendero DMs
// the guest a WA link → guest claims with their MSCA passkey
// (guest_claim_link) → booking agent searches + reserves + commits →
// final Duffel confirm + settle pays the vendor + fee legs.

export const guestPrefundWorkflow: WorkflowDef = {
  id: 'sendero.guest_prefund',
  version: 1,
  label: 'Prefund a guest trip',
  description:
    'Corporate buyer prefunds a trip budget in USDC, Sendero emits a WA-shareable guest link, the guest claims with their Modular Wallet, and the booking agent draws down via reserve → commit → confirm → settle for each leg. Replaces the Navan virtual-card + reimbursement loop with a single on-chain escrow.',
  steps: [
    {
      kind: 'tool',
      id: 'prefund',
      tool: 'prefund_trip',
      label: 'Corporate buyer prefunds escrow + gets share link',
      as: 'prefund',
      args: {
        budgetUsdc: $('input.budgetUsdc'),
        expiresInDays: $('input.expiresInDays'),
        metadataCID: $('input.metadataCID'),
      },
    },
    {
      kind: 'tool',
      id: 'log_invite',
      tool: 'log_agent_action',
      label: 'Record invite dispatch on-chain',
      args: { tripId: $('prefund.tripId'), actionType: 'other', feeMicroUsdc: '0' },
    },
    {
      kind: 'pause',
      id: 'await_guest_claim',
      label: 'Guest opens the WA link + claims',
      reason: 'external_event',
      payload: { via: 'whatsapp_guest_link' },
      timeoutMs: 30 * 24 * 60 * 60 * 1000,
    },
    {
      kind: 'tool',
      id: 'search',
      tool: 'search_flights',
      label: 'Search flights with the claimed budget',
      as: 'offers',
      args: $('input.search'),
    },
    {
      kind: 'tool',
      id: 'policy',
      tool: 'check_policy',
      label: 'Check the top offer against policy',
      as: 'policy',
      args: { policyId: $('input.policyId'), offer: $('offers.topOffer') },
    },
    {
      kind: 'tool',
      id: 'reserve',
      tool: 'reserve_booking',
      label: 'Reserve upper-bound USDC from escrow',
      as: 'reservation',
      args: {
        tripId: $('prefund.tripId'),
        upperBoundUsdc: $('offers.topOffer.priceUsdc'),
      },
    },
    {
      kind: 'tool',
      id: 'hold',
      tool: 'book_flight',
      label: 'Hold Duffel offer',
      as: 'hold',
      args: { offerId: $('offers.topOffer.id') },
    },
    {
      kind: 'tool',
      id: 'commit',
      tool: 'commit_booking',
      label: 'Commit vendor amount + release slack',
      args: {
        bookingId: $('reservation.bookingId'),
        vendorAmountUsdc: $('hold.vendorAmountUsdc'),
        feeAmountUsdc: $('hold.feeAmountUsdc'),
        vendorAddress: $('hold.vendorAddress'),
        itineraryHash: $('hold.itineraryHash'),
        itineraryCID: $('hold.itineraryCID'),
      },
    },
    {
      kind: 'pause',
      id: 'await_duffel_ticket',
      label: 'Awaiting Duffel ticketing',
      reason: 'external_event',
      payload: { via: 'duffel_order_ticketed' },
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'duffel_gate',
      label: 'Duffel outcome',
      when: $('await_duffel_ticket.status'),
      equals: 'ticketed',
      then: [
        {
          kind: 'tool',
          id: 'confirm',
          tool: 'confirm_flight',
          label: 'Confirm Duffel ticket on-chain',
          args: {
            bookingId: $('reservation.bookingId'),
            duffelOrderHash: $('hold.orderHash'),
          },
        },
        {
          kind: 'tool',
          id: 'settle_escrow',
          tool: 'settle_booking',
          label: 'Release escrow to vendor + fee',
          args: { bookingId: $('reservation.bookingId') },
        },
        {
          kind: 'tool',
          id: 'invoice',
          tool: 'generate_booking_invoice',
          label: 'Issue booking invoice',
          args: {
            bookingId: $('reservation.bookingId'),
            settleTxHash: $('settle_escrow.txHash'),
          },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking + refund',
          args: {
            bookingId: $('reservation.bookingId'),
            tripId: $('prefund.tripId'),
            reason: 'duffel_failed',
          },
        },
      ],
    },
    {
      kind: 'tool',
      id: 'settle',
      tool: 'settle_split',
      label: 'Settle commission fan-out',
      args: {
        gross: $('hold.totalUsd'),
        supplier: $('hold.vendorAddress'),
        commissionBps: 1000,
        senderoFeeBps: 50,
      },
    },
  ],
};

// ─── agency-cohort: pre-funded bulk travel (TMC / bootcamp / charter)

export const agencyCohortWorkflow: WorkflowDef = {
  id: 'sendero.agency_cohort',
  version: 1,
  label: 'Fund a cohort of N trips',
  description:
    'Agency path: fund N guest trips atomically via batchCreateTrip, emit one WA-shareable link per traveler, then let each traveler claim + book independently. Enables pre-funded bootcamps, incentive trips, sports-team charters without wiring money to each person.',
  steps: [
    {
      kind: 'parallel',
      id: 'create_all',
      label: 'Create N trips in parallel',
      failFast: false,
      branches: [
        {
          id: 'primary',
          steps: [
            {
              kind: 'tool',
              id: 'prefund',
              tool: 'prefund_trip',
              label: 'Prefund + emit WA link for primary seat',
              args: $('input.primarySeat'),
              as: 'prefund',
            },
          ],
        },
      ],
    },
    {
      kind: 'pause',
      id: 'await_claims',
      label: 'Await per-traveler claims',
      reason: 'external_event',
      payload: { via: 'whatsapp_guest_link', bulkCohort: true },
      timeoutMs: 14 * 24 * 60 * 60 * 1000,
    },
  ],
};

// ─── ops-quote-to-book: intake → inventory → quote review → booking ────

export const opsQuoteToBookWorkflow: WorkflowDef = {
  id: 'sendero.ops_quote_to_book',
  version: 1,
  label: 'Ops quote-to-book chain',
  description:
    'Agency/TMC desk flow: normalize an inbound request, search bookable inventory, check policy, pause for operator quote review, then reserve/hold against escrow when the operator marks the quote ready to book.',
  steps: [
    {
      kind: 'pause',
      id: 'operator_intake_review',
      label: 'Operator reviews inbound request',
      reason: 'user_reply',
      payload: {
        promptId: 'operator-workspace',
        expected:
          'Confirm traveler, route, dates, budget, policy, client tone, missing fields, and source channel.',
      },
    },
    {
      kind: 'parallel',
      id: 'inventory_search',
      label: 'Search flight and hotel inventory',
      failFast: false,
      branches: [
        {
          id: 'flights',
          steps: [
            {
              kind: 'tool',
              id: 'search_flights',
              tool: 'search_flights',
              label: 'Search flights for quote matrix',
              as: 'flightOffers',
              args: $('input.flightSearch'),
              retries: 1,
              timeoutMs: 15_000,
            },
          ],
        },
        {
          id: 'hotels',
          steps: [
            {
              kind: 'tool',
              id: 'search_hotels',
              tool: 'search_hotels',
              label: 'Search hotels for quote matrix',
              as: 'hotelOffers',
              args: $('input.hotelSearch'),
              retries: 1,
              timeoutMs: 15_000,
            },
          ],
        },
      ],
    },
    {
      kind: 'tool',
      id: 'policy',
      tool: 'check_policy',
      label: 'Check selected quote candidate against policy',
      as: 'policy',
      args: {
        policyId: $('input.policyId'),
        offer: $('input.policyOffer'),
      },
    },
    {
      kind: 'pause',
      id: 'operator_quote_review',
      label: 'Operator edits quote and client-ready message',
      reason: 'approval',
      payload: {
        promptId: 'quote-builder',
        expected:
          'Return readyToBook, selectedOfferId, quoteText, policyExceptionMemo, and clientApprovalChannel.',
      },
    },
    {
      kind: 'branch',
      id: 'quote_gate',
      label: 'Quote ready to book',
      when: $('operator_quote_review.readyToBook'),
      equals: true,
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'tool',
          id: 'reserve',
          tool: 'reserve_booking',
          label: 'Reserve upper-bound USDC from escrow',
          as: 'reservation',
          args: {
            tripId: $('input.tripId'),
            upperBoundUsdc: $('input.upperBoundUsdc'),
          },
        },
        {
          kind: 'tool',
          id: 'hold',
          tool: 'book_flight',
          label: 'Hold selected supplier offer',
          as: 'hold',
          args: { offerId: $('operator_quote_review.selectedOfferId') },
        },
      ],
      otherwise: [
        {
          kind: 'pause',
          id: 'await_client_decision',
          label: 'Await client decision or quote revision',
          reason: 'user_reply',
          payload: { via: 'originating_channel', promptId: 'quote-builder' },
        },
      ],
    },
  ],
};

// ─── ops-rebook-refund: evidence → options → approval → service action ──

export const opsRebookRefundWorkflow: WorkflowDef = {
  id: 'sendero.ops_rebook_refund',
  version: 1,
  label: 'Ops rebook/refund desk',
  description:
    'Post-ticket servicing flow: gather booking evidence, evaluate rebook/refund options, pause for approval, then cancel/refund or search replacement inventory with an audit memo payload.',
  steps: [
    {
      kind: 'pause',
      id: 'service_evidence_review',
      label: 'Operator reviews booking evidence',
      reason: 'user_reply',
      payload: {
        promptId: 'rebooking-refunds',
        expected:
          'Attach supplier order, PNR, traveler urgency, fare rule summary, refundability, and requested action.',
      },
    },
    {
      kind: 'tool',
      id: 'treasury',
      tool: 'check_treasury',
      label: 'Check treasury coverage for refund or fare difference',
      as: 'treasury',
      args: {},
    },
    {
      kind: 'pause',
      id: 'service_action_approval',
      label: 'Approve rebook, cancel, refund, or credit',
      reason: 'approval',
      payload: {
        promptId: 'rebooking-refunds',
        expected:
          'Return action=refund|rebook|credit|keep, approvedBy, customerMessage, and internalMemo.',
      },
    },
    {
      kind: 'branch',
      id: 'service_action_gate',
      label: 'Service action',
      when: $('service_action_approval.action'),
      equals: 'refund',
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking with supplier and release escrow',
          args: {
            bookingId: $('input.bookingId'),
            tripId: $('input.tripId'),
            reason: $('service_action_approval.internalMemo'),
          },
        },
        {
          kind: 'tool',
          id: 'refund_settle',
          tool: 'send_tokens',
          label: 'Refund traveler wallet',
          args: {
            to: $('input.travelerAddress'),
            amount: $('input.refundAmount'),
            token: 'USDC',
          },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'replacement_search',
          tool: 'search_flights',
          label: 'Search replacement flights',
          as: 'replacementOffers',
          args: $('input.rebookSearch'),
        },
        {
          kind: 'pause',
          id: 'replacement_quote_review',
          label: 'Operator reviews replacement options',
          reason: 'approval',
          payload: { promptId: 'rebooking-refunds', via: 'service_desk' },
        },
      ],
    },
  ],
};

// ─── ops-channel-intake: channel → identity → route next action ─────────

export const opsChannelIntakeWorkflow: WorkflowDef = {
  id: 'sendero.ops_channel_intake',
  version: 1,
  label: 'Ops channel intake',
  description:
    'Existing-tool embedding chain: normalize a request from WhatsApp, Slack, email, web, MCP, CRM, or GDS/NDC into one tenant/traveler/trip/session and return the next action to the originating channel.',
  steps: [
    {
      kind: 'pause',
      id: 'inbound_channel_received',
      label: 'Inbound request captured',
      reason: 'external_event',
      payload: {
        promptId: 'embedded-tools',
        expected: 'Provide channel, external user id, raw text, attachments, and tenant hint.',
      },
    },
    {
      kind: 'pause',
      id: 'identity_resolution_review',
      label: 'Resolve traveler, tenant, policy, and open trip',
      reason: 'user_reply',
      payload: {
        promptId: 'embedded-tools',
        expected:
          'Confirm matched user, tenant, policy, trip, confidence, and missing identity proof.',
      },
    },
    {
      kind: 'pause',
      id: 'route_next_action',
      label: 'Route next best action to channel',
      reason: 'user_reply',
      payload: {
        promptId: 'embedded-tools',
        expected: 'Return nextAction, workflowId, channelReply, operatorOwner, and SLA.',
      },
    },
  ],
};

// ─── ops-artifact-pack: evidence → invoice/artifact → operator review ───

export const opsArtifactPackWorkflow: WorkflowDef = {
  id: 'sendero.ops_artifact_pack',
  version: 1,
  label: 'Ops artifact pack',
  description:
    'Professional artifact chain: gather trip, policy, supplier, settlement, and invoice evidence, generate a booking invoice where available, then pause for operator review of quote, itinerary, exception, refund, or reconciliation copy.',
  steps: [
    {
      kind: 'pause',
      id: 'artifact_evidence_review',
      label: 'Collect source evidence',
      reason: 'user_reply',
      payload: {
        promptId: 'professional-artifacts',
        expected:
          'Attach traveler request, selected offers, policy result, approvals, supplier refs, settlement txs, and invoice ids.',
      },
    },
    {
      kind: 'tool',
      id: 'invoice',
      tool: 'generate_booking_invoice',
      label: 'Generate booking invoice when a booking is present',
      args: {
        bookingId: $('input.bookingId'),
        settleTxHash: $('input.settleTxHash'),
      },
    },
    {
      kind: 'pause',
      id: 'operator_artifact_review',
      label: 'Operator reviews artifact pack',
      reason: 'approval',
      payload: {
        promptId: 'professional-artifacts',
        expected:
          'Return sentVersion, quoteText, itineraryText, exceptionMemo, refundMemo, and reconciliationSummary.',
      },
    },
  ],
};

// ─── trip-delay-replanner: disruption → rebook options → optional hold
//
// Uses the canonical `trip_delay_replanner` tool to build the plan, then
// branches on whether a self-serve rebook was found. If yes, pause for
// traveler approval, then feed the chosen offerId into `book_flight`.
// Otherwise pause for agent handoff.

export const tripDelayReplannerWorkflow: WorkflowDef = {
  id: 'sendero.trip_delay_replanner',
  version: 1,
  label: 'Rebuild a disrupted trip',
  description:
    'Disruption recovery: searches replacement flights, optionally an overnight hotel, and packages a canonical rebook plan. On traveler approval, holds the chosen flight via book_flight.',
  steps: [
    {
      kind: 'tool',
      id: 'plan',
      tool: 'trip_delay_replanner',
      label: 'Build rebook plan',
      as: 'plan',
      args: {
        originalLeg: $('input.originalLeg'),
        disruption: $('input.disruption'),
        rebookSearch: $('input.rebookSearch'),
        needsHotelFallback: $('input.needsHotelFallback'),
        stayLocation: $('input.stayLocation'),
        stayCheckInDate: $('input.stayCheckInDate'),
        stayCheckOutDate: $('input.stayCheckOutDate'),
        travelerLabel: $('input.travelerLabel'),
        notifyChannels: $('input.notifyChannels'),
        transferMode: $('input.transferMode'),
      },
      retries: 1,
      timeoutMs: 20_000,
    },
    {
      kind: 'branch',
      id: 'has_rebook',
      label: 'Self-serve rebook available',
      when: $('plan.recommendedRebook.selectable'),
      equals: true,
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'pause',
          id: 'await_traveler_approval',
          label: 'Traveler approves rebook',
          reason: 'user_reply',
          payload: {
            promptId: 'delay-rebook',
            share: $('plan.share'),
          },
          timeoutMs: 2 * 60 * 60 * 1000,
        },
        {
          kind: 'tool',
          id: 'rebook',
          tool: 'book_flight',
          label: 'Hold the approved rebook',
          args: { offerId: $('await_traveler_approval.offerId') },
          timeoutMs: 30_000,
        },
      ],
      otherwise: [
        {
          kind: 'pause',
          id: 'await_agent_handoff',
          label: 'Hand off to Sendero agent',
          reason: 'approval',
          payload: { promptId: 'delay-handoff', share: $('plan.share') },
        },
      ],
    },
  ],
};

// ─── book-with-ancillaries: search → list ancillaries → select → book
//
// The canonical "sell-up" flow inside a trip. Searches inventory,
// exposes the airline's ancillary menu (bags, CFAR, seats) via
// `list_flight_ancillaries`, pauses for traveler/operator selection,
// then holds the order with the chosen services attached. Works across
// channels: the pause payload carries the share shape that WhatsApp /
// Slack / web all render.

export const bookWithAncillariesWorkflow: WorkflowDef = {
  id: 'sendero.book_with_ancillaries',
  version: 1,
  label: 'Book a flight with ancillaries',
  description:
    'Canonical sell-up flow: search flights, list the airline ancillary menu (bags, seats, cancel-for-any-reason), pause for traveler selection, then hold the order with selected services attached. Unlocks Travel Support Assistant via ensure_flight_customer.',
  steps: [
    {
      kind: 'tool',
      id: 'ensure_customer',
      tool: 'ensure_flight_customer',
      label: 'Ensure Duffel CustomerUser exists',
      as: 'customer',
      args: {
        clerkUserId: $('input.clerkUserId'),
        tenantId: $('input.tenantId'),
        preferredLanguage: $('input.preferredLanguage'),
      },
      retries: 1,
      timeoutMs: 10_000,
    },
    {
      kind: 'tool',
      id: 'search',
      tool: 'search_flights',
      label: 'Search flights',
      as: 'offers',
      args: {
        origin: $('input.origin'),
        destination: $('input.destination'),
        departureDate: $('input.departureDate'),
        returnDate: $('input.returnDate'),
        passengers: $('input.passengers'),
        cabinClass: $('input.cabinClass'),
      },
      retries: 1,
      timeoutMs: 15_000,
    },
    {
      kind: 'tool',
      id: 'ancillaries',
      tool: 'list_flight_ancillaries',
      label: 'List ancillary services',
      as: 'ancillaries',
      args: {
        offerId: $('offers.topOffer.id'),
        maxSeats: $('input.maxSeats'),
      },
      retries: 1,
      timeoutMs: 15_000,
    },
    {
      kind: 'pause',
      id: 'await_selection',
      label: 'Traveler selects extras',
      reason: 'user_reply',
      payload: {
        promptId: 'sell-ancillaries',
        offerId: $('offers.topOffer.id'),
        share: $('ancillaries.share'),
      },
      timeoutMs: 24 * 60 * 60 * 1000,
    },
    {
      kind: 'tool',
      id: 'hold',
      tool: 'book_flight',
      label: 'Hold flight + attach services',
      as: 'hold',
      args: {
        offerId: $('offers.topOffer.id'),
        services: $('await_selection.services'),
        additionalCustomerUserIds: $('input.additionalCustomerUserIds'),
      },
      timeoutMs: 30_000,
    },
    {
      kind: 'pause',
      id: 'await_duffel_ticket',
      label: 'Awaiting Duffel ticketing',
      reason: 'external_event',
      payload: { via: 'duffel_order_ticketed' },
      timeoutMs: 48 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'duffel_gate',
      label: 'Duffel outcome',
      when: $('await_duffel_ticket.status'),
      equals: 'ticketed',
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'tool',
          id: 'invoice',
          tool: 'generate_booking_invoice',
          label: 'Issue booking invoice',
          args: {
            bookingId: $('hold.orderId'),
          },
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel and refund',
          args: {
            bookingId: $('hold.orderId'),
            tripId: $('input.tripId'),
            reason: 'duffel_failed',
          },
        },
      ],
    },
  ],
};

// ─── cancellation-recovery: order.cancelled / airline-initiated change → rebook or refund
//
// Targets the post-ticket lifecycle: a booked order that Duffel marks
// cancelled (airline pull, schedule change). Triggered by the webhook
// dispatcher when the order has no paused book-flight run (because it
// already completed). Steps: pause for operator/traveler decision →
// branch into rebook via trip_delay_replanner OR refund via
// send_tokens / cancel_booking. The pause payload carries the share
// shape so WhatsApp / Slack / web render the same actionable card.

export const cancellationRecoveryWorkflow: WorkflowDef = {
  id: 'sendero.cancellation_recovery',
  version: 1,
  label: 'Airline cancellation recovery',
  description:
    'Post-ticket recovery triggered by Duffel order.cancelled / airline-initiated change webhooks. Pauses for a traveler/operator decision, then routes into trip_delay_replanner (rebook) or cancel_booking + refund. Canonical across channels.',
  steps: [
    {
      kind: 'pause',
      id: 'await_recovery_decision',
      label: 'Traveler picks rebook vs refund',
      reason: 'user_reply',
      payload: {
        promptId: 'cancellation-recovery',
        via: 'originating_channel',
      },
      timeoutMs: 6 * 60 * 60 * 1000,
    },
    {
      kind: 'branch',
      id: 'recovery_gate',
      label: 'Rebook or refund',
      when: $('await_recovery_decision.action'),
      equals: 'rebook',
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'tool',
          id: 'replan',
          tool: 'trip_delay_replanner',
          label: 'Build rebook plan',
          as: 'plan',
          args: {
            originalLeg: $('input.originalLeg'),
            disruption: { kind: 'cancellation', reason: $('input.cancellationReason') },
            rebookSearch: $('input.rebookSearch'),
            needsHotelFallback: $('input.needsHotelFallback'),
            travelerLabel: $('input.travelerLabel'),
            notifyChannels: $('input.notifyChannels'),
          },
          retries: 1,
          timeoutMs: 20_000,
        },
        {
          kind: 'tool',
          id: 'rebook_hold',
          tool: 'book_flight',
          label: 'Hold rebook offer',
          args: { offerId: $('plan.recommendedRebook.offerId') },
          timeoutMs: 30_000,
        },
      ],
      otherwise: [
        {
          kind: 'tool',
          id: 'cancel',
          tool: 'cancel_booking',
          label: 'Cancel booking on-chain',
          args: {
            bookingId: $('input.bookingId'),
            tripId: $('input.tripId'),
            reason: 'airline_cancelled',
          },
        },
        {
          kind: 'tool',
          id: 'refund',
          tool: 'send_tokens',
          label: 'Refund traveler wallet',
          args: {
            to: $('input.travelerAddress'),
            amount: $('input.refundAmount'),
            token: 'USDC',
          },
        },
      ],
    },
  ],
};

// ─── book-stay-with-loyalty: Stays search → quote → book (with loyalty)
//
// Canonical hotel booking path that threads Duffel CustomerUser identity
// + optional loyalty programme account number through to the booking.
// Surfaces the cancellation timeline on the pause payload so every
// channel sees the same artifact.

export const bookStayWithLoyaltyWorkflow: WorkflowDef = {
  id: 'sendero.book_stay_with_loyalty',
  version: 1,
  label: 'Book a stay with loyalty',
  description:
    'Stays happy path: ensure Duffel customer, search hotels, pause for rate selection, create a quote (exposes cancellation timeline + payment type), pause for final confirmation + loyalty account entry, then book with loyalty_programme_account_number attached.',
  steps: [
    {
      kind: 'tool',
      id: 'ensure_customer',
      tool: 'ensure_flight_customer',
      label: 'Ensure Duffel CustomerUser',
      as: 'customer',
      args: {
        clerkUserId: $('input.clerkUserId'),
        tenantId: $('input.tenantId'),
      },
      retries: 1,
      timeoutMs: 10_000,
    },
    {
      kind: 'tool',
      id: 'search_stays',
      tool: 'search_hotels',
      label: 'Search stays inventory',
      as: 'stays',
      args: {
        location: $('input.location'),
        checkInDate: $('input.checkInDate'),
        checkOutDate: $('input.checkOutDate'),
        guests: $('input.guests'),
        rooms: $('input.rooms'),
      },
      retries: 1,
      timeoutMs: 20_000,
    },
    {
      kind: 'pause',
      id: 'await_rate_pick',
      label: 'Traveler / operator picks a rate',
      reason: 'user_reply',
      payload: {
        promptId: 'stay-rate-pick',
        share: $('stays.share'),
      },
      timeoutMs: 24 * 60 * 60 * 1000,
    },
    {
      kind: 'tool',
      id: 'quote',
      tool: 'quote_stay',
      label: 'Create quote (shows cancellation timeline + loyalty)',
      as: 'quote',
      args: { rateId: $('await_rate_pick.rateId') },
      timeoutMs: 15_000,
    },
    {
      kind: 'pause',
      id: 'await_quote_confirm',
      label: 'Confirm quote + attach loyalty account',
      reason: 'user_reply',
      payload: {
        promptId: 'stay-quote-confirm',
        share: $('quote.share'),
        cancellationTimeline: $('quote.cancellationTimeline'),
        supportedLoyaltyProgramme: $('quote.supportedLoyaltyProgramme'),
      },
      timeoutMs: 60 * 60 * 1000,
    },
    {
      kind: 'tool',
      id: 'book',
      tool: 'book_stay',
      label: 'Book the stay',
      as: 'booking',
      args: {
        quoteId: $('quote.quoteId'),
        email: $('input.email'),
        phoneNumber: $('input.phoneNumber'),
        guests: $('input.guests'),
        loyaltyProgrammeAccountNumber: $('await_quote_confirm.loyaltyAccountNumber'),
        accommodationSpecialRequests: $('await_quote_confirm.specialRequests'),
      },
      timeoutMs: 30_000,
    },
  ],
};

// ─── cancel-order-with-credits: quote → approve → confirm → log
//
// Post-ticket flight cancellation flow. Create the Duffel cancellation
// quote, pause for operator/traveler approval (they see refund
// destination + any airline credits that will issue), confirm within
// the expiry window, then log the final credits for future
// list_airline_credits lookups.

export const cancelOrderWithCreditsWorkflow: WorkflowDef = {
  id: 'sendero.cancel_order_with_credits',
  version: 1,
  label: 'Cancel order with credits',
  description:
    'Flight cancellation: create a quote, pause for approval (operator sees refund destination + any airline credits), then confirm. The confirmation step returns the final credit_code on each airline credit.',
  steps: [
    {
      kind: 'tool',
      id: 'quote',
      tool: 'cancel_order_quote',
      label: 'Build cancellation quote',
      as: 'quote',
      args: { orderId: $('input.orderId') },
      retries: 1,
      timeoutMs: 15_000,
    },
    {
      kind: 'pause',
      id: 'await_approval',
      label: 'Approve cancellation',
      reason: 'approval',
      payload: {
        promptId: 'cancel-order-approval',
        share: $('quote.share'),
        refundAmount: $('quote.refundAmount'),
        refundCurrency: $('quote.refundCurrency'),
        refundTo: $('quote.refundTo'),
        expiresAt: $('quote.expiresAt'),
        airlineCredits: $('quote.airlineCredits'),
      },
      timeoutMs: 2 * 60 * 60 * 1000,
    },
    {
      kind: 'tool',
      id: 'confirm',
      tool: 'confirm_cancel_order',
      label: 'Confirm cancellation',
      as: 'confirmation',
      args: { cancellationId: $('quote.cancellationId') },
      timeoutMs: 20_000,
    },
  ],
};

// ─── verify-travel-documents: passport vault → eligibility verdict ───
//
// Deterministic, no-LLM workflow. Reads sanitized signals from the
// traveler's passport vault, applies the 6-month-validity + visa rules,
// and produces a TravelEligibilityVerdict. Called by book_flight as a
// precondition — a `block` verdict aborts the booking before we touch
// any supplier.

export const verifyTravelDocumentsWorkflow: WorkflowDef = {
  id: 'sendero.verify_travel_documents',
  version: 1,
  label: 'Verify travel documents',
  description:
    "Check a traveler's passport eligibility for an upcoming trip. Reads the encrypted vault (signals only — never names, DOB, or passport#), checks expiry + 6-month rule, runs visa-rules lookup. Returns a pass/warn/block verdict with enum reason codes the UI can render. No PII ever enters the workflow scratchpad or the agent context.",
  steps: [
    {
      kind: 'tool',
      id: 'verdict',
      tool: 'check_travel_eligibility',
      label: 'Check travel eligibility',
      as: 'verdict',
      args: {
        travelerUserId: $('input.travelerUserId'),
        originIso3: $('input.originIso3'),
        destinationIso3: $('input.destinationIso3'),
        departureDate: $('input.departureDate'),
        returnDate: $('input.returnDate'),
        purpose: $('input.purpose'),
      },
      retries: 0,
      timeoutMs: 10_000,
    },
  ],
};

// ─── whatsapp-provision: 5-step Sendero-owned WhatsApp setup ─────────
//
// Replaces the legacy "Connect Meta Business" flow. Sendero owns the
// WABA + phone-number pool via Kapso. Tenant picks a country, we
// reserve a number from the pool, the operator brands the profile,
// approves Sendero's canonical template pack, and flips it live.
//
// Each `pause.payload.promptId` keys into the wizard's right-pane
// renderer (see apps/app/components/channels/setup-wizard/panes.tsx).
// The wizard polls /api/workflows/:runId for the current pause and
// POSTs to /api/workflows/:runId/resume with the form values.

export const whatsappProvisionWorkflow: WorkflowDef = {
  id: 'sendero.whatsapp_provision',
  version: 1,
  label: 'Connect WhatsApp',
  description:
    'Tenant WhatsApp setup wizard via Kapso. Five user-facing steps: choose setup region, complete the Kapso-hosted Meta connection, brand the business profile, approve message templates, and go live with an optional test ping.',
  steps: [
    // Step 1 — setup region
    {
      kind: 'pause',
      id: 'pick_number',
      label: 'Choose setup region',
      reason: 'user_reply',
      payload: {
        promptId: 'whatsapp.pick_number',
        stepIndex: 1,
        totalSteps: 5,
        helpText:
          'Choose the country for the WhatsApp Business number you will connect through Kapso.',
      },
    },
    {
      kind: 'tool',
      id: 'reserve',
      tool: 'kapso_reserve_number',
      label: 'Reserve the chosen number',
      as: 'reservation',
      args: {
        tenantId: $('input.tenantId'),
        tenantName: $('input.tenantName'),
        countryIso: $('pick_number.countryIso'),
        preferredE164: $('pick_number.e164'),
      },
      retries: 1,
      timeoutMs: 30_000,
    },
    // Step 2 — verify Kapso / Meta connection
    {
      kind: 'pause',
      id: 'verify_number',
      label: 'Verify business number',
      reason: 'user_reply',
      payload: {
        promptId: 'whatsapp.verify_number',
        stepIndex: 2,
        totalSteps: 5,
        helpText:
          'Open the Kapso-hosted setup link and approve the WhatsApp Business connection with the correct Meta business user.',
      },
    },
    // Step 3 — brand
    {
      kind: 'pause',
      id: 'brand_profile',
      label: 'Brand the experience',
      reason: 'user_reply',
      payload: {
        promptId: 'whatsapp.brand_profile',
        stepIndex: 3,
        totalSteps: 5,
        helpText: 'Set the display name, profile photo, bio, and default greeting.',
      },
    },
    {
      kind: 'tool',
      id: 'update_profile',
      tool: 'kapso_update_business_profile',
      label: 'Update business profile',
      args: {
        tenantId: $('input.tenantId'),
        displayName: $('brand_profile.displayName'),
        about: $('brand_profile.about'),
        profilePhotoUrl: $('brand_profile.profilePhotoUrl'),
        defaultGreeting: $('brand_profile.defaultGreeting'),
      },
      retries: 1,
      timeoutMs: 20_000,
    },
    // Step 4 — templates
    {
      kind: 'pause',
      id: 'approve_templates',
      label: 'Approve message templates',
      reason: 'user_reply',
      payload: {
        promptId: 'whatsapp.approve_templates',
        stepIndex: 4,
        totalSteps: 5,
        helpText:
          'Sendero ships three canonical templates. Pick the ones you want submitted to Meta.',
        templates: [
          { name: 'trip_intake_v3', description: 'Initial trip-intake greeting.' },
          { name: 'hold_confirmation_v2', description: 'Sent when a hold is placed.' },
          { name: 'cap_warning_v1', description: 'Fires near the spend cap.' },
        ],
      },
    },
    {
      kind: 'tool',
      id: 'submit_templates',
      tool: 'kapso_submit_message_templates',
      label: 'Submit templates to Meta',
      args: {
        tenantId: $('input.tenantId'),
        templateNames: $('approve_templates.templateNames'),
      },
      retries: 1,
      timeoutMs: 20_000,
    },
    // Step 5 — go live (optional test ping, then activate)
    {
      kind: 'pause',
      id: 'go_live',
      label: 'Go live',
      reason: 'user_reply',
      payload: {
        promptId: 'whatsapp.go_live',
        stepIndex: 5,
        totalSteps: 5,
        helpText:
          'Optional: send a test ping to your own phone to confirm the channel works end-to-end.',
      },
    },
    {
      kind: 'branch',
      id: 'maybe_test',
      label: 'Send test if requested',
      when: $('go_live.sendTest'),
      equals: true,
      // biome-ignore lint/suspicious/noThenProperty: BranchStep uses "then" as its workflow-domain field.
      then: [
        {
          kind: 'tool',
          id: 'send_test',
          tool: 'kapso_send_test_message',
          label: 'Send WhatsApp test ping',
          args: {
            tenantId: $('input.tenantId'),
            toE164: $('go_live.testToE164'),
            body: $('go_live.testBody'),
          },
          retries: 0,
          timeoutMs: 20_000,
        },
      ],
      otherwise: [],
    },
    {
      kind: 'tool',
      id: 'activate',
      tool: 'kapso_activate_phone_number',
      label: 'Flip status to active',
      as: 'activation',
      args: { tenantId: $('input.tenantId') },
      retries: 1,
      timeoutMs: 20_000,
    },
  ],
};

// ─── slack-install: 5-step Slack OAuth + routing setup ───────────────
//
// Tenant installs the Sendero Slack app, picks the workspace, decides
// where each event class posts, the bot gets invited, and we send a
// proof-of-life message. Mirrors the WhatsApp wizard's structure so
// the two-pane UI shell stays generic across both channels.

export const slackInstallWorkflow: WorkflowDef = {
  id: 'sendero.slack_install',
  version: 1,
  label: 'Install Sendero in Slack',
  description:
    'Slack OAuth + channel-routing setup. Steps: emit install URL, wait for OAuth callback to write SlackInstall, confirm the workspace, save channel routes per event class, invite the bot, send a test message.',
  steps: [
    // Step 1 — install (auto-runs the tool to get the URL, then pauses)
    {
      kind: 'tool',
      id: 'init_install',
      tool: 'slack_start_oauth_install',
      label: 'Generate Slack install URL',
      as: 'install',
      args: { tenantId: $('input.tenantId') },
      retries: 0,
      timeoutMs: 10_000,
    },
    {
      kind: 'pause',
      id: 'await_oauth_callback',
      label: 'Install Sendero in Slack',
      reason: 'external_event',
      payload: {
        promptId: 'slack.install',
        stepIndex: 1,
        totalSteps: 5,
        helpText:
          'Open the install URL in a new tab and approve the bot scopes. Wizard resumes when the OAuth callback writes the install row.',
        via: 'slack_oauth_callback',
      },
      timeoutMs: 30 * 60 * 1000,
    },
    // Step 2 — pick workspace (Grid customers may have multiple)
    {
      kind: 'pause',
      id: 'pick_workspace',
      label: 'Pick the workspace',
      reason: 'user_reply',
      payload: {
        promptId: 'slack.pick_workspace',
        stepIndex: 2,
        totalSteps: 5,
        helpText: 'Confirm which workspace Sendero should run in.',
      },
    },
    // Step 3 — routes
    {
      kind: 'pause',
      id: 'route_channels',
      label: 'Route channels',
      reason: 'user_reply',
      payload: {
        promptId: 'slack.route_channels',
        stepIndex: 3,
        totalSteps: 5,
        helpText:
          'Pick which channels receive each event class. Defaults route everything to one channel.',
        eventClasses: [
          { id: 'trip_events', label: 'All trip events' },
          { id: 'settlements', label: 'Settlements + invoices' },
          { id: 'cap_warnings', label: 'Spend-cap warnings' },
          { id: 'escalations', label: 'Cap breaches + over-policy holds' },
          { id: 'silent', label: 'Health pings (suppressed)' },
        ],
      },
    },
    {
      kind: 'tool',
      id: 'persist_routes',
      tool: 'slack_persist_channel_routes',
      label: 'Persist routing',
      args: {
        installId: $('pick_workspace.installId'),
        defaultChannelId: $('route_channels.defaultChannelId'),
        routes: $('route_channels.routes'),
      },
      retries: 1,
      timeoutMs: 10_000,
    },
    // Step 4 — invite bot
    {
      kind: 'pause',
      id: 'invite_bot',
      label: 'Invite the bot',
      reason: 'user_reply',
      payload: {
        promptId: 'slack.invite_bot',
        stepIndex: 4,
        totalSteps: 5,
        helpText: 'Sendero will join the channels you routed events to.',
      },
    },
    {
      kind: 'tool',
      id: 'do_invite',
      tool: 'slack_invite_bot_to_channels',
      label: 'Invite Sendero into channels',
      args: {
        installId: $('pick_workspace.installId'),
        channelIds: $('invite_bot.channelIds'),
      },
      retries: 1,
      timeoutMs: 30_000,
    },
    // Step 5 — test
    {
      kind: 'pause',
      id: 'send_test',
      label: 'Send test message',
      reason: 'user_reply',
      payload: {
        promptId: 'slack.send_test',
        stepIndex: 5,
        totalSteps: 5,
        helpText: 'Confirm Sendero can post and you see it land.',
      },
    },
    {
      kind: 'tool',
      id: 'do_send_test',
      tool: 'slack_send_test_message',
      label: 'Send Slack test ping',
      args: {
        installId: $('pick_workspace.installId'),
        channelId: $('send_test.channelId'),
        text: $('send_test.text'),
      },
      retries: 0,
      timeoutMs: 15_000,
    },
  ],
};

export const WORKFLOW_CATALOG: Record<string, WorkflowDef> = {
  [bookFlightWorkflow.id]: bookFlightWorkflow,
  [groupTripWorkflow.id]: groupTripWorkflow,
  [refundWorkflow.id]: refundWorkflow,
  [checkInReminderWorkflow.id]: checkInReminderWorkflow,
  [travelSafetyBriefWorkflow.id]: travelSafetyBriefWorkflow,
  [guestPrefundWorkflow.id]: guestPrefundWorkflow,
  [agencyCohortWorkflow.id]: agencyCohortWorkflow,
  [opsQuoteToBookWorkflow.id]: opsQuoteToBookWorkflow,
  [opsRebookRefundWorkflow.id]: opsRebookRefundWorkflow,
  [opsChannelIntakeWorkflow.id]: opsChannelIntakeWorkflow,
  [opsArtifactPackWorkflow.id]: opsArtifactPackWorkflow,
  [tripDelayReplannerWorkflow.id]: tripDelayReplannerWorkflow,
  [bookWithAncillariesWorkflow.id]: bookWithAncillariesWorkflow,
  [cancellationRecoveryWorkflow.id]: cancellationRecoveryWorkflow,
  [bookStayWithLoyaltyWorkflow.id]: bookStayWithLoyaltyWorkflow,
  [cancelOrderWithCreditsWorkflow.id]: cancelOrderWithCreditsWorkflow,
  [verifyTravelDocumentsWorkflow.id]: verifyTravelDocumentsWorkflow,
  [whatsappProvisionWorkflow.id]: whatsappProvisionWorkflow,
  [slackInstallWorkflow.id]: slackInstallWorkflow,
};

/** Resolve a workflow by id; returns null if unknown. */
export function findWorkflow(id: string): WorkflowDef | null {
  return WORKFLOW_CATALOG[id] ?? null;
}

/** List available workflows for the LLM's prompt or the admin UI. */
export function listWorkflows(): Array<{ id: string; label: string; description?: string }> {
  return Object.values(WORKFLOW_CATALOG).map(w => ({
    id: w.id,
    label: w.label,
    description: w.description,
  }));
}
