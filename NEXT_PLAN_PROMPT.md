# Next Plan Prompt

Use this prompt to execute the next Sendero implementation phase.

```text
You are working in the Sendero monorepo at /Users/criptopoeta/coding-dojo/sendero.

Goal:
Implement the next concrete batch from the canonical trip-assistance backlog, using the existing Sendero architecture and the specs in:
- /Users/criptopoeta/coding-dojo/sendero/TODO_TOOLS.md
- /Users/criptopoeta/coding-dojo/sendero/packages/tools/src/trip-assistance-blueprints.ts

Non-negotiables:
- Extend existing tools, workflows, and Google integrations before adding new APIs.
- Keep MCP canonical: only register tools that are actually implemented.
- Web UI must use AI Elements wherever the output is user-facing.
- UI polish must follow Emil-style design engineering rules: clear hierarchy, deliberate motion, no generic/raw JSON surfaces, no decorative animation on repetitive actions.
- Outputs must be appropriate for web, WhatsApp, and Slack.
- Reuse existing foundations including:
  - search_flights
  - search_hotels
  - geocode_trip_stop
  - trip_weather_brief
  - air_quality_brief
  - validate_travel_address
  - timezone_brief
  - elevation_risk_brief
  - travel_safety_aid
  - recommend_restaurants
  - export_route_map
  - sendero.book_flight
  - sendero.check_in_reminder

Implement this batch first:
1. restaurant_route_card
2. airport_arrival_playbook
3. airport_transfer_coordinator
4. trip_checkin_reminder
5. trip_delay_replanner

Required deliverables:
- real tool handlers in packages/tools/src for the tools that should be public MCP tools
- workflow catalog updates in packages/workflows/src/catalog.ts for multi-step flows
- canonical registry updates only for implemented tools
- llms/docs/pricing/tool catalog updates where relevant
- web UI integration using AI Elements components, especially:
  - message
  - conversation
  - tool
  - reasoning
  - artifact-style cards built from AI Elements primitives
  - canvas/node/edge/panel/toolbar when a flow visualization materially improves understanding
- channel-safe share payloads for WhatsApp and Slack

Preferred implementation order:
- Start with restaurant_route_card because it extends recommend_restaurants + export_route_map directly.
- Then airport_arrival_playbook and airport_transfer_coordinator using address validation, safety, and route export.
- Then upgrade sendero.check_in_reminder rather than creating a parallel reminder system.
- Then build trip_delay_replanner by composing existing flight, hotel, route, and booking logic.

Verification required before finishing:
- typecheck for apps/app
- any targeted tests that touch changed catalogs or docs
- focused smoke verification of tool output shape for each new tool

Do not stop at planning. Implement the batch end-to-end, verify it, and summarize:
- what was added
- what was intentionally deferred
- which optional future APIs are still not required yet
```

