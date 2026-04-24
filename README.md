<p align="center">
  <strong>Hackathon submission</strong> — <em>Agentic Economy on Arc</em><br />
  <sub>Competition track · <a href="https://www.arc.network/">Arc</a> agent-native commerce and settlement</sub>
</p>

<div align="center">
  <a href="https://sendero.travel" title="Sendero">
    <img
      src="./apps/marketing/public/brand/sendero-banner.png"
      alt="Sendero × Arc — vertical AI for travel operations"
      width="100%"
    />
  </a>
  <p>
    <strong>Vertical AI for travel operations</strong><br />
    <sub>Wallet- and agent-ready travel ops on <a href="https://www.arc.network/">Arc</a> · USDC / EURC settlement · MCP + <a href="#llms-txt-surfaces">llms.txt</a></sub>
  </p>
</div>

<br />

## For judges

**Judges:** Ping me for an invite to the app if you want to try Sendero while evaluating this submission. After you are added, you should receive a beta access email like the one below.

<p align="center">
  <img
    src="./apps/app/public/testers/beta-invite-judges.png"
    alt="Example beta invite email for app access"
    width="560"
  />
</p>

<br />

## Business model — production-grade SaaS + x402 nanopayments

Sendero monetizes on **two independent revenue legs** from day one. This is not a future plan — it is wired through Clerk Billing, `@sendero/billing`, and the agent dispatch path today.

**Leg 1 — Recurring SaaS (Clerk Billing on organizations).** Four plan tiers, monthly or annual, with a zero-card 14-day Pro trial. Plans gate capabilities (workspaces, production API keys, MCP-server exposure, SSO, white-label, SLA) via `has({ feature })`. Trial users get the full Pro ceiling at zero friction so they convert on what they actually shipped.

**Leg 2 — Per-call nanopayments (x402 on Arc, settled in USDC).** Every agent action — flight search, policy check, booking hold, confirmation, MCP tool call, AI-agent context — is priced in micro-USDC and metered through `MeterEvent`. The traveler's or buyer's Circle wallet settles in batches on Arc L2. This leg is consumption-based and runs in parallel to the subscription: SaaS customers still pay nanopayments, just at a discounted unit rate.

This is why the business model is durable: **the trial doesn't stop revenue, it shifts it.** A trialing user is still earning us nanopayment margin on every search and booking while they evaluate whether to pay for the SaaS shell. By the time Clerk flips the trial off, we've already shipped real trips against their wallet.

### Plan tiers (source of truth: [`packages/billing/src/plans.ts`](./packages/billing/src/plans.ts))

| | **Free** | **Basic** | **Pro** | **Enterprise** |
|---|---|---|---|---|
| **Monthly** | $0 | $19/mo | $60/mo | Custom *(list $1,500/mo)* |
| **Annual** | — | $15/mo *billed $180/yr* | $50/mo *billed $600/yr* | Custom *(list $1,250/mo · $15k/yr)* |
| **Workspaces** | 1 | 5 | Unlimited | Unlimited |
| **Production API keys** | 0 *(sandbox only)* | 3 | 25 | Unlimited |
| **Monthly spend cap ceiling** | $100 | $2,000 | $20,000 | Unlimited |
| **Nanopayment discount** | — | 15% off | 30% off | 50% off |
| **Booking take-rate discount** | — | 5% off | 10% off | 15% off |
| **WhatsApp + Slack channels** | — | ✓ | ✓ | ✓ |
| **Public MCP server** | — | — | ✓ | ✓ |
| **Custom webhooks + audit export** | — | — | ✓ | ✓ |
| **SSO/SAML + white-label + custom SLA** | — | — | — | ✓ |

### Why this shape

- **API keys on the scale axis, not the integration axis.** For an agent-native platform where x402 is the primary distribution channel, production keys are equivalent to seats on traditional SaaS. Gating them is the commercial ask.
- **Nanopayment discount scales with plan.** Paying MRR earns you unit economics. TMCs who would otherwise negotiate custom rates get default-priced terms — no bespoke contracts at Pro and below.
- **Zero-card trial on Pro, not Basic.** The trial should reveal the ceiling (public MCP, custom webhooks, audit export), not a throttled middle. Clerk's Oct-2025 no-card trials make this frictionless.
- **Annual = 15–21% off with clean monthly-equivalent numbers.** Clerk's annual field is actually the *monthly rate when billed annually* (validated as ≤ monthly). $15 and $50 present cleaner than the exact 2-months-free computed values and still deliver real savings.
- **Enterprise is an upward-open quote.** No list price, highest discount tier in code (50% / 15%), full capability set. Negotiation happens in the SLA, not in the feature checkbox matrix.

### Why this signals a durable vertical AI + SaaS business

Vertical AI agents that only charge per-call have thin defensibility — the next cheaper LLM or router eats your margin. Vertical AI agents that only charge SaaS miss the obvious x402 opportunity sitting on the same agent runtime. Sendero does both, in one workspace, on one codebase, from day one:

- **SaaS pays for the platform** (workspaces, channels, MCP, identity, audit).
- **Nanopayments pay for the calls** (every search, every booking, every settlement, every tool exposed to other agents).

Trials monetize leg 2 even when leg 1 is $0. Pro+ customers monetize both. Enterprise customers monetize both at committed discounts. The Clerk subscription keeps the customer; the Arc settlement keeps the network. Neither is the whole business — both together are.

<br />

# Sendero × Arc

Sendero is an AI operating layer for travel agencies, TMCs, concierge teams, and corporate travel desks and also individual travelers. It turns messy travel requests into quotes, approvals, bookings, service actions, refunds, artifacts, invoices, and settlement trails. Arc/Circle is the trust and money backplane: every flight, hotel, and ground leg can be booked by an AI workflow and settled on Arc L2 in USDC or EURC.

**Custom `SenderoGuestEscrow` (Arc Testnet):** we implemented **guest-escrow passes** for travel—programmable holds and releases tied to trips, offers, and fulfillment—so **guests, contractors, and interview candidates** can be funded and settled with the same rigor as employee programs. The contract is designed to sit beside **ERC-8183**-style agentic job escrows and **ERC-8004** agent identity/reputation, while **Circle Nanopayments** and **x402** meter API and workflow usage so finance can align **per-trip** and **per-tool** spend with on-chain escrow state instead of only chasing receipts after the fact. A **deployed Ponder** indexer keeps `SenderoGuestEscrow` events in **Postgres** with **GraphQL** so the app, ops, and agents query one truth layer without hammering the RPC.

The on-chain implementation is **[`SenderoGuestEscrow`](./contracts/src/SenderoGuestEscrow.sol)** ([`contracts/README.md`](./contracts/README.md) — API, lifecycle, upgrades). It follows **Peanut Protocol–style payment links**: the buyer locks USDC against an ephemeral **claim keypair** (public identifier on-chain; private key shared out-of-band, e.g. in a guest URL fragment). **`claimTrip`** accepts only a **recipient-bound ECDSA signature** that binds the guest’s chosen wallet into the signed digest (domain separation uses the contract’s fixed `SENDERO_SALT` label plus chain id and `address(this)` in the hash—**not** the same thing as the optional human-facing code below). On top of that link pattern we add a **travel** state machine: **reserve → commit → confirm → settle** bookings, upper-bound reservations for fare drift, buyer reclaim on timeouts, and sweeps—so escrow matches how trips are actually bought and reconciled.

**Second security layer:** when the trip is created, the buyer may set a **`claimCodeHash`**. The guest must then submit the matching **unique preimage** (OTP-style one-time code) in the same `claimTrip` call as the signature. That is a **second secret** on top of possession of the ephemeral claim key: a leaked link alone is not always enough to enroll an attacker’s wallet. (The preimage appears in calldata; rotate codes if a link may have been observed—see *Known gaps* in `contracts/README.md`.)

**Deployed proxy (Arc Testnet, chain `5042002`, verified on Arc Scan):** [`0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515`](https://testnet.arcscan.app/address/0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515).

> This app is intentionally **standalone** within the monorepo so it can be cleanly extracted into its own repository for submission. It uses zero `@bu/*` workspace imports. We built a much larger platform, as you can see, but the goal here is to launch this experiment quickly, learn fast, and refine it alongside Arc’s mainnet launch.

Sendero was refined with the help of **beta testers worldwide** from the [**Arbitrum Foundation**](https://arbitrum.foundation/) community.

<p align="center">
  <img
    src="./apps/app/public/testers/first-beta-testers.webp"
    alt="Beta testers worldwide from the Arbitrum Foundation community"
    width="100%"
  />
</p>

## LLM and agent entrypoints

<a id="llms-txt-surfaces"></a>

### llms.txt surfaces

Every deployed app exposes the same **shape** of manifest at **`/llms.txt`** and **`/.well-known/llms.txt`** (plain text, agent-safe). Each origin scopes copy to that product: console vs marketing vs help articles vs developer docs vs edge.

| Surface | Role | `llms.txt` | `/.well-known/llms.txt` |
| --- | --- | --- | --- |
| **Product app** | Authenticated console, MCP, webhooks, billing, trips | [www.sendero.travel/llms.txt](https://www.sendero.travel/llms.txt) | [www.sendero.travel/.well-known/llms.txt](https://www.sendero.travel/.well-known/llms.txt) |
| **Marketing** | Public positioning, pricing, audiences | [sendero.travel/llms.txt](https://sendero.travel/llms.txt) | [sendero.travel/.well-known/llms.txt](https://sendero.travel/.well-known/llms.txt) |
| **Help** | Support articles and troubleshooting | [help.sendero.travel/llms.txt](https://help.sendero.travel/llms.txt) | [help.sendero.travel/.well-known/llms.txt](https://help.sendero.travel/.well-known/llms.txt) |
| **Docs** | MCP integration, tool catalog, x402, API shapes | [docs.sendero.travel/llms.txt](https://docs.sendero.travel/llms.txt) | [docs.sendero.travel/.well-known/llms.txt](https://docs.sendero.travel/.well-known/llms.txt) |
| **Edge** | Direct worker discovery for MCP and `/tools` | [edge.sendero.travel/llms.txt](https://edge.sendero.travel/llms.txt) | [edge.sendero.travel/.well-known/llms.txt](https://edge.sendero.travel/.well-known/llms.txt) |

Implementation lives in [`packages/llms`](./packages/llms) (generator + shared catalog). Each Next app wires `app/llms.txt/route.ts` and `app/.well-known/llms.txt/route.ts` to that package.

### MCP, workflows, and x402

1. Read **`llms.txt`** on the origin you are integrating against (local: same path on that app’s dev server, e.g. the product app at `http://localhost:3010/llms.txt` when you run `mise run dev:web`).
2. Connect to MCP at **`https://edge.sendero.travel/mcp`**, call `initialize`, then **`tools/list`**.
3. For a real booking, prefer the **`sendero.book_flight`** workflow instead of manually chaining tools. It searches supplier inventory, checks policy, reserves prepaid escrow, holds the offer, waits for ticketing, settles the booking, and generates the invoice.

Direct HTTP clients can call **`/tools/:name`** on the edge origin with **x402 `Payment-Signature`** headers. Use safe identifiers such as `tenantId`, `userId`, `tripId`, `bookingId`, and `runId`. Never persist guest private-link fragments, plaintext claim codes, raw card data, seed phrases, or API secrets.

## Trip companion (not only flights and hotels)

Sendero’s tools are meant to support the **whole trip**, not just the flight lifecycle and accommodation booking. That is why we integrated the **Google Places API**—to help with restaurants, local context, and practical guidance so **tourists and business travelers** are supported from first quote through **getting home safely**.

The next 20 trip-assistance tools and workflows are tracked canonically in [`TODO_TOOLS.md`](./TODO_TOOLS.md). That backlog defines MCP shape, web AI Elements expectations, WhatsApp/Slack output rules, and which integrations should be extended before adding new APIs.

Further tools we can add include **eSIM sales** (QR install in chat), **travel insurance** quotes and bind, travel information based on profile (traveler visa requiremnts, passport expiration, memory notifications) and deeper ground services. Partnership directions worth exploring include **LoungePass** and **Mastercard-style international card programs** with spend funded or settled from **USDC**, to lower cost and friction for travelers abroad via providers such as **Rain.xyz** which do support Visa Signature card programs funded by USDC.

MOAT: The more Sendero can absorb “my flight changed, now what?” the more defensible it becomes.

## Google Maps Platform travel intelligence

Sendero uses Google Maps Platform as travel operations infrastructure, not just a visual layer. The new canonical travel tools live in `@sendero/tools` and are available to the AI SDK surfaces, MCP, and workflow runner:

- `geocode_trip_stop`
- `trip_weather_brief`
- `air_quality_brief`
- `validate_travel_address`
- `timezone_brief`
- `elevation_risk_brief`
- `travel_safety_aid`
- `recommend_restaurants`

These tools are part of the normal business logic for destination readiness, traveler safety, arrival confidence, and in-trip support.

### How we use each Google service

- **Weather API**: departure readiness, live destination risk, and disruption-aware recommendations.
- **Air Quality API**: respiratory-risk guidance and outdoor-activity advisories.
- **Geocoding API**: canonical coordinates for itinerary stops before routing and safety checks.
- **Address Validation API**: validate hotels, pickups, embassies, clinics, and other travel-critical addresses before arrival.
- **Time Zone API**: local-time and DST context for meetings, transfers, and support.
- **Elevation API**: altitude-sensitive warnings for mountain and high-elevation destinations.
- **Street View Static API**: arrival previews for pickup points and property entrances inside the composed safety brief.
- **Places API (New)**: place discovery for restaurants and nearby services during the trip.
- **Places UI Kit**: rich place presentation in user-facing surfaces where we want trusted, familiar place detail UX.
- **Maps JavaScript API / Maps Embed API / Maps Static API**: interactive, embedded, and static trip map surfaces.
- **Maps Grounding Lite**: roadmap grounding layer for place-aware travel answers and future MCP-backed geospatial reasoning.
- **Routes API / Distance Matrix API / Directions API**: route computation and compatibility paths for routing-heavy workflows.
- **Geolocation API**: fallback traveler location estimation for recovery and support scenarios.

### Canonical safety workflow

The workflow runner now includes `sendero.travel_safety_brief`, which:

1. geocodes the stop,
2. runs weather, air quality, timezone, elevation, and safety checks in parallel,
3. returns a compact, traveler-facing risk brief for departure or reroute decisions.

### On-ramps, off-ramps, and abstracting USDC

The next major product step is a **proper on- and off-ramp**: credit card, bank transfer, and other local payment methods alongside stablecoins. That is important because we want to **abstract USDC** for humans—USDC remains the **most efficient rail for AI agents** and automated settlement, while travelers pay and receive value through **Google Pay**, **Apple Pay**, and familiar PSP flows. The same philosophy applies to **eSIM**: deliver a **QR code** in **WhatsApp** or **Slack** so connectivity comes online without forcing a separate install path first.

**WhatsApp** and **Slack** are first-class client surfaces for many agencies, TMCs, and road warriors. Meeting people there means a dedicated **mobile or web trip app is optional**, not mandatory, for day-to-day trip management—as long as the agent, tools, and settlement layer stay reliable behind the scenes.

## Why we built this

We decided to build this inspired by Y Combinator’s thesis that **vertical AI agents may become larger businesses than SaaS**.

### References

- [YC Shorts](https://www.youtube.com/shorts/lvmmk85ArWg)
- [Full Lightcone podcast](https://www.youtube.com/watch?v=ASABxNenD_U)

> "As AI models continue to rapidly improve and compete with one another, a new business model is coming into view: vertical AI agents. In this episode of the Lightcone, the hosts consider what effect vertical AI agents will have on incumbent SaaS companies, what use cases make the most sense, and how there could be 300 billion dollar companies in this category alone."

The deeper idea is **replicability**: a template for **vertical AI agents on Arc** paid for with **nanopayments** and **usage-based** billing instead of flat SaaS seats. Price tracks **work actually completed** in **fully automated** flows, which weakens the assumption that every workflow must live behind a traditional product UI and can strip fixed platform cost from idle licenses. Layer in **USDC / EURC settlement**, credible **on- and off-ramps**, and familiar **PSP and card** rails for humans and treasury, and you get a serious production ready sketch of **agent-native commerce**—not a one-off demo, but a pattern others can fork for their own vertical.

### Enterprise travel: Navan, Ramp, Brex, and why guest escrow matters

Corporate travel is a **Navan-shaped** market in the all-in-one **travel + expense** layer: sell-side notes (e.g. [BofA Securities via MarketScreener, Apr 2026](https://ca.marketscreener.com/news/navan-taking-market-share-from-legacy-travel-companies-with-ai-led-platform-bofa-says-ce7e51d3d18df523)) describe Navan **taking share from legacy TMCs and incumbent T&E platforms** with an AI-led stack, and Navan’s own materials cite the **Winter 2025 G2 Grid Report for Travel & Expense** as naming Navan the leader across those categories on **user satisfaction and market share** ([Navan / G2 report landing](https://navan.com/resources/reports/g2-grid-report-travel-and-expense-management-leader-winter-2025)). For concrete scale, Navan’s **Business Travel Benchmark** (Q3 2025) is built from **millions of transactions across more than 10,000 businesses** on its platform ([Navan press release](https://navan.com/about/press/navan-btb-q3-2025)).

From the **corporate card** side, **Ramp** and **Brex** are comparable financial-operations footprints pushing deeper into travel: Ramp’s November 2025 financing materials cite **50,000+ customers**, **$1B+ annualized revenue**, and **>$100B annualized purchase volume** ([PR Newswire](https://www.prnewswire.com/news-releases/ramp-reaches-32-billion-valuation-doubling-revenue-and-customers-in-past-year-302616510.html)), with workforce size in the **low thousands** depending on quarter (e.g. third-party trackers around **~2,000** in early 2026). **Brex** has been cited in the **~1,700 employee** range in 2026 company profiles (e.g. [PitchBook](https://pitchbook.com/profiles/company/226102-87)) ahead of its **Capital One** combination (public deal reporting in early 2026). Those are the orders of magnitude for how much product and GTM mass sits in **employee-first** T&E—and how much room remains for **guest** workflows.

**Ramp acquired Juno on March 16, 2026** ([Ramp PR via PR Newswire](https://www.prnewswire.com/news-releases/ramp-acquires-juno-to-expand-guest-travel-and-build-the-complete-travel-solution-for-every-business-302714356.html)): Juno is explicitly a **non-employee / guest travel** platform (candidates, contractors, event guests, and similar travelers outside core HR). The deal is a public bet that **guest travel**—messy invites, TMC coordination, advances, and reconciliation—is a first-class enterprise problem, not a sidecar to employee booking. Sendero’s **`SenderoGuestEscrow` + standards + nanopayments** is aimed at that same wedge: **agent-native, on-chain settlement and policy** for the trips enterprises already pay for, without assuming everyone lives inside one vendor’s UI with native WhatsApp and Slack support. Meeting travelers where it's most convenient.


## How we design the travel experience (AI-native)

Sendero is not a chat on top of a booking tool — it is a **workflow engine with channels on top**. The design principles below are codified as a skill (`.claude/skills/design-travel-experience-ai`) and paired with the `ai-workflows` skill so UX work and the workflow graph in [`packages/workflows`](./packages/workflows) stay in lockstep.

### One share, many channels

A traveler-facing step produces a single `share` payload. The same shape renders as a **WhatsApp** interactive message, a **Slack** block kit card (for operators), an **email** via [`@sendero/notifications`](./packages/notifications), and a **web** card in [`apps/app/components/ai-elements/`](./apps/app/components/ai-elements). If a field matters to the UX, it lives in `share` — never hard-coded in one adapter. This is how the same flow can start on WhatsApp, resume on the web, and mail a receipt — all one run.

### Stakeholders and role-tailored UX

Sendero's `Role` enum in [`packages/database/prisma/schema.prisma`](./packages/database/prisma/schema.prisma) drives the surface differences. Same engine, different affordances:

| Role | Primary channel | What they see | Key affordances |
| --- | --- | --- | --- |
| **agency_admin** | Web console + Slack | All tenant trips, policy editor, approval inbox, commission reports, guest-pass issuance. | Prefund trips, issue guest passes, override policy with memo, approve exceptions, bulk prefund via `agencyCohortWorkflow`. |
| **finance** | Web console + email | Invoices, settlement tx list, refund ledger, commission splits, reconciliations. | Export CSV, open artifact pack (`opsArtifactPackWorkflow`), drill from invoice → settle tx → per-leg split. No booking authority. |
| **traveler** | WhatsApp / web / email | Their own trips, policy summary, offer cards, check-in nudges, receipts. | Book within policy, pick ancillaries, approve rebooks on disruption, rate the agent. Never sees other travelers, never edits policy. |
| **guest** | WhatsApp (entry) + web (claim) + email | One trip — the one they were invited to — and only after claim. | Claim via MSCA passkey, pick offer within prefunded budget, confirm booking, receive receipt. No long-lived account. |

Role gating is re-checked inside every tool handler (not only the UI), and each role gets distinct `surface` tags on outbound email so analytics segments cleanly.

### Guest passes (prepaid trips, Navan-shaped wedge)

A **guest pass** is a WhatsApp-shareable link that lets someone without a Sendero account spend a prefunded USDC budget on one trip, then walk away. End-to-end:

1. `prefund_trip` escrows USDC on-chain with budget + expiry + metadata CID.
2. [`@sendero/guest`](./packages/sendero-guest) emits a Peanut-style share link (private key in URL fragment, never server-side) — email mirrors the link as the durable channel.
3. Guest enrolls an **MSCA passkey** and signs `claimTrip(tripId, guestWallet, signature)`.
4. Agent books inside the budget. `reserve_booking` / `commit_booking` draw down per leg.
5. On ticketing confirmation, `settle_booking` atomically splits vendor + agency + fee + reputation tip via [`@sendero/sendero-nanopayments`](./packages/sendero-nanopayments).
6. Unspent budget auto-refunds to the buyer at expiry.

Canonical workflows: `guestPrefundWorkflow` (single seat) and `agencyCohortWorkflow` (bulk). UX rules:

- **Link is the product.** Never require an app install. WhatsApp first, email mirrored.
- **The passkey *is* the account.** No password onboarding; the first claim is the enrollment.
- **Budget visible at every step.** Each card shows prefunded / locked / remaining, with `aria-live` announcements on change.
- **Expiry is loud.** Countdown at the top, T-24h reminder email, funds return to buyer automatically.
- **One trip, one pass.** A second trip is a second prefund + link — keeps on-chain reasoning auditable.
- **Receipts to both sides** with distinct `surface` tags (`guest_receipt`, `buyer_settlement`).
- **Stall handoff** routes to ops via `opsChannelIntakeWorkflow` with tripId + claim state preserved; no lost budgets.

### Workflows are durable objects (the UX unlock)

[`packages/workflows`](./packages/workflows) persists every `WorkflowRun` with scratchpad + trail. `pause` steps suspend and `resumeRun()` continues from the exact pending step when a webhook / traveler reply / approval lands — days later, different channel, different device. This is why:

- Start on WhatsApp, pause awaiting `supplier_order_ticketed`, push email + Slack-ops ping hours later — one run.
- Survive airline cancellations: `cancellationRecoveryWorkflow` is a second durable run resumed from the `order.cancelled` event.
- A traveler can switch from web to WhatsApp mid-flow — the run is keyed by traveler + tripId, not by session.

Consequences for design: never ask the traveler to "stay on this page"; every pending state is reachable from their inbox with a live link (no spinners); timeout values are product copy ("we'll follow up by Friday"); resume tokens are shareable URLs for ops handoff, WhatsApp CTAs, and Slack buttons.

### Confirmations must persist via email

Chat is ephemeral. Legal and airline receipts are not. Every terminal success or failure sends an email via [`@sendero/notifications`](./packages/notifications) (Resend-backed), regardless of the originating channel:

- **Booking confirmed** → `sendInvoice` with the PDF from `@sendero/invoicing`, `publicUrl` to `/invoice/<token>`, and the on-chain settle tx hash.
- **Guest trip prefunded** → `sendGuestInvite` — the durable fallback if WhatsApp is missed.
- **Refund issued / rebook approved / airline cancellation** → dedicated templates with amount, reason, tx hash, expected settle window, and deep links back into the active flow.

Rules: send from the workflow's terminal step (not the channel adapter) so WA-started and web-started flows both mail; `notificationsConfigured()` guards dev; tag every send with `surface` for analytics; `reply-to` resolves to a monitored inbox (the reply is a support turn); attach machine-readable artifacts (ICS, PDF) — humans read, agents re-ingest.

### MCP + llms.txt — partner-readable by design

Every `ToolDef` in [`packages/tools`](./packages/tools) ships through **both** the AI SDK and the Sendero MCP server via [`packages/tools/src/adapters/`](./packages/tools/src/adapters). When you design a tool you are designing a partner API surface: its description, JSON schema, `share` output, and structured error codes are user-facing to whatever external LLM calls us. `llms.txt` (generated by [`@sendero/llms`](./packages/llms)) is how ChatGPT, Claude, Perplexity, and partner MCP clients discover our surfaces — treat it as a first-class deliverable alongside the UI.

### Blockchain × AI — how we get security right

The AI agent can hallucinate. The chain cannot. Design so the chain is the trust root:

- **Escrow before tool call** — `prefund_trip` + `reserve_booking` lock funds before the LLM is allowed to book. Worst case: the agent fails to book; it cannot overspend.
- **Policy as on-chain check, not a prompt instruction** — `check_policy` is a tool-gated step; the LLM cannot skip it.
- **Settle only on confirmed state** — `settle_booking` fires on the `supplier_order_ticketed` webhook, not on the LLM saying "I booked it".
- **Agent actions logged on-chain** — `log_agent_action` writes what the agent did and the fee it consumed. Auditable without trusting us.
- **Identity via MSCA passkey** — guest claims go through a Modular Smart Account passkey; the LLM never sees keys.
- **Show the proof** — every terminal surface (email, WA, Slack, web) includes the tx hash + explorer URL. The presence of the proof deters fraud.

**Rule:** if a step moves money or changes a legal booking, it has an on-chain anchor the UX cites. The LLM drafts; the chain commits.

### Offer cards and accessibility

A simple return flight carries 32+ data points. Above the fold: carrier + logo, total price in traveler currency (via `quote_fx`), duration, stops, depart → arrive times, airports. Everything else — segments, baggage, fare-brand amenities, change/cancel terms, carbon — goes into expandables (and we track expansion for conversion analytics). Filters default to price + duration; loyalty filter surfaces only when the tenant has it. Required passenger fields are driven by the supplier's per-order requirements, not a static form, to minimize drop-off.

Accessibility is non-negotiable: ~1 in 5 travelers have accessibility needs. 44×44 px hit-targets, WCAG AA contrast, logical keyboard order, `prefers-reduced-motion` respected, airline logos with semantic `alt`, status never color-only, email always has a `text` fallback alongside `html`.

### Nanopayments + USDC are billing *and* settlement

[`@sendero/sendero-nanopayments`](./packages/sendero-nanopayments) settles bookings in a single Arc userOp that atomically fans traveler escrow → supplier + agency commission + Sendero fee + validator reward + reputation tip. The same rails meter per-turn agent usage (via x402). Quotes show fiat (via `quote_fx`) but commit in USDC; the invoice email shows both plus the settle tx hash; refunds via `send_tokens` surface their own tx hash. Card rails cannot do atomic multi-leg settlement — this is the Sendero-specific unlock.


## One-liner setup (mise)

All tool versions (bun 1.3.10, node 22.18, prisma 5.22) are pinned in
[`.mise.toml`](./.mise.toml) and auto-activate on `cd`.

```bash
curl https://mise.run | sh                                   # install mise
eval "$(mise activate zsh)"                                  # or bash
mise install && mise run bootstrap                           # installs tools + deps + prisma client
lefthook install --force                                     # enable git hooks
```

Then:

```bash
mise run dev              # full stack (apps + edge + Ponder indexer)
mise run dev:web          # web only → http://localhost:3010
mise run typecheck        # turbo run typecheck
```

## Running (legacy / no mise)

```bash
bun install     # or npm/pnpm/yarn
bun run dev     # → http://localhost:3010
bun dev:complete  # turborepo full mode
```

**If `@sendero/app#dev` exits immediately** with *Another next dev server is already running*: Next.js 16 allows only **one** `next dev` per `apps/app` checkout (any port). Stop the PID the error prints (`kill <pid>`), or run **`mise run ports`** to clear Sendero ports and stale `next dev` processes, then start again.

Before first run, populate `.env.local` from `.env.example`:

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway (Gemini-first; preferred)
- `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` — Gemini direct fallback
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — further direct fallbacks
- `DUFFEL_API_TOKEN` — flights + hotels
- `CIRCLE_API_KEY` + `CIRCLE_ENTITY_SECRET` — treasury (developer-controlled)
- `NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY` — user passkey login (Modular Wallets)
- `ARC_*` — Arc Testnet config (chain id `5042002`)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — from your [Clerk](https://clerk.com) app ([dashboard](https://dashboard.clerk.com)); see **Clerk** below
- `NEXT_PUBLIC_APP_URL` — same origin you open in the browser (e.g. `http://localhost:3010` locally) so Clerk redirects and allowlists work

### Clerk (authentication)

Sign-in, orgs, and invites use **Clerk** with embedded routes `/sign-in`, `/sign-up`, and organization UI under `/onboarding`. Copy keys from [Clerk dashboard](https://dashboard.clerk.com) into `.env.local` (see [`.env.example`](./.env.example): `NEXT_PUBLIC_CLERK_*`, `CLERK_SECRET_KEY`, optional `CLERK_WEBHOOK_SECRET`). **Enable Organizations** in the dashboard for B2B flows.

For hosted steps (invites, Account Portal) to return into this app instead of `*.accounts.dev/default-redirect`, the **Clerk application must match your keys** and these paths should be set (paths only; host comes from your app URL / `$DEVHOST` in dev):

| Where in dashboard | Value |
|--------------------|--------|
| **User redirects** — after sign-up | `/onboarding` |
| **User redirects** — after sign-in | `/app` |
| **User redirects** — after logo (optional) | `/` or `/app` |
| **Organization redirects** — after create | `/onboarding` |
| **Organization redirects** — after leave | `/onboarding/choose-org` |

Also set **Application home / home URL** and **allowed redirect URLs** to the origin you use (local and production). Clerk details: [Customize redirect URLs](https://clerk.com/docs/guides/development/customize-redirect-urls).

**QA Clerk users (development):** Passwords live in your team vault or the Clerk dashboard (never commit them). Use these to exercise `/app`, `/app/console`, `/app/channels/whatsapp`, `/app/channels/slack`, and onboarding per persona.

| Persona | User ID | Primary email | Public metadata |
|--------|---------|---------------|-----------------|
| Dogfood | `user_3Ch9cj7CYNxFjG4qe4zLFeJrVpr` | `sendero+clerk_test_1776827014633@example.com` | `{ "dogfood": true }` |
| QA corporate | `user_3Ch6n9weA3KflcBOm22hb6g4Upn` | `sendero.qa+corporate.mo9g3cuz@example.com` | `{ "persona": "corporate", "senderoQa": true }` |
| QA agency | `user_3Ch6n1UThT8QQ0EHaJIiC9LFSWy` | `sendero.qa+agency.mo9g3cuz@example.com` | (set in Clerk; use for agency flows) |

**Webhooks and `/onboarding`:** The `organization.created` handler under [`/api/webhooks/clerk`](./apps/app/app/api/webhooks/clerk/route.ts) provisions the tenant wallet and sets `onboardingComplete` in org **publicMetadata**. **Clerk cannot deliver webhooks to `localhost`**, so the onboarding screen can spin until you either (1) expose the app with a tunnel (e.g. [ngrok](https://ngrok.com)) and add an endpoint in the Clerk dashboard with URL `https://<your-tunnel>/api/webhooks/clerk` plus `CLERK_WEBHOOK_SECRET` in `.env.local`, or (2) in **development only**, use the **“Dev: run provisioning without webhook”** button on [`/onboarding`](./apps/app/app/onboarding/page.tsx) (calls [`POST /api/dev/complete-org-provisioning`](./apps/app/app/api/dev/complete-org-provisioning/route.ts)) after signing in. Watch the `next dev` terminal for logs prefixed `[webhooks/clerk] organization.created` when the webhook path runs.

Then bootstrap the agent NFT (one-time deployment) ERC-8183 + ERC-8004 for reputation based agentic commerce with job escrows:

```bash
bun run bootstrap-agent
```

## Stack

- **Next.js 15** (App Router)
- **React 19**
- **Vercel AI Gateway + Google Gemini** — default LLM path; see [Technology partners](#technology-partners)
- **Nanopayments and Gateway** — x402 protocol for metered billing
- **Circle Modular Wallets** — passkey-authenticated MSCAs on Arc Testnet
- **Circle Developer-Controlled Wallets** — provider/treasury signing
- **ERC-8183** agentic commerce (escrow) + **ERC-8004** agent identity/reputation
- **Ponder indexer** ([`apps/ponder`](./apps/ponder), workspace `@sendero/indexer`) — Postgres-backed index of **`SenderoGuestEscrow`** on Arc Testnet; ships a **GraphQL** read API (`mise run dev:indexer` / port `42069` locally). **Production:** self-hosted on **Railway** (~$5/mo vs hosted-subgraph pricing); see [`apps/ponder/README.md`](./apps/ponder/README.md).
- First-party supplier flights + stays

<a id="technology-partners"></a>

## Technology partners: Google Gemini & Vercel AI Gateway

**Google (Gemini)** We route production traffic through the **[Vercel AI Gateway](https://vercel.com/docs/ai-gateway)** using **Gemini-first** model strings (for example `google/gemini-3-flash` for fast turns and `google/gemini-3.1-pro-preview` for smart turns), with `providerOptions.gateway.order` set to **`google` → `anthropic` → `openai`** so the gateway can fail over across providers while we keep a single `AI_GATEWAY_API_KEY` (or `VERCEL_OIDC_TOKEN` on Vercel). Optional **BYOK** keys for Google, Anthropic, and OpenAI are forwarded when present so billing can stay on your own accounts.

**Direct fallback cascade** (no gateway, or after a gateway hard-fail in `/api/agent/dispatch`): **Gemini** (`GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`) → **OpenAI** → **Anthropic**, using tier-specific candidate lists. That matches the challenge to **use Gemini for reasoning, chat, and tool calling**, run **automated workflows** over user context, and **coordinate settlement on Arc with USDC** via Circle (wallets, Gateway, CCTP, x402) elsewhere in the stack.

Implementation (tiers, gateway order, BYOK, and direct cascade) lives in **[`packages/agent/src/models.ts`](./packages/agent/src/models.ts)**. Web streaming chat resolves models in [`apps/app/app/api/chat/route.ts`](./apps/app/app/api/chat/route.ts); channel dispatch retries in [`apps/app/app/api/agent/dispatch/route.ts`](./apps/app/app/api/agent/dispatch/route.ts).

**Resources:** [Gemini API models](https://ai.google.dev/gemini-api/docs/models) · [Gemini 3 developer guide](https://ai.google.dev/gemini-api/docs/gemini-3) · [Google AI Studio](https://aistudio.google.com/) · [AI SDK Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)

## Layout

```
  ┌───────────────────────────────────────────────────────┐
  │ Topbar · Partner breadcrumb · tier · version          │
  ├───────────────────────────────────────────────────────┤
  │ Subbar · Traveler · Scenario chip · Status pills      │
  ├────────────┬───────────────────────────┬──────────────┤
  │            │                           │              │
  │   Chat     │   Stage                   │   Workflow   │
  │   column   │   itinerary · hotels      │   log        │
  │   (left)   │   ground · policy         │   (right)    │
  │            │   approvals · settlement  │              │
  │            │                           │              │
  ├────────────┴───────────────────────────┴──────────────┤
  │ Footer rail · block height · treasury · memo          │
  └───────────────────────────────────────────────────────┘
```

## Supported Currencies

- Settlement token: USDC / EURC / Auto-FX on Arc Testnet

## Arc × Circle integration

Every scenario shows a per-invoice breakdown settled via **Circle CCTP v2 on Arc L2**:

- Mixed USDC / EURC payouts per vendor
- Arc block number + tx hash + memo
- Sub-6s finality target
- Treasury balance in both tokens

## Smart contract indexer (Ponder)

We ship and run a **TypeScript Ponder indexer** for the guest-escrow contract on Arc Testnet (replaces a Goldsky-style subgraph for this chain). It **backfills and follows** `SenderoGuestEscrow` events into **Postgres**, exposes **auto-generated GraphQL** for trips, bookings, and related entities, and is what keeps long-lived escrow and settlement state legible to the product without hammering the RPC.

- **Code:** [`apps/ponder`](./apps/ponder) (`@sendero/indexer`)
- **Local:** `mise run dev:indexer` or `bun run dev:indexer` — GraphQL at `http://localhost:42069/graphql` (see [`apps/ponder/README.md`](./apps/ponder/README.md))
- **Production:** deployed on **Railway** with managed Postgres; env vars `PONDER_RPC_URL_ARC_TESTNET`, `PONDER_ESCROW_ADDRESS`, `PONDER_ESCROW_START_BLOCK` (and `DATABASE_URL` from the addon). After any contract upgrade, run `bun run indexer:sync-abi` from the repo root and adjust start block if needed.

## Agent-to-agent integration

Sendero can be called by another AI agent as a travel sub-agent:

- **`llms.txt` manifests** — see the [surface table](#llms-txt-surfaces) above; each app links to the others for cross-discovery.
- `/mcp` on the edge worker and `/api/mcp` on the app expose the shared `@sendero/tools` registry over MCP JSON-RPC.
- `/tools/:name` exposes the same tools as x402-gated direct HTTP endpoints.
- `/api/workflows/run` and `/api/workflows/resume` run named plans such as `sendero.book_flight`, which handles search, policy, escrow reservation, ticketing pauses, settlement, and invoice generation.
- `/app/ops` maps the Legora-style travel-ops gaps into skill prompts, operator queue lanes, channel fit, and workflow chains such as `sendero.ops_quote_to_book`, `sendero.ops_rebook_refund`, and `sendero.ops_artifact_pack` in order for contributor's doing LLMs vibe coding to have inspiration of other tools to create.

Start with `apps/docs/content/docs/agent-to-agent-booking.mdx` for the complete delegated booking flow.

## File structure

```
sendero-arc/
├── app/
│   ├── api/
│   │   ├── agent/{identity,runtime}/  # ERC-8004 reputation + runtime meta
│   │   ├── bookings/{hold,[id]/pay}/  # supplier hold + balance-pay
│   │   ├── chat/                      # AI agent (several tools)
│   │   ├── flights/search/            # flight search
│   │   ├── hotels/search/             # stays search
│   │   └── treasury/balance/          # Circle treasury + Arc RPC
│   ├── layout.tsx
│   ├── page.tsx
│   └── globals.css
├── components/
│   ├── hero.tsx            # Landing: cobe globe + integrated passkey auth
│   ├── sendero-app.tsx     # LandingHero → Console
│   ├── agent-card.tsx      # Live ERC-8004 reputation chip
│   ├── chat-col.tsx        # useChat() — drives store on tool calls
│   ├── stage.tsx           # Offers / Hold / Settlement / Hotels
│   ├── workflow-log.tsx    # Live run stream
│   ├── ui.tsx              # Topbar, Subbar, StepRail, FooterRail
│   ├── actions.ts          # REST-based flow for stage form
│   └── store.ts            # Zustand source of truth
├── lib/
│   ├── arc.ts              # Arc RPC (viem) — chain 5042002
│   ├── arc-identity.ts     # ERC-8004 identity + reputation
│   ├── arc-jobs.ts         # ERC-8183 job escrow
│   ├── circle.ts           # Circle DCW (treasury + provider)
│   ├── supplier.ts         # Flight + stay supplier adapter
│   ├── env.ts              # Env accessors
│   └── user-wallet.ts      # Circle Modular Wallets (passkey)
└── scripts/
    ├── bootstrap-agent.ts  # One-time: mint NFT + seed reputation
    ├── check-reputation.ts
    └── dry-run-settle.ts
```

*Indexer (monorepo sibling to the Next apps above):* [`apps/ponder/`](./apps/ponder) — Ponder project for **`SenderoGuestEscrow`** on Arc Testnet → Postgres + GraphQL ([`apps/ponder/README.md`](./apps/ponder/README.md)).

## Built on

- [Google Gemini](https://ai.google.dev/gemini-api/docs) & [Google AI Studio](https://aistudio.google.com/) — multimodal agents, function calling, and sponsor-aligned defaults.
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway) — unified routing, observability, and provider failover.
- [Circle Arc](https://www.arc.network/) — USDC as native gas, sub-second finality.
- First-party supplier integrations — real flight inventory and PNR issuance.
- [Circle Nanopayments](https://www.circle.com/nanopayments) — USDC-native agentic payments. batching thousands of offchain signatures into a single onchain transaction through [Circle Gateway](https://developers.circle.com/gateway), the per-payment gas cost is effectively eliminated.
- [x402](https://x402.org) — HTTP-native agentic payments.
- [Model Context Protocol](https://modelcontextprotocol.io/docs/getting-started/intro) — tool-aware LLM integration.
- [Ponder](https://ponder.sh/) — Arc Testnet smart contract indexer for escrow and trip state.
- [Next Forge 6](https://www.next-forge.com/) — monorepo starter template .
