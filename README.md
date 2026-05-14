<p align="center">
  <strong>Solana Frontier hackathon submission</strong> — <em>Sendero</em><br />
  <sub>Vertical AI for travel operations · Anchor + Metaplex + Squads · USDC settlement on Solana</sub>
</p>

<div align="center">
  <a href="https://sendero.travel" title="Sendero">
    <img
      src="./apps/marketing/public/brand/sendero-banner.png"
      alt="Sendero — vertical AI for travel operations on Solana"
      width="100%"
    />
  </a>
  <p>
    <strong>Vertical AI for travel operations, agent-native commerce on Solana</strong><br />
    <sub>Squads-secured treasury · Phantom Connect onboarding · Coinbase Bazaar and x402 · Metaplex agent identity + trip stamps · MoonPay agent rails · MCP + <a href="#llms-txt-surfaces">llms.txt</a></sub>
  </p>
</div>

<br />

## Judges — 60-second skim

If you only read one section, read this. Five things differentiate Sendero from the typical Frontier submission and from Colosseum history:

1. **Real Solana protocol contribution, not just SDK consumption.** Sendero authored a `@solana/kit`-based Gateway signer that Circle itself doesn't ship. Circle's stock `toSolanaSigner` only signs transactions; Gateway's `signBurnIntents` needs `signMessage`. We wrote the signer wrapper (Phase 4.5, shipped 2026-05-11) — that's the load-bearing primitive making Sol-source crosschain spend work end-to-end. See [`packages/circle/src/gateway-signer.ts::getOrCreateTenantSolanaSigner`](./packages/circle/src/gateway-signer.ts) and the unified deposit core at [`packages/circle/src/gateway-deposit-core.ts`](./packages/circle/src/gateway-deposit-core.ts).

2. **Two Anchor programs deployed on sol-devnet — not just SPL wrappers.** [`sendero_guest_escrow`](https://explorer.solana.com/address/9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8?cluster=devnet) + [`agentic_commerce`](https://explorer.solana.com/address/4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9?cluster=devnet). Real prefund / reserve / commit / settle / refund flows on Solana, not a Solana-flavored façade over an EVM contract. Plus Metaplex Core for trip-stamp NFTs and Metaplex Agent Registry for on-chain identity.

3. **Vertical AI thesis match — not consumer DeFi or NFT.** YC's RFS pegs each AI-native service vertical at $100-300M+ ARR. Sendero is that bet for travel ops: a regulated B2B2B industry with real supply (Duffel + StableTravel — flights, hotels, activities, transfers, reference data), not toy mocks. Past Colosseum winners shipped single-chain consumer DeFi or NFT — Sendero ships vertical AI infrastructure with a real supplier graph.

4. **B2B2B, not B2C.** Three audiences, three channels, one ledger:
   - **TMC operator** (paying tenant) on the web dashboard
   - **Corporate buyer** with Sendero installed in *their own* Slack workspace (B2B2B install)
   - **Traveler** on WhatsApp
   - All three reconcile on `/dashboard/inbox/[tripId]` via Liveblocks fan-out. `Tenant.primaryChain` cascade refuses silent Arc fallback for Sol tenants — typed `*_SOL_DEFERRED` errors keep parity at the compiler. Most agent projects are B2C; this is the layer Concur/Navan/Spotnana can't ship without rebuilding from scratch.

5. **Agent-to-agent commerce surface.** Sendero is on *both* sides of the agentic economy: MCP server + OpenAPI 3.1 + llms.txt + x402 nanopayments. Other AI agents (Claude, ChatGPT, autonomous workflows) can call Sendero's 128-tool catalog directly and pay per-call in stablecoin. That's the Frontier-thesis surface for agent commerce — already live at [`/api/mcp`](./apps/app/app/api/mcp).

**Credibility signal.** Won **Best Google Gemini Implementation** at the Arc Hackathon — same team, same codebase, same week we built the full Solana stack. Bilateral execution across two ecosystems isn't common.

## Try it now (judges)

| Surface | How to access |
|---|---|
| **WhatsApp traveler agent** | Message **`+56 9 2040 3095`** from any phone. Drop a passport photo, ask for a flight, check your balance. The agent runs over Circle Gateway with real Solana settlement under the hood. |
| **Web operator dashboard** | Sign in at [`https://www.sendero.travel/sign-in`](https://www.sendero.travel/sign-in) with the `hackathon@colosseum.org` reviewer credentials (in the Devpost submission form). |
| **MCP / agent-to-agent** | Point any MCP client (Claude Desktop, ChatGPT MCP, your own agent) at [`https://www.sendero.travel/api/mcp`](https://www.sendero.travel/api/mcp). Public catalog at [`/llms.txt`](https://www.sendero.travel/llms.txt). |
| **Live Solana state** | [`sendero_guest_escrow` ↗](https://explorer.solana.com/address/9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8?cluster=devnet) · [`agentic_commerce` ↗](https://explorer.solana.com/address/4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9?cluster=devnet) · [Metaplex Agent Registry ↗](https://explorer.solana.com/address/1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p?cluster=devnet) |
| **Sample Gateway deposit (Phase 4.5)** | [Arcscan tx ↗](https://testnet.arcscan.app/tx/0xd20fde5dde7f130fab80ad670cce278283c025f1e99d1bbe53130c93250ab725) — a real traveler `depositFor` to the per-traveler signer EOA, using the `@solana/kit` signer pattern we authored. |

<br />

## For judges

**Judge access has been granted.** The Clerk username + password for the dedicated `hackathon@colosseum.org` reviewer account were provided in the **Colosseum / Devpost submission form** (not in this repository). Sign in at [`https://www.sendero.travel/sign-in`](https://www.sendero.travel/sign-in) with those credentials to walk the live console, treasury surfaces, channel inboxes, and agent chat with full org context.

If the credentials did not arrive in your reviewer packet, ping the team via the submission form and we will resend immediately — secrets stay off GitHub.

<br />

## Hackathon Origin & Momentum

Sendero was **built from scratch during this hackathon period**. We worked on it for two events in parallel — the **Arc hackathon** and the **Solana Frontier Hackathon** — with the same codebase entered to both. We already took home **Best Google Gemini Implementation** at the Arc event; the Solana Frontier submission is the same project, same repo, judged on its Solana-native surface.

To see how far we moved inside the contest window — what shipped between the start of Frontier and now — here is our Arc/Google submission: **[lablab.ai/ai-hackathons/nano-payments-arc](https://lablab.ai/ai-hackathons/nano-payments-arc)**.

**Dual-chain by design, not by port.** `Tenant.primaryChain: 'sol' | 'arc'` is a runtime choice from day one. Both chains share the same agent surface, tool catalog (128 tools), MCP server, OpenAPI spec, and ledger — only the settlement adapter swaps. Solana-side: `sendero_guest_escrow`, `agentic_commerce`, Metaplex Core for trip-stamp NFTs, Metaplex Agent Registry for agent identity. EVM-side (Arc): SenderoGuestEscrow + SenderoStamps + ERC-8004. The system is genuinely multi-chain, not single-chain with a port.

**Why this exists.** We built on Y Combinator's thesis that vertical AI agents will replace SaaS, category by category. The hard part wasn't the agent — it was building a lean, replicable template so the same shell could be reused across verticals (legal, real estate, healthcare). Travel ops is the proving ground; the tool catalog is the only thing that swaps per vertical.

### What we're most proud of

- **WhatsApp-native wallet via Circle Gateway.** Gateway lets us mint a single unified USDC balance across EVM and Solana — chain selection becomes a runtime concern, not a user concern. Travelers manage funds inside WhatsApp with zero blockchain UX. Maggi (Brazil) and Félix Pago pioneered WhatsApp stablecoins for cross-border payments; we're taking the next step — a WhatsApp-native wallet driven by a vertical AI agent that actually does the work (book the flight, pay the supplier, file the expense), not just holds the money.
- **A genuinely good WhatsApp flow.** Voice notes are supported. Every share link sent via WhatsApp or Slack runs through our own Open Graph image generator, so multi-tenant customers get fully branded, share-ready cards out of the box. NFT stamps, invoices, itineraries, and approvals all unfurl natively in chat.
- **Multi-tenant operator dashboard with Liveblocks collaboration.** Web is the third surface: operators take over from the AI when needed (or when the AI asks). Liveblocks gives teams real-time collaboration on tenant workspaces, channel management, and handoffs.

### External validation

Off the back of the Arc win, **Google invited us to San Jose** to compete again at the **TechEx Intelligent Enterprise Solutions Hackathon** — enterprise AI adoption track. Same product, new venue, on the strength of the Gemini implementation we shipped during these few weeks: **[lablab.ai/ai-hackathons/techex-intelligent-enterprise-solutions-hackathon](https://lablab.ai/ai-hackathons/techex-intelligent-enterprise-solutions-hackathon)**.

### What's gated by external systems

The biggest practical blocker was **Meta WhatsApp Business verification**. The integration is complete and fully working — we just can't ship a production WhatsApp number without a verified business profile, and three days through Meta's verification flow did not get us there. For the demo we use the **Kapso sandbox** number. A real customer (e.g. a LATAM travel agency) with an established business identity verifies in a normal-length window, attaches their phone, and the same flow runs on their own number. **Slack has no equivalent friction** — OAuth, slash commands, modals, and approvals all work end-to-end against real workspaces.

### Scope clarity

Everything in the pitch deck (this repo's `/pitch` directory) is built. The four Solana programs are deployed and verified on devnet; the 128-tool catalog is live behind MCP and OpenAPI; the WhatsApp + Slack + web + MCP surfaces are wired and operational. Mainnet promotion is gated on plan-tier finalization, not on tech.

<br />

## Deployed contracts

All Sendero settlement, identity, and stamp surfaces are live on testnets — Solana devnet (the primary surface for this submission) and Arc Testnet (parity leg).

### Solana — devnet

| # | Program | Address | Explorer | Source |
|---|---|---|---|---|
| 1 | `sendero_guest_escrow` — prefund / reserve / commit / settle / refund | `9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8` | [Solana Explorer ↗](https://explorer.solana.com/address/9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8?cluster=devnet) | [`programs/sendero-guest-escrow/src/lib.rs`](./contracts/programs-solana/programs/sendero-guest-escrow/src/lib.rs) |
| 2 | `agentic_commerce` — AI-agent job lifecycle (create / fund / complete / refund) | `4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9` | [Solana Explorer ↗](https://explorer.solana.com/address/4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9?cluster=devnet) | [`programs/agentic-commerce/src/lib.rs`](./contracts/programs-solana/programs/agentic-commerce/src/lib.rs) |
| 3 | Metaplex Core — trip-stamp NFTs (boarding pass · receipt · passport) | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | [Solana Explorer ↗](https://explorer.solana.com/address/CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d?cluster=devnet) | [`packages/metaplex`](./packages/metaplex) · external program |
| 4 | Metaplex Agent Registry — Identity + Reputation + Validation (ERC-8004 parity) | `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p` | [Solana Explorer ↗](https://explorer.solana.com/address/1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p?cluster=devnet) | [`packages/metaplex`](./packages/metaplex) · external program |

TS adapters that build the instructions consumed by the agent: [`packages/guest/src/solana.ts`](./packages/guest/src/solana.ts) and [`packages/tools/src/guest-escrow.ts`](./packages/tools/src/guest-escrow.ts).

### Arc Testnet — EVM parity leg

| # | Contract | Address | Explorer | Source |
|---|---|---|---|---|
| 1 | `SenderoGuestEscrow` (proxy) — Solidity twin of `sendero_guest_escrow` | `0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515` | [Arcscan ↗](https://testnet.arcscan.app/address/0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515) | [`contracts/src/SenderoGuestEscrow.sol`](./contracts/src/SenderoGuestEscrow.sol) |
| 2 | `SenderoStamps` (Circle SCP EIP-1167 proxy) — trip-stamp ERC-1155 | `0xcc0fa83535675a856d773cfbc71232c3d7b71a03` | [Arcscan ↗](https://testnet.arcscan.app/address/0xcc0fa83535675a856d773cfbc71232c3d7b71a03) | [`scripts/deploy-stamps-template.ts`](./scripts/deploy-stamps-template.ts) · thirdweb template |
| 3 | `SenderoStamps` impl — thirdweb `TokenERC1155` | `0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672` | [Arcscan ↗](https://testnet.arcscan.app/address/0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672) | external (thirdweb prebuilt) |
| 4 | ERC-8004 `IdentityRegistry` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | [Arcscan ↗](https://testnet.arcscan.app/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) | [`packages/arc`](./packages/arc) · Arc/Circle upstream |
| 5 | ERC-8004 `ReputationRegistry` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | [Arcscan ↗](https://testnet.arcscan.app/address/0x8004B663056A597Dffe9eCcC1965A193B7388713) | [`packages/arc`](./packages/arc) · Arc/Circle upstream |
| 6 | ERC-8004 `ValidationRegistry` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | [Arcscan ↗](https://testnet.arcscan.app/address/0x8004Cb1BF31DAf7788923b405b754f57acEB4272) | [`packages/arc`](./packages/arc) · Arc/Circle upstream |

Verify the full set in one command: `bun scripts/verify-deployments.ts` (encodes expected verification shape per address — exits non-zero on any gap). Source: [`scripts/verify-deployments.ts`](./scripts/verify-deployments.ts).

<br />

## What Sendero is

Sendero is the AI operating layer for travel agencies, TMCs, concierge teams, and corporate travel desks — and the traveler companion they expose on WhatsApp, Slack, web, and MCP. It turns messy travel requests into quotes, approvals, bookings, service actions, refunds, artifacts, invoices, and settlement trails. **Solana is the trust + money backplane**: every flight, hotel, and ground leg can be booked by an AI workflow and settled in USDC on Solana with sub-second finality.

The same monorepo runs an EVM (Arc) settlement leg behind a `Tenant.primaryChain` switch. **Solana is the leg this submission scores against** — Anchor programs deployed to devnet, Metaplex Core for trip stamps, Metaplex Agent Registry for identity, Squads V4 + DCWs for treasury, Phantom Connect for the wallet UX layer. The core idea of having EVM + Solana is based on using Circle Gateway for a Unified USDC balance. This way — travelers onboarded are never exposed to the complexity of bridging between chains or handling multiple wallets; Sendero abstracts away chain differences so every payment, refund, or booking can be settled with USDC wherever it lives, and users interact with a seamless, unified balance regardless of their chain of origin with chain abstraction, no private keys, and gasless transactions for an asset-first UX.

<br />

## Sponsor integrations — what's wired and where it lives

The five Frontier sponsors below each map to a load-bearing surface in Sendero today. None of these are stub demos: they sit on the same `runAgentTurn` runtime, the same canonical `@sendero/tools` registry, the same `WorkflowRun` checkpointed graphs, and the same multi-channel `share` payload that powers WhatsApp, Slack, web, and email.

### 🛡️ Altitude + Squads — treasury & multisig

**Squads V4 Multisig** secures the tenant treasury. Every `Tenant` whose `primaryChain === 'sol'` gets a Squads-managed multisig provisioned at onboarding via `provisionTenantSolanaTreasury` (sibling to the EVM `provisionTenantWallet`). Squads holds upgrade authority on both Sendero Anchor programs (see addresses below) and on the per-tenant treasury PDA. **Altitude** is the financial OS we point operators to for cards, ACH/SEPA/SWIFT, and APY on idle balances — Sendero's `/dashboard/treasury` deep-links into Altitude when the tenant has connected their account.

- **Why:** Sendero moves real traveler money. Booking commissions, settlement fan-outs, and refund flows must not be one-key-controlled. Squads turns "operator approval threshold" from a feature flag into an on-chain invariant.
- **Where in code:** `Tenant.primaryChain` cascade in [`CLAUDE.md`](./CLAUDE.md#tenant-primarychain--cascade-invariant) · settlement adapters in [`packages/guest/src/solana.ts`](./packages/guest/src/solana.ts) · platform Solana hot-wallet runbook in [`CLAUDE.md`](./CLAUDE.md#solana-gas-abstraction-platform-hot-wallet).
- **Docs:** [Squads Multisig](https://squads.xyz/multisig) · [Altitude](https://altitude.xyz)

### 🟦 Coinbase CDP — x402, agentic market, onramp/offramp

**x402** is how Sendero monetizes its MCP tools to *other AI agents*. Every priced tool in [`packages/tools`](./packages/tools) carries a `priceFor(toolName)` policy; the edge worker's `requirePayment` middleware speaks x402 directly. Agents calling Sendero's `/api/mcp` or `/tools/:name` endpoints settle in stablecoin per-call, no checkout flow, no retained card. The **CDP facilitator** verifies + settles. Sendero registers itself in **Agentic Market** as discoverable agent infrastructure for travel ops, and points operators to **Coinbase Onramp/Offramp** for fiat ↔ stablecoin funding when MoonPay isn't the preferred rail. The **Agentic Wallet Skills** repo informed the shape of `gateway_balance`, `gateway_transfer`, and `swap_and_bridge` in our tool catalog.

- **Why:** SaaS prices the platform; x402 prices the calls. Sendero's pitch — *"a vertical AI agent that other agents can rent by the action"* — is only credible with a working agent-to-agent settlement rail. x402 + CDP facilitator gives us that on day one.
- **Where in code:** edge x402 middleware in [`apps/edge/src/lib/x402-middleware.ts`](./apps/edge/src/lib/x402-middleware.ts) · pricing policy in [`packages/tools/src/pricing.ts`](./packages/tools/src/pricing.ts) · scoped-key + signing controls in [`packages/auth/src/dispatch-auth.ts`](./packages/auth/src/dispatch-auth.ts).
- **Skill installed:** `npx skills add coinbase/agentic-wallet-skills` (live in `.agents/skills/`)
- **Docs:** [x402](https://docs.cdp.coinbase.com/x402/welcome) · [x402 MCP](https://docs.cdp.coinbase.com/x402/mcp-server) · [Agentic Market](https://agentic.market/) · [Onramp / Offramp](https://docs.cdp.coinbase.com/onramp/introduction/welcome) · [Wallet Product Guide](https://docs.cdp.coinbase.com/server-wallets/comparing-our-wallets)

### 🪪 Metaplex — agent identity, agent tokens, trip stamps

Sendero's Solana leg uses Metaplex three ways:

1. **Metaplex Agent Registry (014)** — every Sendero tenant + traveler agent gets an on-chain identity NFT with a built-in wallet via `provision_identity` on the Sol leg. This is the Solana-native parity for ERC-8004 IdentityRegistry on the Arc leg. See [`packages/metaplex/src/register-tenant-agent.ts`](./packages/metaplex/src/register-tenant-agent.ts) and [`mint-agent-identity.ts`](./packages/metaplex/src/mint-agent-identity.ts).
2. **Metaplex Core trip stamps** — every meaningful trip beat (boarding pass, settlement receipt, itinerary map, trip passport) mints a Core asset via `mintCoreTripStamp`. Same four kinds, same generative art pipeline, Solana-native instead of an ERC-1155 deploy. See [`packages/metaplex/src/mint-trip-stamp.ts`](./packages/metaplex/src/mint-trip-stamp.ts).
3. **Agent token launchpad (roadmap)** — vertical agent tokens for tenant-side resale economics. Captured in the roadmap; not gating this submission.

- **Why:** the agent economy needs durable agent identity *and* user-owned proof-of-trip. Metaplex gives us both in one stack — the `014` registry as identity, Core as the asset model, both production-grade and audited.
- **Where in code:** [`packages/metaplex/`](./packages/metaplex) — Umi factory, register, stamp, mint helpers · primaryChain cascade in [`CLAUDE.md`](./CLAUDE.md#tenant-primarychain--cascade-invariant).
- **Docs:** [Register an Agent](https://developers.metaplex.com/agents/register-agent) · [Run an Agent](https://developers.metaplex.com/agents/run-an-agent) · [Launch a Token](https://www.metaplex.com/docs/agents/create-agent-token) · [Agent Kit Docs](https://metaplex.com/docs/agents)

### 🌙 MoonPay — agent money rails, virtual cards, virtual accounts

**MoonPay Agents** is how Sendero gives agents real-world money muscle: virtual accounts so an agent can receive ACH/SEPA, virtual cards so an agent can pay a hotel that doesn't accept stablecoin, on/off-ramps so traveler funds enter and leave the agentic economy without forcing custody migration. Sendero's `/dashboard/treasury` ties MoonPay's flows in alongside Coinbase Onramp — operators pick the rail that matches their geography. The **30+ MoonPay skills** repo is part of the agent's tool surface for cross-chain swaps, balance checks, and commerce flows.

- **Why:** travel touches fiat boundaries that pure-stablecoin agents cannot cross alone — supplier ACH payouts, virtual cards for hotels, ramps for travelers in countries where stablecoin off-ramps are weak. MoonPay closes that gap without leaving the agent runtime.
- **Where in code:** `quote_fx`, ramp surfaces, and the treasury dashboard. Roadmap: virtual-card issuance for guest passes (the Navan-shaped wedge described below).
- **Skill (CLI):** `npm install -g @moonpay/cli` then `moonpay-mcp` setup. (See `.agents/skills/moonpay-mcp/`).

<br />

## Anchor programs deployed (Solana devnet)

Sendero's Solana leg runs two Anchor programs deployed to **sol-devnet**, plus two external programs (Metaplex Core + Agent Registry) consumed via `@sendero/metaplex`. Authority signs through the `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` upgrade authority, which is also held under Squads multisig in production rollout.

| Program | Address | Role |
|---|---|---|
| `sendero_guest_escrow` | `9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8` | Solana port of the EVM guest-escrow contract. Prefund / claim / reserve / commit / settle / refund / sweep parity. Powers the Peanut-style guest-pass flow on Solana. |
| `agentic_commerce` | `4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9` | AI-agent job lifecycle (create / fund / complete / refund). Solana-native, no EVM twin — for agent-to-agent jobs paid in stablecoin. |
| Metaplex Core | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | Trip-stamp NFT minting (BoardingPass / SettlementReceipt / ItineraryMap / TripPassport). |
| Metaplex Agent Registry | `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p` | Agent identity + reputation + validation. Solana parity for ERC-8004 on the EVM leg. |

Re-deploy flow + IDL pinning runbook lives in [`CLAUDE.md`](./CLAUDE.md#solana-anchor-program-runbook-devnet). Authority + program-data audit ships in [`apps/admin/lib/contracts/audit-solana.ts`](./apps/admin/lib/contracts/audit-solana.ts) — refresh from `/dashboard/contracts?chain=sol`.

### Solana gas abstraction — platform hot wallet

Circle Gas Station is EVM-only, so Sendero runs a **platform Solana hot wallet** (`SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`) that JIT-drips ~0.01 SOL into any DCW about to sign. Auto-wired into `deposit / depositFor / spend / bridge` for `circle-wallets` principals on Sol_Devnet / Sol. Refill cadence + low-balance Slack alerting documented in [`CLAUDE.md`](./CLAUDE.md#solana-gas-abstraction-platform-hot-wallet). Squads multisig holds the platform-wallet authority before the mainnet flip.

<br />

## The agent runtime — durable, observable, multi-channel

The Solana sponsors above are integrations *on top of* a runtime that Sendero already ships. Three properties make that runtime work:

**Durable workflows.** Every booking, refund, OCR pipeline, and channel-setup wizard is a Vercel Workflow run with `'use step'` checkpoints. The `sendero.book_flight` workflow can pause for hours awaiting `supplier_order_ticketed`, drift across two deploys, and resume from the exact pending step on the next webhook. Pairs with column-level encryption (`pgcrypto` + per-tenant DEK derived via HKDF from a Vercel-env KEK) so the LLM never sees plaintext PII.

**Multi-channel by construction.** A single `ChannelMessage` discriminated union renders to operator web, Slack block kit, WhatsApp interactive, web traveler card, and Resend email. Same canonical shape, four native outputs. Build one, ship four. See [`apps/app/lib/channel-render/`](./apps/app/lib/channel-render).

**Observability + self-healing.** Langfuse owns prompt management + four-judge LLM-as-Judge evaluators per turn. Phoenix indexes the same OpenTelemetry spans for agent-runtime self-introspection: agents call `recall_similar_turns` and `find_resolved_gap` against their own dataset before escalating to a human. Strict dev-only at the agent layer (`NODE_ENV` + `VERCEL_ENV` + caller-key gate). See [`packages/arize-phoenix/`](./packages/arize-phoenix) and [`packages/langfuse/`](./packages/langfuse).

<br />

## Best Use of Gemini — OCR for receivables

Drag a receipt, invoice, boarding pass, or passport into [`/dashboard/scan`](./apps/app/app/(app)/dashboard/scan/page.tsx) and get sub-second structured extraction — schema-pinned, ready to reconcile against a trip. Four document kinds, four Zod schemas in [`packages/ocr/src/schemas/`](./packages/ocr/src/schemas/). `gemini-2.5-flash` by default with `thinkingBudget: 0` (OCR is not a reasoning task), Pro on demand for genuinely ambiguous docs.

**Production hardening:** SSRF guard on URL-fetch, 20 MB payload cap + MIME allowlist, PII audit signal on boarding-pass scans, compliance gate on government-ID scans (`allowSensitive` admin flag), post-Gemini normalization (ISO-4217, ISO-8601, EU/US/JP date forms, European decimal). Two entry points (UI + agent-callable `scan_document` MCP tool), one engine (`extractDocument()`).

### Private passport vault — encrypted boundary, visa as ancillary revenue

Passports get a dedicated privileged path. Client-side MRZ parsed with `mrz-fast` (offline, ICAO 9303 TD3); image bytes discarded before the network call. `pgcrypto` `pgp_sym_encrypt(..., 'cipher-algo=aes256')` via parameterized `$queryRaw`, per-tenant DEK derived via HKDF-SHA256 from a Vercel-env KEK. Agent surface (`check_travel_eligibility`) returns enum codes only — never names, never DOBs, never passport numbers. Sherpa Requirements API v3 layered on top so `apply-product` actions surface as **"Add visa assistance — $185"** ancillary CTAs on the offer card. See [`packages/vault/`](./packages/vault) and the verdict pipeline in [`packages/vault/src/verify.ts`](./packages/vault/src/verify.ts).

### Living trip stamps — Gemini paints, Metaplex Core mints

Every meaningful trip beat (`book_flight` → BoardingPass · `book_flight` again → ItineraryMap refresh · `settle_booking` → SettlementReceipt · final settle → TripPassport) fires a Vercel Workflow that runs Gemini 2.5 Flash Image and a Gemini caption *in parallel*, pins both to IPFS via Pinata, and mints a Metaplex Core asset to the traveler's wallet. ~6 s wall-clock from supplier confirm to minted NFT. The OG unfurl path uses the Vercel Blob copy for sub-100ms preview rendering; the on-chain `tokenURI` resolves through any IPFS gateway. **Proof-of-trip you can put in your pocket** — and a marketing surface that renders inline in any Slack/WhatsApp/X paste.

```
apps/app/workflows/stamps/
├── generate-boarding-pass.ts       ← BoardingPass     (vintage 1960s jet-age)
├── generate-settlement-receipt.ts  ← SettlementReceipt (railway ticket, USDC stamped)
├── generate-itinerary-map.ts       ← ItineraryMap     (WPA poster, redraws on each leg)
└── generate-trip-passport.ts       ← TripPassport     (two-page passport spread, capstone)
```

Idempotency throughout: Pinata is content-addressed, the `mint_stamp` tool is `UNIQUE(kind, primaryKey)` in Postgres, the Metaplex Core mint is keyed off `(kind, tripId, bookingId)`. WDK retries are surgical — Gemini 5xx? Just that step retries. Mint reverts? Image + manifest already pinned, mint re-attempts without re-spending Gemini tokens.

<br />

## Business model — SaaS + x402 nanopayments, audience-split

Two independent revenue legs. **Leg 1 — Recurring SaaS** (Clerk Billing on organizations): four tiers, monthly or annual, zero-card 14-day Pro trial. Plans gate workspaces, production API keys, MCP-server exposure, SSO, white-label, SLA via `has({ feature })`. **Leg 2 — Per-call nanopayments** (x402 via Coinbase CDP, settled in USDC): every priced tool — flight search, policy check, booking hold, confirmation, MCP tool call — is metered and settled.

**Audience split is load-bearing.** TMCs / corporate travel buyers see *only* "monthly platform + included usage + transparent overages". x402 nanopayments are the agent-to-agent settlement rail surfaced to **other AI agents calling Sendero via MCP**, not to humans on `/app/billing/plans`. Source of truth: [`packages/billing/src/plans.ts`](./packages/billing/src/plans.ts). Resolver: [`apps/app/lib/billing-plan.ts`](./apps/app/lib/billing-plan.ts).

| | **Free** | **Basic** | **Pro** | **Enterprise** |
|---|---|---|---|---|
| **Monthly** | $0 | $19/mo | $60/mo | Custom *(list $1,500/mo)* |
| **Workspaces** | 1 | 5 | Unlimited | Unlimited |
| **Production API keys** | 0 *(sandbox only)* | 3 | 25 | Unlimited |
| **Monthly spend cap** | $100 | $2,000 | $20,000 | Unlimited |
| **Nanopayment discount** | — | 15% off | 30% off | 50% off |
| **Booking take-rate discount** | — | 5% off | 10% off | 15% off |
| **WhatsApp + Slack channels** | — | ✓ | ✓ | ✓ |
| **Public MCP server** | — | — | ✓ | ✓ |

Trials monetize leg 2 even when leg 1 is $0. Pro+ customers monetize both. Enterprise commits both at negotiated discounts. Clerk subscription keeps the customer; Solana settlement keeps the network.

<br />

## Hardening the x402 edge — scoped keys, signed requests, signed envelopes

x402 monetizes every leaked key adversarially. A stolen bearer that fires 10,000 cheap searches before we revoke is still real money; one that moves USDC is catastrophic. Sendero's three controls — none of which add cost on the hot path:

1. **Scoped API keys** ([`packages/auth/src/dispatch-auth.ts`](./packages/auth/src/dispatch-auth.ts)). Every key carries a scope set: `search`, `bookings`, `settlement`, `treasury`, `documents`, `compliance`, `trip_assistance`, `utilities`, or `*`. Production keys mint with a read-mostly default — **no settlement, no treasury**. The dispatch route filters the tool registry *before the LLM sees it*, so prompt injection cannot sneak the model into calling out-of-scope tools.

2. **HMAC-signed requests for privileged tools.** Keys with `settlement`, `treasury`, or `*` must sign with `x-sendero-ts` + `x-sendero-nonce` + `x-sendero-sig = HMAC-SHA256(sha256(bearer), canonical-string)`. Read-mostly scopes stay bearer-only. Nonce dedup via Upstash `SET NX EX 120s`.

3. **Signed response envelopes — every reply.** Every response carries `x-sendero-trace-id`, `x-sendero-meter-id`, `x-sendero-ts`, `x-sendero-sig`. MITM replays of cached responses are exposed as unpaid.

Public recipe: [`/docs/security`](./apps/docs/content/docs/security.mdx).

<br />

## Developer experience — built so other agents can call us

Sherpa's docs set the B2B API bar; we matched it and closed two gaps. Self-service key issuance (Clerk-native, no form), and per-page markdown exports for every docs page (append `.md` to any `/docs/*` URL). All tooling discovered through one fetch:

- **Canonical OpenAPI 3.1** at `/api/openapi.json`, generated from the [`packages/tools`](./packages/tools) registry. Scalar, Redoc, Postman, Insomnia consume it as-is.
- **Interactive Scalar viewer** at `/api-viewer`. Try any tool, copy the `curl`, deep-link to Clerk's API-key UI.
- **MCP server** at `/api/mcp` (app) and `/mcp` (edge). Same canonical `@sendero/tools` registry over MCP JSON-RPC.
- **x402-gated direct HTTP** at `/tools/:name` on the edge worker.
- **`llms.txt`** at every origin (product app, marketing, docs, help, edge) — see the [surface table](#llms-txt-surfaces) below.

**Time-to-first-success:** sign up → mint key → first nanopayment-billed tool call in under 5 minutes, no sales call, no email thread.

<a id="llms-txt-surfaces"></a>

### llms.txt surfaces

| Surface | Role | `llms.txt` |
| --- | --- | --- |
| **Product app** | Authenticated console, MCP, webhooks, billing, trips | [www.sendero.travel/llms.txt](https://www.sendero.travel/llms.txt) |
| **Marketing** | Public positioning, pricing, audiences | [sendero.travel/llms.txt](https://sendero.travel/llms.txt) |
| **Help** | Support articles and troubleshooting | [help.sendero.travel/llms.txt](https://help.sendero.travel/llms.txt) |
| **Docs** | MCP integration, tool catalog, x402, API shapes | [docs.sendero.travel/llms.txt](https://docs.sendero.travel/llms.txt) |
| **Edge** | Direct worker discovery for MCP and `/tools` | [edge.sendero.travel/llms.txt](https://edge.sendero.travel/llms.txt) |

Implementation lives in [`packages/llms`](./packages/llms). Each Next app wires `app/llms.txt/route.ts` to that package.

<br />

## How Sendero designs the travel experience

Sendero is not a chat on top of a booking tool — it is a **workflow engine with channels on top** for multi-tenant agencies and corporate travel desks. The design principles below are codified as a skill (`.agents/skills/design-travel-experience-ai`).

**One share, many channels.** A traveler-facing step produces a single `share` payload (title, body, bullets, CTAs, optional image URL). The same shape renders as a WhatsApp interactive message, a Slack block kit card (for operators), an email via [`@sendero/notifications`](./packages/notifications), and a web card in [`apps/app/components/ai-elements/`](./apps/app/components/ai-elements). If a field matters to UX, it lives in `share` — never hard-coded in one adapter. A flow can start on WhatsApp, resume on the web, and mail a receipt — one durable run.

**Roles drive surfaces.** `Role` enum in [`packages/database/prisma/schema.prisma`](./packages/database/prisma/schema.prisma):

| Role | Primary channel | What they see | Key affordances |
| --- | --- | --- | --- |
| **agency_admin** | Web console + Slack | All tenant trips, policy editor, approval inbox, commission reports, guest-pass issuance. | Prefund trips, issue guest passes, override policy with memo, approve exceptions, bulk prefund via `agencyCohortWorkflow`. |
| **finance** | Web console + email | Invoices, settlement tx list, refund ledger, commission splits. | Export CSV, open artifact pack (`opsArtifactPackWorkflow`), drill from invoice → settle tx → per-leg split. |
| **traveler** | WhatsApp / web / email | Their own trips, policy summary, offer cards, check-in nudges, receipts. | Book within policy, pick ancillaries, approve rebooks on disruption. |
| **guest** | WhatsApp (entry) + web (claim) + email | One trip — the one they were invited to — and only after claim. | Claim via Phantom passkey, pick offer within prefunded budget, confirm booking, receive receipt. No long-lived account. |

**Guest passes — the Navan-shaped wedge.** A guest pass is a WhatsApp/Slack-shareable link that lets someone without a Sendero account spend a prefunded USDC budget on one trip, then walk away. `prefund_trip` escrows USDC on-chain via `sendero_guest_escrow`; [`@sendero/guest`](./packages/guest) emits a Peanut-style share link (private key in URL fragment, never server-side); the guest enrolls a Phantom passkey and signs `claim_trip`; the agent books inside the budget. Unspent budget auto-refunds at expiry. Canonical workflows: `guestPrefundWorkflow` (single seat) and `agencyCohortWorkflow` (bulk).

**Workflows are durable objects.** [`packages/workflows`](./packages/workflows) persists every `WorkflowRun`. `pause` steps suspend and resume from the exact pending step when a webhook / traveler reply / approval lands — days later, different channel, different device. Travelers never have to "stay on this page." Every pending state is reachable from their inbox with a live link.

**Confirmations persist via email.** Chat is ephemeral. Legal and airline receipts are not. Every terminal success/failure mails via [`@sendero/notifications`](./packages/notifications) (Resend) — `sendInvoice` with the PDF, `publicUrl` to `/invoice/<token>`, on-chain settle tx hash. Sent from the workflow's terminal step, not the channel adapter.

**Blockchain × AI — the chain is the trust root.** Escrow before tool call (`prefund_trip` + `reserve_booking` lock funds before the LLM is allowed to book). Policy as on-chain check, not a prompt instruction. Settle only on confirmed state (`settle_booking` fires on the supplier ticketed webhook, not on the LLM saying "I booked it"). Every terminal surface includes the tx hash + explorer URL.

<br />

## What this submission demonstrates against the Frontier rubric

| Frontier criterion | What Sendero ships |
|---|---|
| **Solana-native settlement** | `sendero_guest_escrow` Anchor program on devnet; USDC settle on every `confirm_booking`; tenant `primaryChain: 'sol'` cascade. |
| **Agent identity + reputation** | Metaplex Agent Registry mints per-tenant + per-traveler agent NFTs at onboarding via `provision_identity`. |
| **Asset model** | Metaplex Core trip stamps for four trip beats, generative art via Gemini 2.5 Flash Image, IPFS-pinned manifests. |
| **Treasury controls** | Squads V4 multisig as program-upgrade authority + tenant-treasury authority. Altitude as the operator-side financial OS deep-link. |
| **Wallet UX** | Phantom Connect for traveler-facing email-first onboarding + native crypto-user fast-path. |
| **Agentic commerce rail** | x402 via Coinbase CDP facilitator on every priced MCP tool. Sendero registers in Agentic Market as travel-ops infra. |
| **Real-world money** | MoonPay virtual cards + virtual accounts + ramps for the supplier-side flows where stablecoin doesn't reach. |
| **AI quality discipline** | Arize Phoenix as the one-place AI & agent engineering platform — development, observability, and evaluation. Langfuse complements with 4-judge LLM-as-Judge per turn + prompt management. Both gated by the Responsible-AI ship guard. |
| **Production hardening** | Scoped API keys, HMAC-signed privileged calls, signed response envelopes, encrypted-by-default workflow runtime. |

<br />

## One-liner setup (mise)

All tool versions (bun 1.3.10, node 22.18, prisma 5.22) are pinned in [`.mise.toml`](./.mise.toml) and auto-activate on `cd`.

```bash
curl https://mise.run | sh                                   # install mise
eval "$(mise activate zsh)"                                  # or bash
mise install && mise run bootstrap                           # tools + deps + prisma client
lefthook install --force                                     # enable git hooks
```

Then:

```bash
mise run dev              # full stack (apps + edge + Ponder indexer)
mise run dev:web          # web only → http://localhost:3010
mise run typecheck        # turbo run typecheck
```

### Run it locally with `bun dev:complete`

If you'd rather skip `mise` and drive everything from bun, this is the path. `bun dev:complete` boots seven workspaces in parallel through turbo with streaming UI: the main app, marketing site, help center, docs, edge worker, Ponder indexer, and Storybook.

#### 1. Prerequisites

- **bun 1.3.10+** — `curl -fsSL https://bun.sh/install | bash`
- **Node 22.18+** — for `prisma` codegen and Anchor scripts
- **Postgres** — Neon project (free tier works) or a local Postgres reachable on a `postgresql://…` URL
- **(optional) Anchor 0.30+** — only if you plan to redeploy the Solana programs; the deployed devnet program IDs in the README work out of the box

#### 2. Install and seed env

```bash
git clone https://github.com/<your-fork>/sendero && cd sendero
bun install                                  # workspaces + prisma postinstall
cp .env.example .env.local                   # copy the env scaffold
```

Open `.env.local` and fill **at minimum** the keys below. Every other key in `.env.example` is documented inline; most are optional for a first boot.

| Variable | Purpose | Where to get it |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` / `DATABASE_URL_UNPOOLED` | Postgres for app + prisma + LISTEN/NOTIFY | [Neon](https://console.neon.tech) (pooled + direct + unpooled URLs) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | Auth, orgs, billing tier | [Clerk dashboard](https://dashboard.clerk.com) |
| `GEMINI_API_KEY` *or* `AI_GATEWAY_API_KEY` | Agent LLM. Gateway is preferred; Gemini-direct is the fallback | [Google AI Studio](https://aistudio.google.com/apikey) / [Vercel AI Gateway](https://vercel.com/dashboard/ai) |
| `DUFFEL_API_TOKEN` (`duffel_test_…`) | Flights + hotels (sandbox is free) | [Duffel](https://duffel.com/docs/guides/quick-start) |
| `PASSPORT_VAULT_KEK` | 32-byte base64; encrypts the passport vault | `openssl rand -base64 32` |
| `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` | Base58 keypair; pays SOL gas for Gateway-mint drips | `solana-keygen new` + `cat` the JSON, or Phantom export |
| `SENDERO_SOLANA_RPC_URL` | Solana RPC | Defaults to `https://api.devnet.solana.com` |
| `NEXT_PUBLIC_APP_URL` | Same origin you open in the browser | Keep `http://localhost:3010` for dev |

Channel/sponsor surfaces (`KAPSO_*`, `SLACK_*`, `COINBASE_CDP_*`, `MOONPAY_*`, `LIVEBLOCKS_*`) degrade gracefully when missing — the app boots and the affected surface logs a warn. Add them only when you want to exercise that channel.

Validate your env wiring at any point:

```bash
bun env:validate                              # checks process.env vs zod schemas in @sendero/env
bun run scripts/config-doctor.ts              # diffs .env.example vs what TS actually reads
```

#### 3. Database bootstrap

```bash
bun db:generate                               # prisma client
bun db:migrate                                # apply migrations to your DATABASE_URL
bun db:seed                                   # optional — seeds plan tiers + demo tenant
```

#### 4. Run the full stack

```bash
bun dev:complete
```

Streaming UI prints each workspace separately. Once stabilized, the following ports are live:

| Port | Workspace | URL |
|---|---|---|
| `3010` | `@sendero/app` — main app, agent runtime, MCP, dashboards | http://localhost:3010 |
| `3011` | `@sendero/marketing` — sendero.travel landing | http://localhost:3011 |
| `3012` | `@sendero/help` — help center | http://localhost:3012 |
| `3020` | `@sendero/docs` — docs site + API viewer | http://localhost:3020 |
| `3021` | `@sendero/edge` — Hono edge worker (x402 paywall, Routing Middleware) | http://localhost:3021 |
| `3030` | `@sendero/storybook` — component sandbox | http://localhost:3030 |
| — | `@sendero/indexer` — Ponder indexer (no HTTP port; logs to stream) | — |

Want a leaner boot? Three smaller scripts cover the common subsets:

```bash
bun dev                                       # @sendero/app only — fastest cold start
bun dev:edge                                  # edge worker only
bun dev:all                                   # every workspace including any new ones
```

#### 5. (Optional) Solana platform wallet bootstrap

The platform hot wallet pays SOL gas for Gateway mint operations and is required if you want to exercise the full Solana settlement path. One-shot bootstrap:

```bash
bun apps/app/scripts/_local/provision-solana-platform.ts
```

This generates a base58 keypair, attempts a devnet airdrop (~1 SOL), and prints the value to paste into `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`. Top up via [faucet.solana.com](https://faucet.solana.com) if the airdrop fails — 1 SOL covers ~100 transfers.

#### 6. Troubleshooting

- **Prisma client out of date** → re-run `bun db:generate` after any schema change.
- **`PASSPORT_VAULT_KEK` unset** errors in agent runtime → generate one with `openssl rand -base64 32` and restart. Most agent tools tolerate it missing; `scan_passport_inline` does not.
- **Wallet balance SSE silent** → set `DATABASE_URL_UNPOOLED` (Neon's direct URL). Without it the stream falls back to a 10s slow-poll and logs a warn.
- **Port already in use** → run `mise run ports` (kills Sendero dev processes) or override with `APP_PORT=4010 bun dev:complete`.
- **AI tools refuse to start** → confirm one of `AI_GATEWAY_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_API_KEY` is set. The cascade is Gateway → Gemini → OpenAI → Anthropic.

### Anchor (Solana programs)

```bash
cd contracts/programs-solana
anchor build
anchor deploy --provider.cluster devnet
anchor idl init --provider.cluster devnet \
  --filepath target/idl/sendero_guest_escrow.json \
  9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8
```

Authority + IDL audit refresh from `/dashboard/contracts?chain=sol`. Re-deploy runbook in [`CLAUDE.md`](./CLAUDE.md#solana-anchor-program-runbook-devnet).

### Required env (excerpt — full list in `.env.example`)

- `AI_GATEWAY_API_KEY` — Vercel AI Gateway (Gemini-first; preferred)
- `GEMINI_API_KEY` — Gemini direct fallback
- `DUFFEL_API_TOKEN` — flights + hotels
- `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` — base58, signs JIT-gas drips + program upgrades (Squads multisig in prod)
- `SENDERO_SOLANA_RPC_URL` — defaults to `https://api.devnet.solana.com`
- `NEXT_PUBLIC_PHANTOM_*` — Phantom Connect embedded wallet keys
- `COINBASE_CDP_*` — CDP facilitator + x402 settlement
- `MOONPAY_API_KEY` — agent rails (virtual cards, accounts, ramps)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` — auth
- `NEXT_PUBLIC_APP_URL` — same origin you open in the browser

<br />

## Stack

- **Solana devnet** — `sendero_guest_escrow` + `agentic_commerce` Anchor programs; Metaplex Core for stamps; Metaplex Agent Registry for identity.
- **Squads V4 Multisig** — program-upgrade authority + tenant-treasury authority.
- **Phantom Connect** — embedded wallet for travelers + operator signing surface.
- **Coinbase CDP** — x402 facilitator, agentic market discovery, onramp/offramp fallback.
- **Metaplex** — Agent Kit for identity, Core for trip stamps, Umi runtime in [`packages/metaplex`](./packages/metaplex).
- **MoonPay Agents** — virtual cards, virtual accounts, swaps, ramps via the agent runtime.
- **Next.js 15** (App Router) on Vercel Fluid Compute · **React 19** · **Vercel Workflow DevKit** for durable runs · **Vercel AI Gateway + Google Gemini** as the default LLM path.
- **Arize Phoenix** as the AI & agent engineering platform — one place for development, observability, and evaluation. Get visibility into your agents. Complemented by **Langfuse** for prompt management + production-trace LLM-as-Judge scoring.
- **AI SDK + MCP** — every tool ships through both surfaces from one definition in [`packages/tools`](./packages/tools).
- **Postgres** (Neon) + **Upstash Redis** for cache + nonce dedup.
- **Resend** for email · **Pinata** for IPFS · **Kapso** for WhatsApp orchestration.

### Hackathon resource advisor

The Colosseum sponsor + RPC + build-path index is mounted as a skill so future iterations can re-query the live corpus when adding sponsors:

```bash
npx skills add ColosseumOrg/colosseum-resources
```

(Already installed at `.agents/skills/colosseum-resources/`.)

<br />

## Agent-to-agent integration

Sendero can be called by another AI agent as a travel sub-agent:

- **`llms.txt` manifests** — see the [surface table](#llms-txt-surfaces) above; each app links to the others for cross-discovery.
- **MCP** — `/mcp` on the edge worker and `/api/mcp` on the app expose the shared `@sendero/tools` registry over MCP JSON-RPC.
- **x402 direct HTTP** — `/tools/:name` exposes the same tools as x402-gated endpoints (Coinbase CDP facilitator).
- **Workflows** — `/api/workflows/run` and `/api/workflows/resume` run named plans such as `sendero.book_flight`, which handles search, policy, escrow reservation, ticketing pauses, settlement, and invoice generation.

Start with [`apps/docs/content/docs/agent-to-agent-booking.mdx`](./apps/docs/content/docs/agent-to-agent-booking.mdx) for the complete delegated booking flow.

<br />

## Sendero Minions — the agent's own bug tracker

`sendero-arc-minions` is a sibling Vercel project (a fork of `vercel-labs/open-agents` living in [`apps/open-agents/`](./apps/open-agents)) that runs the **Raj demand-driven loop** — the agent's own Kanban-style bug tracker. When Sendero's agent hits a missing tool, wrong field name, dead instruction, or unrecoverable error, [`report_knowledge_gap`](./packages/tools/src/report-knowledge-gap.ts) files a card on the Minions board, deduped by `sha256(kind | tool_name | hypothesis_norm)` so the same root cause never opens twice. Operators drag a card to **"in_progress"** with the auto-execute switch on, and Minions kicks off a sandboxed OA session against the target repo to propose a fix as a PR — all without leaving the board.

The two apps are integrated via a single HTTP seam:

- **Direction A** — Sendero → Minions: `POST /api/agent-gaps/ingest` with `Authorization: Bearer ${AGENT_GAPS_INGEST_SECRET}` mirrors a gap report onto the Minions board.
- **Direction B** — Minions → Sendero: `GET /api/agent-gaps/find-resolved` lets a running session ask "has anyone fixed this hypothesis before?" so prior fixes get injected back into the agent's system prompt as a self-heal preamble.

On top of the loop, every card carries paired observability — **Phoenix →** and **Langfuse →** badges pointing at the same OpenTelemetry `trace_id`. The Sendero monolith and Minions both boot with a dual OTel processor (`@arizeai/phoenix-client` + `@langfuse/otel`), so one click takes an operator from a kanban card into Phoenix's entity-keyed cluster view *or* Langfuse's prompt + LLM-judge view of the exact same agent turn. On `resolveGap`, the `(hypothesis, fix_summary, must_mention)` triple gets pushed to a Phoenix `sendero-minions-resolved-gaps` dataset; a nightly evaluator scores any future trace whose `hypothesis_norm` matches a resolved entry but doesn't mention the `must_mention` tokens as a **self-heal regression** — closing the demand-driven loop.

| | Main Sendero | Minions |
|---|---|---|
| Vercel project | `sendero-arc-web` | `sendero-arc-minions` |
| Neon DB | Sendero main | isolated branch |
| Langfuse project | `sendero` | `sendero-minions` |
| Phoenix project | `sendero` | `sendero-minions` |
| Slack channel | varies | `#sendero-minions` |
| Slack app | Sendero bot | Sendero Minions app |
| GitHub App | Sendero bot | `sendero-arc-minions` |

The fork is tracked as a `git subtree` from upstream `vercel-labs/open-agents` so Vercel's upstream improvements flow in cleanly via `git subtree pull`, while Sendero-specific layers (the paired observability, the rename pass from BuFi's bridge-bot pattern to Sendero's, the migration adjustments) live as ordinary commits on top.

<br />

## Why we built this

Inspired by Y Combinator's thesis that **vertical AI agents may become larger businesses than SaaS** ([Lightcone](https://www.youtube.com/watch?v=ASABxNenD_U), [YC Shorts](https://www.youtube.com/shorts/lvmmk85ArWg)). The deeper idea is **replicability**: a template for vertical AI agents on Solana, paid for with nanopayments and usage-based billing instead of flat SaaS seats. Price tracks **work actually completed** in fully automated flows, which weakens the assumption that every workflow must live behind a traditional product UI.

Travel is the first vertical. Legal, real-estate, and healthcare are next — same template app shell, same channel adapters, same settlement rail, same billing plumbing. **The only thing that changes per vertical is the tool catalog.** See [`apps/admin/`](./apps/admin) for the meta-control plane.

### Enterprise travel — Navan-shaped, but agent-native

Corporate travel is a Navan-shaped market. Ramp's March 2026 acquisition of Juno (the non-employee guest-travel platform) is a public bet that **guest travel** is a first-class enterprise problem, not a sidecar to employee booking. Sendero's `sendero_guest_escrow` program + Metaplex agent identity + Phantom-Connect onboarding + Squads-secured treasury is aimed at that same wedge: **agent-native, on-chain settlement and policy** for the trips enterprises already pay for, without assuming everyone lives inside one vendor's UI. Native WhatsApp and Slack support means we meet travelers where they already are.

<br />

---

<p align="center">
  <img
    src="./apps/marketing/public/brand/signature/motion-passport-tomas-cordero.png"
    alt="Motion passport — Tomas Cordero"
    width="520"
  />
</p>

<p align="center">
  <strong>Built by Tomas Cordero</strong><br />
  <sub>indie hacker · design engineer · blockchain & AI developer · full stack · TypeScript, Rust & Solidity</sub>
</p>

<p align="center">
  <a href="https://x.com/criptopoeta">X · @criptopoeta</a> ·
  <a href="https://github.com/tcxcx">GitHub · @tcxcx</a> ·
  <a href="https://www.linkedin.com/in/tomas-cordero-b601452a7/">LinkedIn</a>
</p>

<p align="center">
  <sub>
    Huge thanks to <a href="https://emilkowal.ski/">Emil Kowalski</a> and the broader design-engineering community for teaching us how to make software truly feel right.<br />
    Gratitude to <a href="https://shadcn.com/">shadcn</a> and <a href="https://rauchg.com/">Guillermo Rauch</a> for making building robust, beautiful apps easier for everyone.<br />
    Special thanks to <a href="https://www.colosseum.com/">Colosseum</a> for hosting the Solana Frontier hackathon and to every Frontier sponsor — <b>Squads / Altitude, Phantom, Coinbase, Metaplex, MoonPay</b> — for shipping the rails Sendero is built on.<br />
    Appreciation to <b>Google for Gemini credits</b> and to the <b>Anthropic</b>, <b>OpenAI</b>, and <b>Cursor</b> teams for agentic coding tools that turn wild ideas into reality.<br />
    Shout out to <a href="https://skills.sh/">skills.sh</a> for making sponsor skills installable without friction.<br />
    Deep thanks to the Solana developer community on Discord, the Metaplex DevRel office hours, and every contributor to the npm packages we rely on without ever knowing your names.<br />
    And to AGI and onwards! 🤠<br />
    <b>DX feedback is attached — see <a href="./FEEDBACK.md">FEEDBACK.md</a> for track-submission notes and improvements.</b>
  </sub>
</p>
