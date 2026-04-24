# Vertical AI For Travel Operations Prompts

These prompts turn the product gaps into a build chain for making Sendero the AI operating layer for travel agencies, TMCs, concierge teams, and corporate travel desks.

## 1. Agency/TMC Copilot Workspace

Skills: `$impeccable craft`, `$nextjs-app-router-patterns`, `$writing-clearly-and-concisely`

```text
Use $impeccable craft, $nextjs-app-router-patterns, and $writing-clearly-and-concisely.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Build the protected operator workspace for /app/ops. It must not look like a marketing page. Show a dense but calm queue of active travel work, grouped by request state: intake, quote review, approval, booking, service, refund, and reconciliation. Each row needs an owner, source channel, next action, evidence, policy state, money state, and a link to the trip or invoice. Use existing Sendero data where available and honest placeholders only where the platform still needs integrations.

Output: production code, accessible UI, concise operator copy, no nested cards, no generic AI dashboard decoration.
```

## 2. Quote Builder

Skills: `$impeccable craft`, `$nextjs-app-router-patterns`, `$native-data-fetching`

```text
Use $impeccable craft, $nextjs-app-router-patterns, and $native-data-fetching.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Implement a quote-builder chain for travel operators. Start from a messy inbound request, normalize origin, destination, dates, traveler count, budget, policy, and traveler preferences. Search flight and hotel inventory, compare options, check policy, and prepare an editable quote matrix. The operator must be able to see why an option is recommended, what violates policy, what needs approval, and what can be booked now.

Output: quote-to-book workflow, UI chain state, and compact copy that an operator can send to a client.
```

## 3. Rebooking And Refund Desk

Skills: `$nextjs-app-router-patterns`, `$investigate`, `$writing-clearly-and-concisely`

```text
Use $nextjs-app-router-patterns, $investigate, and $writing-clearly-and-concisely.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Build the rebooking/refund desk for already-booked trips. The operator should import or open a booking, inspect ticketing state, cancellation rules, refundability, fare difference, traveler urgency, and policy. The system should propose change/refund options, pause for approval, execute cancellation/refund where supported, and create an audit memo.

Output: a service workflow that makes the current placeholder refund flow honest, visible, and ready for supplier-specific integrations.
```

## 4. Existing-Tool Embedding

Skills: `$nextjs-app-router-patterns`, `$native-data-fetching`, `$writing-clearly-and-concisely`

```text
Use $nextjs-app-router-patterns, $native-data-fetching, and $writing-clearly-and-concisely.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Implement the channel-embedded travel ops chain. Show how a request enters from email, Slack, WhatsApp, web, MCP, or CRM, resolves to one tenant/traveler/trip/session, and returns the next best action back to that same channel. Keep GDS/NDC as an explicit integration lane, not a fake finished integration.

Output: a connector status surface and a channel-intake chain that proves Sendero fits existing travel operations instead of forcing a new inbox.
```

## 5. Professional Artifacts

Skills: `$writing-clearly-and-concisely`, `$impeccable craft`, `$nextjs-app-router-patterns`

```text
Use $writing-clearly-and-concisely, $impeccable craft, and $nextjs-app-router-patterns.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Create the professional artifact pack. For each operator action, generate a clear artifact: quote, itinerary, policy exception memo, refund/change memo, and invoice reconciliation pack. Each artifact must cite the source facts used: traveler request, selected offers, policy result, supplier refs, settlement tx, invoice, and approval.

Output: artifact templates and previews that look operational, printable, and ready to send to a client or finance team.
```

## 6. Positioning

Skills: `$writing-clearly-and-concisely`, `$impeccable craft`

```text
Use $writing-clearly-and-concisely and $impeccable craft.

Sendero is Vertical AI for travel operations: an AI operating layer for agencies, TMCs, concierge teams, and corporate travel desks. It should feel workflow-native, precise, calm, and useful to operators who search, quote, approve, book, change, refund, reconcile, and support trips.

Rewrite Sendero positioning so it is unmistakably the AI operating layer for travel agencies, TMCs, concierge teams, and corporate travel desks. Do not lead with itinerary inspiration. Lead with quote-to-book, policy, approvals, changes, refunds, reconciliation, channels, and audit. Arc/Circle settlement should appear as the trust and money backplane, not the headline gimmick.

Output: concise product copy for marketing, app dashboard, docs, and demo narration.
```
