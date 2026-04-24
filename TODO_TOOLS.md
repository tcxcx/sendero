# TODO Tools

Canonical backlog for the next 20 Sendero trip-assistance tools and workflows.

This file is the implementation contract for:
- MCP-first tool design
- AI Elements web UI
- WhatsApp and Slack-safe output shapes
- extending existing Sendero integrations before adding new ones
- Emil-grade polish, motion, and component craft for every user-facing tool

## Rules

1. New public tools should land in `packages/tools/src` and be registered through `packages/tools/src/index.ts`.
2. Multi-step orchestration should prefer named workflows in `packages/workflows/src/catalog.ts`.
3. If a problem can be solved by composing existing tools plus prompt logic, do that before adding a new external API.
4. Every tool should produce:
   - a canonical MCP JSON result
   - a web artifact that renders well with AI Elements
   - a messaging-safe summary for WhatsApp and Slack
5. AI-generated narrative must render through `MessageResponse` on web.
6. Tool outputs that represent steps, branches, or state transitions should have a workflow-canvas representation using AI Elements `canvas`, `node`, `edge`, `panel`, and `toolbar` when useful.
7. Beautiful is not optional: every web-facing tool should ship with a deliberate AI Elements composition and Emil-style motion rules, not a raw JSON dump with generic cards.

## Existing Foundations To Reuse

- Flights and booking: `search_flights`, `book_flight`, `confirm_duffel`, `settle_booking`, `cancel_booking`
- Hotels: `search_hotels`
- Escrow and settlement: `prefund_trip`, `reserve_booking`, `commit_booking`, `settle_split`, `generate_booking_invoice`
- Trip safety and destination context:
  - `geocode_trip_stop`
  - `trip_weather_brief`
  - `air_quality_brief`
  - `validate_travel_address`
  - `timezone_brief`
  - `elevation_risk_brief`
  - `travel_safety_aid`
  - `recommend_restaurants`
  - `export_route_map`
- Existing workflows:
  - `sendero.book_flight`
  - `sendero.travel_safety_brief`
  - `sendero.check_in_reminder`
  - `sendero.group_trip`

## Canonical Surface Contract

### MCP

Every public tool should expose:
- `name`
- `description`
- `jsonSchema`
- deterministic JSON output
- no UI-only fields without a canonical data equivalent

Recommended shared output fields:
- `summary`
- `status`
- `actions`
- `warnings`
- `artifacts`
- `share`

### Web

Preferred AI Elements mapping:
- conversational explanation: `conversation`, `message`, `reasoning`, `tool`
- visual workflow state: `canvas`, `node`, `edge`, `controls`, `panel`
- shareable cards and artifacts: `message`, `code-block`, `sources`, `shimmer`
- rich input: `prompt-input`

Emil-grade defaults:
- avoid `transition: all`
- prefer fast `ease-out` for UI entry
- keep repetitive interaction motion under 250ms
- use subtle press feedback on interactive cards and buttons
- avoid scale-from-zero
- use origin-aware popovers and route panels
- stagger only when it improves comprehension, not decoration-for-decoration

### WhatsApp / Slack

Every tool should provide a lightweight `share` shape:
- `title`
- `body`
- `bullets`
- `primaryCta`
- `secondaryCtas`
- `mapLinks` when relevant

For WhatsApp:
- plain text first
- short bullets
- URLs inline

For Slack:
- block-friendly sections
- short headers
- buttons/links when possible

## Tool Catalog

| ID | Kind | Reuse First | New APIs Needed | Web UI Pattern | WhatsApp/Slack Pattern |
| --- | --- | --- | --- | --- | --- |
| `trip_delay_replanner` | Tool + workflow | `search_flights`, `search_hotels`, `export_route_map`, `sendero.book_flight` | None in v1. Optional later: flight-status feed beyond supplier data | Tool card + workflow canvas showing old leg, disruption, new plan | concise reroute summary with next flight, hotel fallback, notify list |
| `airport_transfer_coordinator` | Tool | `validate_travel_address`, `geocode_trip_stop`, `export_route_map`, `travel_safety_aid` | None in v1. Optional later: transfer provider API | arrival card with meeting point, route preview, backup path | pickup instructions, backup ride link, map links |
| `check_in_doc_guard` | Tool | `timezone_brief`, booking context, traveler profile | Likely new later: passport/visa rules provider. v1 can be rules-based/manual checklist only | checklist artifact + reasoning panel | checklist with missing items and deadlines |
| `hotel_arrival_brief` | Tool | `validate_travel_address`, `geocode_trip_stop`, `travel_safety_aid`, `export_route_map` | No new API for v1 | hotel arrival packet card + static map/street preview | hotel address, phone, arrival note, map links |
| `jetlag_schedule_builder` | Tool | `timezone_brief`, itinerary timings, traveler notes | No new API | timeline card, day-0/day-1/day-2 schedule | simple schedule bullets by local time |
| `local_transit_navigator` | Tool | `route_trip` successor, `export_route_map`, `search_places_for_trip` successor | Optional later: transit-specific live feeds. v1 on Google routing/place data | route comparison panel + local movement card | best mode, ETA, cost notes, ticket-buying summary |
| `expense_capture_assistant` | Tool + workflow | `generate_booking_invoice`, invoicing, notifications, tenant context | No new API in v1. Optional later: OCR/receipt parser | receipt queue + missing-doc workflow panel | receipt reminder, missing expense bullets, reply with image prompt |
| `trip_checkin_reminder` | Workflow | extend `sendero.check_in_reminder` | No new API in v1 | reminder workflow timeline | nudge with PNR, check-in window, airport transit reminder |
| `emergency_support_router` | Tool | `search_places_for_trip`, `travel_safety_aid`, `export_route_map` | Optional later: embassy/emergency dataset. v1 can start with Places + curated emergency numbers by country | emergency card stack + nearest help map | call numbers, nearest hospital/pharmacy, safe route |
| `meeting_to_itinerary_sync` | Workflow + tool | `export_route_map`, `timezone_brief`, `route_trip`, `local_transit_navigator` | New integration later: Google Calendar/Gmail/Slack event ingestion | itinerary builder canvas + movement blocks | arrival windows, next move, route link |
| `trip_command_center` | Web artifact backed by tools | all active trip tools and workflows | No new API | AI Elements conversation + tool + panel dashboard | not primary for messaging; push summaries from same data |
| `booking_workflow_map` | Web artifact + workflow view | existing workflow runner metadata | No new API | full React Flow booking graph | share run summary only |
| `delay_recovery_board` | Web artifact + workflow | `trip_delay_replanner`, `airport_transfer_coordinator`, `hotel_arrival_brief` | No new API | branching disruption board | disruption bullet update with action choices |
| `restaurant_route_card` | Tool artifact | `recommend_restaurants`, `export_route_map` | No new API | place cards + map preview | top picks + open maps link |
| `traveler_safety_console` | Web artifact | `travel_safety_aid`, `trip_weather_brief`, `air_quality_brief` | No new API | safety dashboard with panels and risk nodes | summary alert + mitigations |
| `approval_flow_designer` | Workflow/UI tool | existing workflow system, policy checks, Slack approvals | No new API in v1 | React Flow policy/approval builder | approval digest only |
| `expense_reconciliation_trace` | Workflow/UI tool | billing, invoicing, settlement logs, meter events | No new API | ledger/workflow trace board | short reimbursement status updates |
| `airport_arrival_playbook` | Tool artifact | `airport_transfer_coordinator`, `travel_safety_aid`, `export_route_map` | No new API | arrival briefing artifact | one-screen arrival instructions |
| `multi_stop_itinerary_editor` | Tool + UI | `export_route_map`, `geocode_trip_stop`, `recommend_restaurants` | No new API | editable React Flow itinerary | ordered stops + primary maps link |
| `agent_handoff_timeline` | Tool/UI artifact | workflow run logs, chat turns, action log, approvals | No new API | timeline + checkpoint visualization | escalation summary and owner handoff |

## AI Elements UI Assignment

| ID | Primary Web Composition | Optional Workflow / Rich Media | Emil Guidance |
| --- | --- | --- | --- |
| `trip_delay_replanner` | `message`, `tool`, `reasoning`, `suggestion` | `canvas`, `node`, `edge`, `panel` | disruption state should feel crisp, not theatrical; new-plan CTA must read instantly |
| `airport_transfer_coordinator` | `artifact`, `message`, `tool` | `image`, `attachments` for terminal maps and pickup cards | arrival card should foreground confidence and backup paths, with minimal visual noise |
| `check_in_doc_guard` | `artifact`, `tool`, `message` | `attachments` for uploaded docs | checklist state should be calm and trustworthy, with clear missing-item emphasis |
| `hotel_arrival_brief` | `artifact`, `message`, `tool` | `image`, `attachments` for map previews and hotel docs | hospitality tone, dense but calm layout, immediate scanability on mobile |
| `jetlag_schedule_builder` | `artifact`, `message`, `reasoning` | `task`, `checkpoint` | timeline blocks should be airy and low-friction; avoid dashboard clutter |
| `local_transit_navigator` | `message`, `tool`, `sources` | `canvas` when comparing routes | route comparison should privilege one best path and show alternatives quietly |
| `expense_capture_assistant` | `conversation`, `message`, `tool`, `attachments` | `task`, `queue` | attachment collection must feel lightweight, almost invisible |
| `trip_checkin_reminder` | `message`, `suggestion` | `task`, `checkpoint` | repeated reminder UI should be minimal and fast, with no heavy animation |
| `emergency_support_router` | `artifact`, `message`, `tool` | `canvas` for nearest-safe-option routing | urgency without panic; use strong hierarchy and obvious call actions |
| `meeting_to_itinerary_sync` | `conversation`, `tool`, `artifact` | `canvas`, `node`, `edge` | meeting movement graph should feel deliberate and ordered, not like a chaotic flowchart |
| `trip_command_center` | `conversation`, `tool`, `panel`, `reasoning` | `agent`, `task`, `queue` | operations surfaces should feel premium and dense, but never cramped |
| `booking_workflow_map` | `canvas`, `node`, `edge`, `toolbar`, `panel` | `checkpoint` | workflow motion should explain state, not decorate it |
| `delay_recovery_board` | `canvas`, `panel`, `tool`, `message` | `checkpoint`, `task` | branches need strong contrast between active, fallback, and failed states |
| `restaurant_route_card` | `artifact`, `message`, `tool` | `image`, `attachments` | this should feel like a polished concierge card, not search results pasted into chat |
| `traveler_safety_console` | `panel`, `tool`, `reasoning`, `message` | `canvas` for risk map | risk severity needs disciplined color use; avoid over-warning the user |
| `approval_flow_designer` | `canvas`, `node`, `edge`, `toolbar` | `confirmation`, `checkpoint` | flow builder should feel mechanical and precise, not playful |
| `expense_reconciliation_trace` | `tool`, `panel`, `code-block` | `canvas`, `checkpoint` | financial trace UI should emphasize auditability and chronology |
| `airport_arrival_playbook` | `artifact`, `message`, `attachments` | `image`, `tool` | one-screen arrival confidence is the goal; optimize for on-the-move reading |
| `multi_stop_itinerary_editor` | `canvas`, `node`, `edge`, `toolbar` | `attachments`, `artifact` | draggable stops should be tactile, with very fast interaction feedback |
| `agent_handoff_timeline` | `conversation`, `checkpoint`, `task`, `tool` | `canvas` | transitions between AI and human ownership should be visually obvious and calm |

## Canonical Beauty Rules

Every new tool should ship with:
- one default “beautiful state” for web, not just a developer-facing fallback
- one mobile-safe artifact variant for narrow layouts
- one messaging-safe text representation
- one obvious primary action
- motion tuned for utility, not spectacle

Review every tool UI against Emil’s checklist:

| Before | After | Why |
| --- | --- | --- |
| Raw JSON or plain `<pre>` output | `tool`, `artifact`, or `message` composition with hierarchy | Tools should feel productized, not debug-only |
| `transition: all 300ms` | property-specific transitions under 250ms | Frequent interactions must feel immediate |
| Generic card grid | one dominant card + subdued supporting detail | Travelers need a clear next action |
| Center-origin overlays everywhere | trigger-aware origin for anchored panels | Spatial logic compounds into polish |
| Equal emphasis on all data | visual hierarchy around risk, next step, and CTA | Travel support is time-sensitive |
| Decorative animation on repeated actions | minimal or no animation for repeated trip workflows | repeated use punishes unnecessary motion |

## Detailed Build Notes

### 1. `trip_delay_replanner`

- Primary role: rebuild the next safe and bookable plan after delay, cancellation, or missed connection.
- Extend existing:
  - `search_flights` for alternate options
  - `search_hotels` for overnight fallback
  - `export_route_map` for re-grounding airport or hotel movement
  - `sendero.book_flight` as the bookable happy path once a new option is approved
- v1 output:
  - `summary`
  - `rebookOptions`
  - `hotelFallback`
  - `notify`
  - `share`
- Web:
  - `tool` card for alternate options
  - workflow canvas for disruption branch
- Messaging:
  - “Your connection is no longer safe. Best next option is …”

### 2. `airport_transfer_coordinator`

- Build from:
  - validated hotel or airport address
  - flight arrival time
  - route + local safety context
- Extend existing:
  - `validate_travel_address`
  - `geocode_trip_stop`
  - `travel_safety_aid`
  - `export_route_map`
- Optional later:
  - dedicated car-service / dispatch integration

### 3. `check_in_doc_guard`

- Goal: prevent airport and border surprises.
- v1 should avoid new external APIs by shipping a structured checklist engine:
  - passport expiry threshold
  - visa known/unknown
  - airline check-in requirements
  - hotel confirmation present/missing
- Later API candidates:
  - visa/passport rules provider
  - destination entry rules provider

### 4. `hotel_arrival_brief`

- Generate:
  - validated hotel address
  - local phone
  - check-in timing notes
  - nearby pharmacy/ATM/food fallback
  - Google Maps / Apple Maps links
- Extend:
  - `search_places_for_trip` style place lookup from existing Places work
  - `travel_safety_aid`
  - `export_route_map`

### 5. `jetlag_schedule_builder`

- Use:
  - destination timezone
  - departure timezone
  - meeting schedule
  - traveler sleep preference
- No new API required.
- Recommended output:
  - `firstNight`
  - `firstMorning`
  - `caffeineWindows`
  - `lightExposure`
  - `napRules`

### 6. `local_transit_navigator`

- Goal: explain the best movement strategy for a city, not just raw route results.
- Extend:
  - future canonical routing tool
  - `export_route_map`
  - places results for stations, pickup points, and backup rides
- Optional later:
  - city-specific live transit or disruption feeds

### 7. `expense_capture_assistant`

- Goal: close the loop between trip actions and finance artifacts.
- Extend:
  - `generate_booking_invoice`
  - billing meter events
  - invoice and booking tables
- No required new API in v1.
- Possible later:
  - OCR receipt parser

### 8. `trip_checkin_reminder`

- This should be the next version of `sendero.check_in_reminder`, not a separate disconnected system.
- Extend workflow:
  - fetch booking status
  - remind with check-in window
  - attach airport transfer / local transit note
  - reopen trip chat

### 9. `emergency_support_router`

- v1 can start with:
  - Places search for hospitals, pharmacies, police stations, consulates, urgent care
  - static emergency numbers by country/city pack
  - route export
- Later:
  - embassy and public emergency datasets

### 10. `meeting_to_itinerary_sync`

- Should be workflow-first.
- Inputs:
  - meeting times
  - locations
  - traveler origin
  - buffers
- Reuse:
  - route export
  - timezone logic
  - transit guidance
- Later integrations:
  - Google Calendar
  - Gmail
  - Slack event or message ingestion

### 11. `trip_command_center`

- Web-only artifact over the canonical tools.
- Should not become a separate backend integration.
- Reuse:
  - workflow runs
  - tool results
  - meter events
  - trip state store

### 12. `booking_workflow_map`

- Pure workflow visualization.
- Extend current `WorkflowLog` and AI Elements workflow graph.
- No new API.

### 13. `delay_recovery_board`

- Composed artifact around:
  - `trip_delay_replanner`
  - `airport_transfer_coordinator`
  - `hotel_arrival_brief`
- No new API in v1.

### 14. `restaurant_route_card`

- Natural extension of:
  - `recommend_restaurants`
  - `export_route_map`
- This should be one of the first fast wins because the foundation already exists.

### 15. `traveler_safety_console`

- Web artifact around:
  - `travel_safety_aid`
  - destination context
  - emergency routing
- No new API.

### 16. `approval_flow_designer`

- Internal web tool for tenant admins.
- Extend existing workflow DSL and Slack approval pauses before building a second approval system.
- No new external API in v1.

### 17. `expense_reconciliation_trace`

- UI and workflow inspection layer for:
  - tool meter events
  - settlement state
  - invoice generation
  - refund/cancel steps
- Extend existing billing and invoicing packages.

### 18. `airport_arrival_playbook`

- Narrow, traveler-facing artifact for arrival.
- Compose from:
  - airport transfer
  - safety
  - route export
  - nearby essential places

### 19. `multi_stop_itinerary_editor`

- Extend:
  - `export_route_map`
  - `geocode_trip_stop`
  - restaurant/place search
- Web should use React Flow.
- Messaging should send only:
  - ordered stops
  - primary route link
  - key notes

### 20. `agent_handoff_timeline`

- Goal: show where automation ended and human escalation began.
- Extend:
  - `log_agent_action`
  - workflow state
  - Slack approval / interruption events
  - chat turns
- No new API in v1.

## API Matrix

### No new external API required in v1

- `trip_delay_replanner`
- `airport_transfer_coordinator`
- `hotel_arrival_brief`
- `jetlag_schedule_builder`
- `local_transit_navigator`
- `expense_capture_assistant`
- `trip_checkin_reminder`
- `restaurant_route_card`
- `traveler_safety_console`
- `approval_flow_designer`
- `expense_reconciliation_trace`
- `airport_arrival_playbook`
- `multi_stop_itinerary_editor`
- `agent_handoff_timeline`

### Likely optional or later API integrations

- `check_in_doc_guard`
  - visa/passport and destination-entry rules provider
- `emergency_support_router`
  - embassy/consulate and emergency dataset provider
- `meeting_to_itinerary_sync`
  - Google Calendar
  - Gmail
  - Slack events/messages
- `airport_transfer_coordinator`
  - ground transfer vendor or dispatch integration
- `local_transit_navigator`
  - live transit feed per city

## Recommended Build Order

1. `restaurant_route_card`
2. `trip_checkin_reminder` as an extension of the existing workflow
3. `airport_arrival_playbook`
4. `airport_transfer_coordinator`
5. `trip_delay_replanner`
6. `hotel_arrival_brief`
7. `local_transit_navigator`
8. `emergency_support_router`
9. `meeting_to_itinerary_sync`
10. `check_in_doc_guard`

UI-first follow-ons:
- `trip_command_center`
- `booking_workflow_map`
- `delay_recovery_board`
- `traveler_safety_console`
- `approval_flow_designer`
- `expense_reconciliation_trace`
- `multi_stop_itinerary_editor`
- `agent_handoff_timeline`

## Implementation Notes For MCP

- Do not add these names to `packages/tools/src/index.ts` until handlers exist.
- For tools that are mostly orchestration, prefer:
  - MCP tool for single deterministic job
  - named workflow for the multi-step plan
- For UI-heavy concepts:
  - keep the canonical data shape in tool output
  - let web compose the richer AI Elements artifact
  - let WhatsApp/Slack use `share` payloads

## Implementation Notes For AI Elements

- Use `MessageResponse` for any generated briefing, explanation, or traveler instructions.
- Use `Tool` for all structured tool output in the web chat.
- Use `Conversation` + `PromptInput` for trip companion flows.
- Use `Canvas` + `Node` + `Edge` + `Panel` for:
  - booking workflow maps
  - delay recovery boards
  - multi-stop itinerary editing
  - approval flow design
  - handoff timelines

## Definition Of Done

A tool from this file is complete only when:
- backend handler exists in `packages/tools/src`
- it is registered canonically for MCP
- docs mention required env vars / APIs
- web renders the result with AI Elements
- WhatsApp/Slack receive a compact, useful version
- it reuses existing integrations wherever possible
