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
  version: 1,
  label: 'Book a flight',
  description:
    'Escrow-backed booking: the trip must already be prefunded via prefund_trip. Searches Duffel inventory, validates policy, reserves escrow upper-bound, holds the offer, commits the actual vendor amount, waits for Duffel ticketing (via webhook), then releases escrow to vendor + fee legs on ticket confirmation, or refunds the buyer on failure.',
  steps: [
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
          tool: 'confirm_duffel',
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
  version: 1,
  label: 'Check-in reminder',
  description:
    'Fires 24 hours before departure. Sends a WhatsApp (or email fallback) nudge with the PNR + a "need anything?" prompt that becomes the start of an in-trip chat.',
  steps: [
    {
      kind: 'tool',
      id: 'fetch_booking',
      tool: 'check_treasury', // placeholder — swap for `get_booking_status` when added
      label: 'Fetch booking',
      args: {},
    },
    {
      kind: 'pause',
      id: 'await_traveler_reply',
      label: 'Traveler replies',
      reason: 'user_reply',
      timeoutMs: 12 * 60 * 60 * 1000, // 12h
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
          tool: 'confirm_duffel',
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

export const WORKFLOW_CATALOG: Record<string, WorkflowDef> = {
  [bookFlightWorkflow.id]: bookFlightWorkflow,
  [groupTripWorkflow.id]: groupTripWorkflow,
  [refundWorkflow.id]: refundWorkflow,
  [checkInReminderWorkflow.id]: checkInReminderWorkflow,
  [guestPrefundWorkflow.id]: guestPrefundWorkflow,
  [agencyCohortWorkflow.id]: agencyCohortWorkflow,
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
