export type OpsChainStatus = 'ready' | 'partial' | 'gap';

export type OpsChainStep = {
  label: string;
  detail: string;
  status: OpsChainStatus;
};

export type OpsGapPrompt = {
  id: string;
  bucket: string;
  gap: string;
  readiness: number;
  workflowId?: string;
  skills: string[];
  prompt: string;
  chain: OpsChainStep[];
  doneSignal: string;
};

const sharedProductContext =
  'Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.';

export const opsGapPrompts: OpsGapPrompt[] = [
  {
    id: 'operator-workspace',
    bucket: 'Agency/TMC copilot workspace',
    gap: 'A real operator queue with owners, next actions, SLA, channel, evidence, and state.',
    readiness: 55,
    workflowId: 'sendero.ops_quote_to_book',
    skills: ['$impeccable craft', '$nextjs-app-router-patterns', '$writing-clearly-and-concisely'],
    prompt: [
      'Use $impeccable craft, $nextjs-app-router-patterns, and $writing-clearly-and-concisely.',
      sharedProductContext,
      'Build the protected operator workspace for /app/ops. It must not look like a marketing page. Show a dense but calm queue of active travel work, grouped by request state: intake, quote review, approval, booking, service, refund, and reconciliation. Each row needs an owner, source channel, next action, evidence, policy state, money state, and a link to the trip or invoice. Use existing Sendero data where available and honest placeholders only where the platform still needs integrations.',
      'Output: production code, accessible UI, concise operator copy, no nested cards, no generic AI dashboard decoration.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Resolve tenant workspace',
        detail:
          'Load tenant, trips, bookings, invoices, and channel identities for one operator view.',
        status: 'ready',
      },
      {
        label: 'Group work by next action',
        detail:
          'Classify trips into intake, quote review, approval, booking, service, refund, and reconciliation lanes.',
        status: 'partial',
      },
      {
        label: 'Expose review evidence',
        detail:
          'Surface policy state, supplier refs, escrow state, invoice state, and channel source.',
        status: 'partial',
      },
      {
        label: 'Assign owner and SLA',
        detail: 'Persist queue ownership, due time, and escalation rules per tenant.',
        status: 'gap',
      },
    ],
    doneSignal:
      'An agency operator can open one workspace and know which travel request needs action next.',
  },
  {
    id: 'quote-builder',
    bucket: 'Quote builder',
    gap: 'Inbound request to options matrix, fare-rule summary, policy result, and client-ready quote.',
    readiness: 50,
    workflowId: 'sendero.ops_quote_to_book',
    skills: ['$impeccable craft', '$nextjs-app-router-patterns', '$native-data-fetching'],
    prompt: [
      'Use $impeccable craft, $nextjs-app-router-patterns, and $native-data-fetching.',
      sharedProductContext,
      'Implement a quote-builder chain for travel operators. Start from a messy inbound request, normalize origin, destination, dates, traveler count, budget, policy, and traveler preferences. Search flight and hotel inventory, compare options, check policy, and prepare an editable quote matrix. The operator must be able to see why an option is recommended, what violates policy, what needs approval, and what can be booked now.',
      'Output: quote-to-book workflow, UI chain state, and compact copy that an operator can send to a client.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Intake request',
        detail: 'Parse channel text into structured travel intent and missing questions.',
        status: 'partial',
      },
      {
        label: 'Search inventory',
        detail: 'Call flight and hotel search tools with policy-aware constraints.',
        status: 'ready',
      },
      {
        label: 'Compare options',
        detail:
          'Rank offers by price, duration, cancellation terms, policy, and traveler preference.',
        status: 'partial',
      },
      {
        label: 'Operator quote review',
        detail: 'Pause for edits before sending a quote or booking the approved option.',
        status: 'partial',
      },
    ],
    doneSignal:
      'Sendero can turn a request into an approval-ready quote faster than a human agent starting from a blank GDS search.',
  },
  {
    id: 'rebooking-refunds',
    bucket: 'Rebooking and refund desk',
    gap: 'Post-ticket servicing: changes, cancellations, refunds, disruption alternatives, and audit trail.',
    readiness: 35,
    workflowId: 'sendero.ops_rebook_refund',
    skills: ['$nextjs-app-router-patterns', '$investigate', '$writing-clearly-and-concisely'],
    prompt: [
      'Use $nextjs-app-router-patterns, $investigate, and $writing-clearly-and-concisely.',
      sharedProductContext,
      'Build the rebooking/refund desk for already-booked trips. The operator should import or open a booking, inspect ticketing state, cancellation rules, refundability, fare difference, traveler urgency, and policy. The system should propose change/refund options, pause for approval, execute cancellation/refund where supported, and create an audit memo.',
      'Output: a service workflow that makes the current placeholder refund flow honest, visible, and ready for supplier-specific integrations.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Open booking evidence',
        detail:
          'Load PNR/order id, raw supplier payload, ticketing status, and settlement records.',
        status: 'partial',
      },
      {
        label: 'Compute options',
        detail:
          'Compare keep, rebook, cancel, refund, and credit paths with costs and constraints.',
        status: 'gap',
      },
      {
        label: 'Approve service action',
        detail:
          'Pause for manager or traveler confirmation before touching supplier or money state.',
        status: 'partial',
      },
      {
        label: 'Execute and memo',
        detail: 'Run cancel/refund tools, then issue a concise audit memo and invoice/credit note.',
        status: 'partial',
      },
    ],
    doneSignal:
      'An operator can handle a disruption without losing the supplier evidence, money trail, or customer explanation.',
  },
  {
    id: 'embedded-tools',
    bucket: 'Existing-tool embedding',
    gap: 'The product needs to live in email, Slack, WhatsApp, CRM, MCP, and later GDS/NDC surfaces.',
    readiness: 45,
    workflowId: 'sendero.ops_channel_intake',
    skills: [
      '$nextjs-app-router-patterns',
      '$native-data-fetching',
      '$writing-clearly-and-concisely',
    ],
    prompt: [
      'Use $nextjs-app-router-patterns, $native-data-fetching, and $writing-clearly-and-concisely.',
      sharedProductContext,
      'Implement the channel-embedded travel ops chain. Show how a request enters from email, Slack, WhatsApp, web, MCP, or CRM, resolves to one tenant/traveler/trip/session, and returns the next best action back to that same channel. Keep GDS/NDC as an explicit integration lane, not a fake finished integration.',
      'Output: a connector status surface and a channel-intake chain that proves Sendero fits existing travel operations instead of forcing a new inbox.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Capture inbound channel',
        detail: 'Normalize WhatsApp, Slack, email, web, and MCP requests into one session model.',
        status: 'partial',
      },
      {
        label: 'Resolve identity',
        detail:
          'Map external channel identities to tenant, traveler, policy, preferences, and open trips.',
        status: 'ready',
      },
      {
        label: 'Route next action',
        detail:
          'Send quote, approval, booking, refund, or invoice actions back to the originating channel.',
        status: 'partial',
      },
      {
        label: 'Add CRM/GDS adapters',
        detail:
          'Sync request records and import supplier booking evidence from professional systems.',
        status: 'gap',
      },
    ],
    doneSignal:
      'A travel team can keep using its existing channels while Sendero runs the operational state machine.',
  },
  {
    id: 'professional-artifacts',
    bucket: 'Professional artifacts',
    gap: 'Quotes, itineraries, policy exception memos, refund memos, and reconciliation packs.',
    readiness: 40,
    workflowId: 'sendero.ops_artifact_pack',
    skills: ['$writing-clearly-and-concisely', '$impeccable craft', '$nextjs-app-router-patterns'],
    prompt: [
      'Use $writing-clearly-and-concisely, $impeccable craft, and $nextjs-app-router-patterns.',
      sharedProductContext,
      'Create the professional artifact pack. For each operator action, generate a clear artifact: quote, itinerary, policy exception memo, refund/change memo, and invoice reconciliation pack. Each artifact must cite the source facts used: traveler request, selected offers, policy result, supplier refs, settlement tx, invoice, and approval.',
      'Output: artifact templates and previews that look operational, printable, and ready to send to a client or finance team.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Collect evidence',
        detail:
          'Gather trip intent, booking records, policy checks, approvals, invoices, and settlements.',
        status: 'partial',
      },
      {
        label: 'Draft artifact',
        detail: 'Generate operator-grade copy with source facts and no promotional language.',
        status: 'partial',
      },
      {
        label: 'Review and send',
        detail: 'Pause for operator edits, then send to channel, PDF, email, or finance export.',
        status: 'gap',
      },
      {
        label: 'Version history',
        detail: 'Store sent artifact versions for audit and dispute resolution.',
        status: 'gap',
      },
    ],
    doneSignal:
      'Every high-stakes travel action produces a client-ready artifact and an internal evidence trail.',
  },
  {
    id: 'positioning',
    bucket: 'Positioning',
    gap: 'The product story should lead with travel operations, not generic AI travel planning.',
    readiness: 70,
    skills: ['$writing-clearly-and-concisely', '$impeccable craft'],
    prompt: [
      'Use $writing-clearly-and-concisely and $impeccable craft.',
      sharedProductContext,
      'Rewrite Sendero positioning so it is unmistakably the AI operating layer for travel agencies, TMCs, concierge teams, and corporate travel desks. Do not lead with itinerary inspiration. Lead with quote-to-book, policy, approvals, changes, refunds, reconciliation, channels, and audit. Arc/Circle settlement should appear as the trust and money backplane, not the headline gimmick.',
      'Output: concise product copy for marketing, app dashboard, docs, and demo narration.',
    ].join('\n\n'),
    chain: [
      {
        label: 'Name the category',
        detail: 'Use Vertical AI for travel operations and AI workspace for travel sellers.',
        status: 'ready',
      },
      {
        label: 'Make the wedge concrete',
        detail: 'Lead with agency/TMC quote-to-book and service desk workflows.',
        status: 'partial',
      },
      {
        label: 'Support with proof',
        detail:
          'Show real inventory, policy checks, approval pauses, escrow, invoices, and channel state.',
        status: 'partial',
      },
      {
        label: 'Remove consumer planner drift',
        detail:
          'Audit pages for copy that sounds like inspiration travel instead of operator labor reduction.',
        status: 'gap',
      },
    ],
    doneSignal:
      'A judge, agency owner, or TMC operator can understand in one minute why Sendero is not another trip planner.',
  },
];

export const opsChainSummary = {
  title: 'Vertical AI for travel operations',
  subtitle:
    'The chain that turns Sendero from agentic booking rails into a Legora-style travel ops workspace.',
  thesis:
    'Sendero should own quote-to-book, rebooking, approvals, refunds, artifacts, and reconciliation for agencies, TMCs, concierge teams, and corporate travel desks.',
};

export function readinessLabel(readiness: number): string {
  if (readiness >= 70) return 'strong';
  if (readiness >= 50) return 'working';
  if (readiness >= 35) return 'early';
  return 'gap';
}
