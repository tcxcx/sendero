export type BlueprintKind = 'tool' | 'workflow' | 'artifact';

export interface ChannelContract {
  shape: string[];
  notes: string;
}

export interface WebUiBlueprint {
  primary: string[];
  optional?: string[];
  visualMode: 'chat' | 'artifact' | 'workflow-canvas' | 'dashboard' | 'timeline' | 'hybrid';
  emilGuidance: string[];
}

export interface TripAssistanceBlueprint {
  id: string;
  kind: BlueprintKind;
  extendsExisting: string[];
  newApisNeeded: string[];
  summary: string;
  web: WebUiBlueprint;
  mcp: ChannelContract;
  whatsapp: ChannelContract;
  slack: ChannelContract;
}

export const tripAssistanceBlueprints: TripAssistanceBlueprint[] = [
  {
    id: 'trip_delay_replanner',
    kind: 'tool',
    extendsExisting: ['search_flights', 'search_hotels', 'export_route_map', 'sendero.book_flight'],
    newApisNeeded: [],
    summary: 'Rebuild the next safe plan after delay, cancellation, or missed connection.',
    web: {
      primary: ['message', 'tool', 'reasoning', 'suggestion'],
      optional: ['canvas', 'node', 'edge', 'panel'],
      visualMode: 'hybrid',
      emilGuidance: [
        'Prioritize the best next option visually.',
        'Use fast ease-out transitions for disruption-state changes.',
        'Keep branch animations explanatory, not decorative.',
      ],
    },
    mcp: {
      shape: ['summary', 'rebookOptions', 'hotelFallback', 'notify', 'share'],
      notes: 'Canonical JSON should describe the preferred next plan and fallback branches.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Lead with what changed and what the traveler should do next.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta', 'secondaryCtas'],
      notes: 'Best option first, alternates after, with approval-friendly formatting.',
    },
  },
  {
    id: 'airport_transfer_coordinator',
    kind: 'tool',
    extendsExisting: [
      'validate_travel_address',
      'geocode_trip_stop',
      'travel_safety_aid',
      'export_route_map',
    ],
    newApisNeeded: [],
    summary:
      'Turn arrival details into a pickup plan with meeting-point confidence and backup transport.',
    web: {
      primary: ['artifact', 'message', 'tool'],
      optional: ['image', 'attachments'],
      visualMode: 'artifact',
      emilGuidance: [
        'Design for a traveler walking fast with luggage.',
        'Keep the primary pickup instruction visually dominant.',
        'Preview maps and meeting points should feel calm and grounded.',
      ],
    },
    mcp: {
      shape: ['summary', 'pickupPlan', 'backupTransport', 'routeLinks', 'share'],
      notes: 'Return transport instructions as deterministic structured data.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Keep it short enough to read while on the move.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta', 'mapLinks'],
      notes: 'Render clean pickup and fallback actions.',
    },
  },
  {
    id: 'check_in_doc_guard',
    kind: 'tool',
    extendsExisting: ['timezone_brief'],
    newApisNeeded: ['passport/visa rules provider (later)'],
    summary: 'Check critical travel documents and flag likely blockers before departure.',
    web: {
      primary: ['artifact', 'tool', 'message'],
      optional: ['attachments'],
      visualMode: 'artifact',
      emilGuidance: [
        'Checklist hierarchy must be obvious at a glance.',
        'Missing items should stand out without making the screen feel alarming.',
        'Document upload affordances should be light and immediate.',
      ],
    },
    mcp: {
      shape: ['summary', 'checklist', 'missingItems', 'warnings', 'share'],
      notes: 'v1 can be rules/checklist based before external document APIs are added.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'List only the missing or risky items.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Works well as a pre-departure checklist message.',
    },
  },
  {
    id: 'hotel_arrival_brief',
    kind: 'tool',
    extendsExisting: [
      'validate_travel_address',
      'geocode_trip_stop',
      'travel_safety_aid',
      'export_route_map',
    ],
    newApisNeeded: [],
    summary: 'Generate a complete hotel check-in and arrival packet.',
    web: {
      primary: ['artifact', 'message', 'tool'],
      optional: ['image', 'attachments'],
      visualMode: 'artifact',
      emilGuidance: [
        'Hospitality tone matters more than dashboard density.',
        'Maps, phone numbers, and arrival notes should be easy to scan on mobile.',
        'Avoid noisy chrome around the content.',
      ],
    },
    mcp: {
      shape: ['summary', 'hotel', 'arrivalNotes', 'routeLinks', 'nearbyFallbacks', 'share'],
      notes: 'Treat hotel arrival as a structured packet, not a paragraph.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Optimize for immediate use at curbside or reception.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta', 'mapLinks'],
      notes: 'Include hotel contact details and route links.',
    },
  },
  {
    id: 'jetlag_schedule_builder',
    kind: 'tool',
    extendsExisting: ['timezone_brief'],
    newApisNeeded: [],
    summary: 'Build a landing-day and first-48-hours schedule to reduce jet lag.',
    web: {
      primary: ['artifact', 'message', 'reasoning'],
      optional: ['task', 'checkpoint'],
      visualMode: 'timeline',
      emilGuidance: [
        'Keep the timeline airy and calm.',
        'Use soft sequencing rather than loud alerts.',
        'This should feel like guidance, not compliance software.',
      ],
    },
    mcp: {
      shape: ['summary', 'schedule', 'sleepWindows', 'caffeineWindows', 'warnings'],
      notes: 'Should produce explicit local-time schedule blocks.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Simple time blocks only.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Can include a slightly richer timeline summary.',
    },
  },
  {
    id: 'local_transit_navigator',
    kind: 'tool',
    extendsExisting: ['export_route_map'],
    newApisNeeded: ['live transit feeds (optional later)'],
    summary: 'Explain the best local transport mix for a city or leg of a trip.',
    web: {
      primary: ['message', 'tool', 'sources'],
      optional: ['canvas'],
      visualMode: 'hybrid',
      emilGuidance: [
        'Present one best movement strategy, not a wall of comparisons.',
        'Alternate routes should be quieter than the primary route.',
        'Route comparison transitions should be quick and legible.',
      ],
    },
    mcp: {
      shape: ['summary', 'bestMode', 'alternatives', 'ticketingNotes', 'routeLinks'],
      notes: 'Should normalize practical movement advice into structured fields.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Keep options to one preferred mode plus one fallback.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Good fit for route summaries and ticket-buying notes.',
    },
  },
  {
    id: 'expense_capture_assistant',
    kind: 'workflow',
    extendsExisting: ['generate_booking_invoice'],
    newApisNeeded: ['OCR receipt parser (optional later)'],
    summary: 'Collect missing receipts and package a reimbursement-ready expense trail.',
    web: {
      primary: ['conversation', 'message', 'tool', 'attachments'],
      optional: ['task', 'queue'],
      visualMode: 'chat',
      emilGuidance: [
        'Attachment flow should feel invisible and low-friction.',
        'Use minimal animation because this is repetitive admin work.',
        'Progress states should be clear without looking bureaucratic.',
      ],
    },
    mcp: {
      shape: ['summary', 'missingReceipts', 'categorizedExpenses', 'nextSteps', 'share'],
      notes: 'Should work as an assistant workflow around existing finance objects.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Ask for missing receipts with direct reply instructions.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Works well as a follow-up workflow in corporate channels.',
    },
  },
  {
    id: 'trip_checkin_reminder',
    kind: 'workflow',
    extendsExisting: ['sendero.check_in_reminder', 'export_route_map'],
    newApisNeeded: [],
    summary:
      'Remind the traveler before each leg with check-in timing and airport movement context.',
    web: {
      primary: ['message', 'suggestion'],
      optional: ['task', 'checkpoint'],
      visualMode: 'chat',
      emilGuidance: [
        'This is a high-frequency reminder surface; keep motion almost nonexistent.',
        'Focus on timing and one obvious action.',
        'Do not crowd the message with low-value metadata.',
      ],
    },
    mcp: {
      shape: ['summary', 'checkInWindow', 'airportTransitNote', 'nextAction'],
      notes:
        'This should be an extension of the existing reminder workflow, not a separate system.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Simple nudge with one reply prompt.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Useful for employee travel reminders.',
    },
  },
  {
    id: 'emergency_support_router',
    kind: 'tool',
    extendsExisting: ['travel_safety_aid', 'export_route_map'],
    newApisNeeded: ['embassy/emergency dataset (optional later)'],
    summary: 'Route the traveler to the nearest appropriate support option in an emergency.',
    web: {
      primary: ['artifact', 'message', 'tool'],
      optional: ['canvas'],
      visualMode: 'artifact',
      emilGuidance: [
        'Urgency must be communicated without visual panic.',
        'Emergency actions should be immediately tappable.',
        'Hierarchy must foreground call-now and go-now actions.',
      ],
    },
    mcp: {
      shape: ['summary', 'nearestOptions', 'emergencyNumbers', 'routeLinks', 'warnings'],
      notes: 'Start with place search plus curated emergency numbers.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Lead with numbers and nearest safe destination.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Corporate/support teams should see the same structured urgent actions.',
    },
  },
  {
    id: 'meeting_to_itinerary_sync',
    kind: 'workflow',
    extendsExisting: ['export_route_map', 'timezone_brief'],
    newApisNeeded: ['Google Calendar (later)', 'Gmail (later)', 'Slack event ingestion (later)'],
    summary: 'Convert meetings into movement-safe itinerary plans with buffers and route actions.',
    web: {
      primary: ['conversation', 'tool', 'artifact'],
      optional: ['canvas', 'node', 'edge'],
      visualMode: 'hybrid',
      emilGuidance: [
        'Order and timing are the visual story.',
        'Movement between meetings should feel structured, not chaotic.',
        'Canvas view should emphasize path continuity.',
      ],
    },
    mcp: {
      shape: ['summary', 'itinerary', 'movementBlocks', 'buffers', 'routeLinks'],
      notes: 'Workflow-first design; inputs can later be sourced from calendar/mail connectors.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Send only the next movement-critical pieces.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Great fit for work travel coordination.',
    },
  },
  {
    id: 'trip_command_center',
    kind: 'artifact',
    extendsExisting: ['all active trip tools and workflows'],
    newApisNeeded: [],
    summary: 'Unified web command center for live trip operations.',
    web: {
      primary: ['conversation', 'tool', 'panel', 'reasoning'],
      optional: ['agent', 'task', 'queue'],
      visualMode: 'dashboard',
      emilGuidance: [
        'Dense but breathable information layout.',
        'The whole screen should feel premium, not utilitarian.',
        'Use motion only to direct attention to state changes.',
      ],
    },
    mcp: {
      shape: ['summary', 'tripState', 'activeSteps', 'warnings'],
      notes: 'This is mainly a web artifact backed by existing tool outputs.',
    },
    whatsapp: {
      shape: ['title', 'body'],
      notes: 'Not a primary messaging surface; emit condensed summaries only.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Can publish compact operational snapshots.',
    },
  },
  {
    id: 'booking_workflow_map',
    kind: 'artifact',
    extendsExisting: ['workflow runner metadata'],
    newApisNeeded: [],
    summary: 'Visualize booking state across search, policy, reserve, hold, settle, and invoice.',
    web: {
      primary: ['canvas', 'node', 'edge', 'toolbar', 'panel'],
      optional: ['checkpoint'],
      visualMode: 'workflow-canvas',
      emilGuidance: [
        'Animate state changes to explain progression, not to entertain.',
        'Distinguish active, blocked, and completed nodes clearly.',
        'Keep the graph mechanically precise.',
      ],
    },
    mcp: {
      shape: ['summary', 'nodes', 'edges', 'status'],
      notes: 'Canonical workflow graph can back both web and agent inspection.',
    },
    whatsapp: {
      shape: ['title', 'body'],
      notes: 'Send only a textual run summary.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Post condensed workflow state instead of full graph.',
    },
  },
  {
    id: 'delay_recovery_board',
    kind: 'artifact',
    extendsExisting: [
      'trip_delay_replanner',
      'airport_transfer_coordinator',
      'hotel_arrival_brief',
    ],
    newApisNeeded: [],
    summary: 'A branching operational board for disruption recovery.',
    web: {
      primary: ['canvas', 'panel', 'tool', 'message'],
      optional: ['checkpoint', 'task'],
      visualMode: 'workflow-canvas',
      emilGuidance: [
        'Branches need visual order and confidence, not spaghetti.',
        'Failure branches should be obvious but not visually overwhelming.',
        'Use subtle status pulses only for live active nodes.',
      ],
    },
    mcp: {
      shape: ['summary', 'branches', 'recommendedPath', 'share'],
      notes: 'Artifact composed from several existing or planned recovery tools.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Only send the chosen path and one fallback.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Useful for human oversight during disruptions.',
    },
  },
  {
    id: 'restaurant_route_card',
    kind: 'tool',
    extendsExisting: ['recommend_restaurants', 'export_route_map'],
    newApisNeeded: [],
    summary: 'Combine place recommendations with route export and a polished share card.',
    web: {
      primary: ['artifact', 'message', 'tool'],
      optional: ['image', 'attachments'],
      visualMode: 'artifact',
      emilGuidance: [
        'This should feel like a premium concierge recommendation card.',
        'Lead with one or two strong options, not a directory dump.',
        'Map preview should look intentionally framed.',
      ],
    },
    mcp: {
      shape: ['summary', 'restaurants', 'routeLinks', 'previewCard', 'share'],
      notes: 'Fast win because it extends two existing tools directly.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Shortlist only the best picks.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta', 'secondaryCtas'],
      notes: 'Great fit for team or concierge recommendations.',
    },
  },
  {
    id: 'traveler_safety_console',
    kind: 'artifact',
    extendsExisting: ['travel_safety_aid', 'trip_weather_brief', 'air_quality_brief'],
    newApisNeeded: [],
    summary: 'Unified destination and route risk view for the active traveler.',
    web: {
      primary: ['panel', 'tool', 'reasoning', 'message'],
      optional: ['canvas'],
      visualMode: 'dashboard',
      emilGuidance: [
        'Use disciplined color; danger should mean danger.',
        'Hierarchy should separate risks from recommendations.',
        'Avoid alert fatigue in the layout.',
      ],
    },
    mcp: {
      shape: ['summary', 'riskLevel', 'risks', 'mitigations', 'share'],
      notes: 'Artifact over existing safety primitives.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Focus on mitigations, not every underlying datapoint.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Good fit for support and traveler updates.',
    },
  },
  {
    id: 'approval_flow_designer',
    kind: 'artifact',
    extendsExisting: ['existing workflow system', 'policy checks', 'Slack approvals'],
    newApisNeeded: [],
    summary: 'Tenant-facing builder for travel approvals and escalation paths.',
    web: {
      primary: ['canvas', 'node', 'edge', 'toolbar'],
      optional: ['confirmation', 'checkpoint'],
      visualMode: 'workflow-canvas',
      emilGuidance: [
        'Precision matters more than visual flair.',
        'Editing interactions should feel tactile and immediate.',
        'Nodes should communicate meaning through structure, not decoration.',
      ],
    },
    mcp: {
      shape: ['summary', 'approvalGraph', 'rules'],
      notes: 'Internal/admin-facing artifact over the existing workflow DSL.',
    },
    whatsapp: {
      shape: ['title', 'body'],
      notes: 'Not a primary channel; emit approvals from the resulting workflow instead.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Designed to feed Slack approval workflows, not replace them.',
    },
  },
  {
    id: 'expense_reconciliation_trace',
    kind: 'artifact',
    extendsExisting: ['billing', 'invoicing', 'settlement logs', 'meter events'],
    newApisNeeded: [],
    summary: 'Trace expenses, settlements, and receipts across the trip lifecycle.',
    web: {
      primary: ['tool', 'panel', 'code-block'],
      optional: ['canvas', 'checkpoint'],
      visualMode: 'timeline',
      emilGuidance: [
        'Financial chronology should be obvious at a glance.',
        'Use mono and spacing to signal auditability.',
        'Motion should be nearly absent except for state reveal.',
      ],
    },
    mcp: {
      shape: ['summary', 'events', 'gaps', 'nextSteps'],
      notes: 'Artifact on top of existing financial records.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Only send concise reimbursement or gap updates.',
    },
    slack: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Ops-friendly expense trace summaries.',
    },
  },
  {
    id: 'airport_arrival_playbook',
    kind: 'tool',
    extendsExisting: ['airport_transfer_coordinator', 'travel_safety_aid', 'export_route_map'],
    newApisNeeded: [],
    summary:
      'Deliver a one-screen arrival briefing for the destination airport and onward movement.',
    web: {
      primary: ['artifact', 'message', 'attachments'],
      optional: ['image', 'tool'],
      visualMode: 'artifact',
      emilGuidance: [
        'A traveler should understand the arrival plan in one glance.',
        'Visual calm matters because this is used under stress.',
        'Maps and instructions should feel anchored and trustworthy.',
      ],
    },
    mcp: {
      shape: ['summary', 'arrivalSteps', 'contacts', 'routeLinks', 'share'],
      notes: 'Narrow traveler-facing artifact assembled from existing route and safety primitives.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Optimize for curbside use on a phone.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Useful for support desks and coordinated arrivals.',
    },
  },
  {
    id: 'multi_stop_itinerary_editor',
    kind: 'artifact',
    extendsExisting: ['export_route_map', 'geocode_trip_stop', 'recommend_restaurants'],
    newApisNeeded: [],
    summary: 'Edit and visualize multi-stop plans as a first-class route workflow.',
    web: {
      primary: ['canvas', 'node', 'edge', 'toolbar'],
      optional: ['attachments', 'artifact'],
      visualMode: 'workflow-canvas',
      emilGuidance: [
        'Dragging and reordering must feel fast and tactile.',
        'Use subtle compression and snap feedback instead of heavy motion.',
        'The path should read clearly even with many stops.',
      ],
    },
    mcp: {
      shape: ['summary', 'stops', 'routeLinks', 'share'],
      notes:
        'The canonical data model must remain simple enough for agents and messaging channels.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets', 'mapLinks'],
      notes: 'Send only the ordered stops plus primary route link.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Good fit for group or field-team movement plans.',
    },
  },
  {
    id: 'agent_handoff_timeline',
    kind: 'artifact',
    extendsExisting: ['workflow run logs', 'chat turns', 'log_agent_action', 'approvals'],
    newApisNeeded: [],
    summary: 'Show where automation ended, why escalation happened, and who owns the next step.',
    web: {
      primary: ['conversation', 'checkpoint', 'task', 'tool'],
      optional: ['canvas'],
      visualMode: 'timeline',
      emilGuidance: [
        'Ownership changes should be instantly legible.',
        'Timeline rhythm should feel calm and trustworthy.',
        'Use transitions only to preserve continuity when state changes.',
      ],
    },
    mcp: {
      shape: ['summary', 'timeline', 'handoffOwner', 'openActions'],
      notes: 'Artifact assembled from existing workflow, chat, and approval logs.',
    },
    whatsapp: {
      shape: ['title', 'body', 'bullets'],
      notes: 'Only send the current owner and next action.',
    },
    slack: {
      shape: ['title', 'body', 'bullets', 'primaryCta'],
      notes: 'Best channel for operational escalation summaries.',
    },
  },
];
