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
    'Searches Duffel inventory, validates against the active corporate policy (if any), holds the offer, confirms once the traveler replies approved, then settles the commission fan-out on Arc.',
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

export const WORKFLOW_CATALOG: Record<string, WorkflowDef> = {
  [bookFlightWorkflow.id]: bookFlightWorkflow,
  [groupTripWorkflow.id]: groupTripWorkflow,
  [refundWorkflow.id]: refundWorkflow,
  [checkInReminderWorkflow.id]: checkInReminderWorkflow,
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
