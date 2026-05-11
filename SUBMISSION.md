# Sendero — lablab.ai × Circle "Agentic Economy on Arc" submission

Copy/paste-ready content for the lablab submission form. Field order matches the form (Step 1 of 3). Character counts are validated against the form's stated min/max.

> **Judges — full Circle product feedback (with code-level repro, root causes, and one-line fixes) lives at [`docs/feedback/submission-feedback.md`](./docs/feedback/submission-feedback.md). The "Circle Product Feedback" field below is a condensed version of that document — keeping the form readable while preserving link-out for the Product Feedback Incentive review.**

---

## Submission Title

```
Sendero — Agentic travel ops on Arc
```

`35 / 50 characters` ✓

Alternates if you want a different framing:

- `Sendero — Vertical AI for travel on Arc` (40)
- `Sendero: agent-native travel + USDC on Arc` (42)

---

## Short Description

```
Sendero is the AI operating layer for travel agencies, TMCs, and travelers. Agents quote, book, and reconcile real flights, hotels, and ground legs — settled atomically in USDC/EURC on Arc with on-chain guest escrow, x402 nanopayments, and MCP.
```

`241 / 255 characters` ✓ (min 50)

---

## Long Description

```
Sendero turns messy travel requests into quotes, approvals, bookings, refunds, invoices, and on-chain settlement trails. The agent layer runs on Vercel Workflows + Fluid Compute (durable, encrypted, resumable across days), the money layer runs on Arc.

Two revenue legs from day one. SaaS via Clerk Billing (Free → Enterprise) gates workspaces, MCP exposure, SSO. x402 nanopayments meter every search, policy check, booking hold, and tool call in micro-USDC, batched and settled on Arc L2 in a single userOp that atomically fans funds to vendor + agency commission + Sendero fee + reputation tip. Card rails cannot do atomic multi-leg settlement — this is the Arc-specific unlock.

The on-chain core is SenderoGuestEscrow (proxy 0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515 on Arc Testnet, chain 5042002, verified on Arc Scan). It pairs Peanut-style payment links with a travel state machine: reserve → commit → confirm → settle, with recipient-bound ECDSA signatures, an optional OTP claimCodeHash second secret, upper-bound reservations for fare drift, and buyer reclaim on timeout. Sits beside ERC-8183 job escrow and ERC-8004 agent identity/reputation. A self-hosted Ponder indexer keeps escrow events in Postgres + GraphQL.

Wallets are Circle Modular Wallets (passkey MSCAs for travelers and guests) plus Circle Developer-Controlled Wallets for treasury — both on Arc. Circle App Kit powers in-app swap (USDC↔EURC), CCTP bridge, send, and unified balances across testnets. Settlement uses Circle Nanopayments + Circle Gateway to batch thousands of off-chain signatures into one on-chain tx, eliminating per-payment gas. Trip-collectibles (souvenir NFTs) ship via Circle's Smart Contract Platform ERC-1155 template + Gas Station, with Circle Webhooks + Event Monitors feeding the indexer.

Beyond flights and hotels: visa-aware quotes via Sherpa with private MRZ-validated PassportVault (pgcrypto AES-256, per-tenant DEK), Gemini-powered receipt/invoice/boarding-pass OCR with Zod-pinned outputs, Google Maps Platform travel-safety briefs, and an MCP + llms.txt + OpenAPI surface so other agents can book through Sendero by spec.
```

`~1,995 / 2,000 characters` ✓ (well over 100-word minimum — ~330 words)

---

## Participation Mode

```
ONLINE
```

---

## Categories

Pick all that match what the form lists. Natural fits:

- AI Agents / Agentic Apps
- DeFi / Payments / Stablecoins
- Consumer / Travel / Vertical SaaS

---

## Event Tracks

```
Agentic Economy on Arc
```

(Use the exact track label from the form's dropdown — this is the Circle × Arc track.)

---

## Technologies Used

```
Circle Arc (Testnet, chain 5042002), USDC, EURC, Circle Nanopayments, Circle Gateway, Circle App Kit (swap, bridge, send, unified balances), Circle Modular Wallets (passkey MSCA, ERC-4337), Circle Developer-Controlled Wallets (DCW), Circle Smart Contract Platform (ERC-1155 template + Gas Station for trip-collectible NFTs), Circle Webhooks + Event Monitors, x402 (HTTP-native agentic payments), ERC-8183 (agentic job escrow), ERC-8004 (agent identity + reputation), Solidity (Foundry), viem, Ponder (Postgres + GraphQL indexer), Next.js 16 (App Router), React 19, TypeScript, Bun, Vercel Workflows, Vercel Fluid Compute, Vercel AI Gateway, Google Gemini 3 (Flash + Pro), Vertex AI Zero Data Retention, Model Context Protocol (MCP), AI SDK, Clerk (auth + Billing + native API keys), Prisma + Postgres (Neon), Upstash Redis, Duffel (flights + stays), Sherpa Requirements API v3, Google Maps Platform (Places, Weather, Air Quality, Geocoding, Address Validation, Time Zone, Elevation, Routes), Resend, WhatsApp Business, Slack, pgcrypto AES-256, HKDF-SHA256
```

---

## Did you use Circle products?

```
Yes
```

---

## Circle Developer Console account email

```
tomas.cordero.esp@gmail.com
```

(Confirm this matches the email on your Circle Developer Console account before submitting — swap if your Console is registered under a different one.)

---

## Circle Product Feedback

> **Full version with code-level repro, root causes, and one-line fixes lives at [`docs/feedback/submission-feedback.md`](./docs/feedback/submission-feedback.md) in the repo. Pasting the condensed form here so the field stays scannable; the linked doc is the artifact for the Product Feedback Incentive review.**

```
Full detailed feedback (with file paths, stack traces, root-cause analyses, and one-line fix suggestions for each issue) lives at:

→ https://github.com/tcxcx/sendero/blob/main/docs/feedback/submission-feedback.md

Condensed for this field:

PRODUCTS USED
• Circle Arc (Testnet, chain 5042002) — primary settlement L2, USDC as native gas.
• USDC + EURC — both as first-class settlement assets, mixed payouts per booking.
• Circle Nanopayments (@circle-fin/x402-batching) — x402-gated MCP tool API. Buyers sign EIP-3009 off-chain, Gateway batches settlement.
• Circle Gateway (gateway-api-testnet.circle.com) — unified treasury balance across 7 testnets, sub-500ms burn+mint into Arc, nanopayment settlement layer.
• Circle App Kit (@circle-fin/app-kit v1.3) — swap (USDC↔EURC), CCTP bridge, send, unified balances on Arc.
• Circle Modular Wallets (@circle-fin/modular-wallets-core) — passkey MSCA, ERC-4337 + WebAuthn. Used for travelers AND guest-escrow claim flow.
• Circle Developer-Controlled Wallets (@circle-fin/developer-controlled-wallets) — treasury faucet drip, DCW createTransaction for USDC transfers.
• Circle Smart Contract Platform (SCP) — pre-audited ERC-1155 template + Gas Station for SenderoStamps trip-collectible NFTs. Gas paid in fiat, not treasury USDC.
• Circle Webhooks + Event Monitors — for SenderoGuestEscrow + SenderoStamps event indexing into the app DB.
• Circle Adapter — viem v2 (@circle-fin/adapter-viem-v2) — App Kit signer bound to a viem EOA after the Circle Wallets adapter incompatibility (see Challenges).
• ERC-8183 (agentic job escrow) + ERC-8004 (agent identity + reputation) — agent NFT #2286 on Arc, on-chain rep score after each settled trip.

USE CASE
Travel is the perfect fit for Arc + USDC. We need sub-6s finality, atomic multi-leg settlement (vendor + agency commission + Sendero fee + reputation tip in one userOp), and stablecoin rails that work for both human travelers and AI agents. Card rails cannot do atomic multi-leg payouts; traditional T&E reconciles after the fact. We chose Arc + Nanopayments so per-trip and per-tool spend match on-chain escrow state in real time. Modular Wallets via passkey were essential for the guest-pass product — non-employee travelers (candidates, contractors, event guests, the Ramp/Juno wedge) had to claim a prefunded trip without a long-lived account. The first claim IS the enrollment.

SUCCESSES
• Modular Wallets passkey UX is excellent. WebAuthn registration → MSCA on Arc → gasless via Gas Station. Users see "sign in", not "connect wallet". Deterministic address from the passkey across sessions — verified by re-logging in and getting the same MSCA. Critical for onboarding.
• Circle Gateway batching is the unsung hero. Eliminating per-payment gas is what makes per-tool x402 metering economically viable. Without it, nanopayments are a slogan; with it, they are real. Margin panel in our demo: ~600× cost delta vs Ethereum L1 for a 54-tool-call workflow.
• Arc Testnet (domain 26) deposit UX is exactly as promised — approve + deposit, balance shows up in unified API in ~1s. POST /v1/transfer attested + minted in ~500ms in our tests. Cleanest cross-chain UX I've shipped on.
• EURC alongside USDC matters more than the docs let on — LATAM and EU agencies cared immediately.
• App Kit typed SwapParams / SendParams / BridgeParams catch schema bugs at compile. Swap on Arc fires in one kit.swap() call once the adapter is correct.
• SCP ERC-1155 template + Gas Station let us deploy trip-collectible NFTs in four scripts and a webhook registration, no audit lift. Auto-routes through Gas Station so gas is paid in fiat.
• @circle-fin/x402-batching@2.1.0 exports both buyer (GatewayClient, BatchEvmScheme) and seller (BatchFacilitatorClient, GatewayEvmScheme) surfaces from a single install. Clean.
• Webhook signature verification (ECDSA SHA256 with the Circle pubkey) was clean to implement; the timestamp-freshness window made replay protection trivial.
• ERC-8004 + ERC-8183 live on Arc gas to write a reputation attestation is ~10¢-equivalent in USDC — viable for per-trip reputation even at hackathon scale.

CHALLENGES (full repro + root cause in the linked doc)
1. App Kit Circle Wallets adapter incompatible with Swap Kit on Arc. createCircleWalletsAdapter (DCW-backed) + kit.swap() throws "Unsupported transaction params: gas, gasPrice...". Root cause: @circle-fin/usdckit transport rejects these on eth_call; Swap Kit's viem simulation always passes them. Workaround: switched to createViemAdapterFromPrivateKey on Arc RPC.
2. App Kit SendParams address enforcement drift. prepareSend in @circle-fin/app-kit@1.3.0 unconditionally calls fromAdapter.getAddress(fromChain) even when from.address is supplied. Throws on dev-controlled adapters. Workaround: rewired /api/send through DCW createTransaction directly.
3. Arc Testnet USDC reports decimals: 18 in some balance responses but amount strings are human-readable ("5" = 5 USDC). We had to normalize to micro-USDC on ingest.
4. Circle Event Monitors fire to ALL webhook URLs registered project-wide. Preview/dev environments cross-fire test events into prod handlers unless carefully scoped. We landed on env-tagged webhook paths (/api/webhooks/circle/events) and per-env registrations.
5. Arc Bundler enforces a 1 gwei minimum priority-fee floor — initial sendUserOperation calls failed with "maxPriorityFeePerGas is X but must be at least 1000000000". Found by trial and error. Cost ~2h of debugging.
6. Nanopayments + MSCA: EIP-3009 signing path is the EOA standard. MSCA would need EIP-1271 contract-signature verification on the facilitator side. Docs do not say whether BatchFacilitatorClient accepts EIP-1271 from smart accounts. Read of SDK source suggests no.
7. mcp-use@1.24.1 (great package for MCP+widgets) requires Zod 4. Our stack is pinned to Zod 3.25.x by viem 2.48 + every @circle-fin/* adapter. Hard-blocked adoption; we reverted to a hand-rolled Hono JSON-RPC MCP.
8. SCP TokenERC1155 mintTo signature: tokenId == type(uint256).max for auto-increment OR an existing tokenId. Custom keccak tokenIds silently fail. Worth a callout in the SCP template README.
9. Testnet USDC faucet drips at 20 USDC/request — for high-frequency nanopayment testing we hit the rate limit before a realistic demo. A queue-backed dev faucet would unblock this.
10. Base Sepolia deposit time of 13–19 min in the deposit table is unusable for hackathons — we had to deposit exclusively through Arc Testnet (~0.5s). Bridge Kit from Sepolia adds friction.

RECOMMENDATIONS
A. One-page "Arc + App Kit + DCW gotchas" covering issues 1, 2, 5 — would save every new builder a full day.
B. Decimals-normalizer helper in the Circle TS SDK that always returns micro-USDC regardless of upstream representation. Most common bug surface.
C. Per-environment Circle webhook subscriptions — explicit production/preview/development scoping at the Console level, not just at the app.
D. Document "Nanopayments with smart accounts (MSCA)" status clearly. Even if the answer is "not yet", say so. Extending BatchFacilitatorClient.verify to accept EIP-1271 unlocks the natural "passkey wallet pays per MCP tool call" UX.
E. Hono-compatible middleware for createGatewayMiddleware. Most edge-native stacks (Vercel Edge, Cloudflare Workers, Deno Deploy) use Hono. Express is the minority.
F. Canonical Circle Arc MCP server reference implementation: "expose your Circle API as MCP tools with x402 gating". We built this for Sendero — a reference would accelerate everyone else.
G. Zod version compatibility matrix across @circle-fin/* packages.
H. Batched-settlement observability in the Developer Console — let sellers see "the batch your 50 nanopayments ended up in", not just individual transfers.
I. SCP "guest-escrow with Peanut-style claim links + travel state machine" template in the catalog — would let other vertical-AI teams clone the pattern.
J. Built-in canary / rolling-release primitive for SCP contract upgrades, mirroring what Vercel ships for the web tier.

COLLABORATION ASK — the SaaS + nanopayments template
Sendero is the FIRST vertical AI agent we are shipping on this stack, not the last. The plumbing under it generalizes — and we would like to build the template WITH Circle rather than fork it alone. Full write-up in the linked doc; condensed here:

What the template already is (battle-tested in this repo):
• Two revenue legs from one codebase. Clerk Billing for MRR (Free/Basic/Pro/Enterprise, no-card 14-day trial, org-scoped). Circle Nanopayments for per-tool x402. Independent — a trialing user pays $0 SaaS but is still earning us nanopayment margin. SaaS pays for the platform; nanopayments pay for the calls.
• Robust auth + crypto-wallet login in one identity. Clerk handles email/SSO/SAML/passkey for the human side; Circle Modular Wallets handles passkey-backed MSCA for the on-chain side. One passkey, both worlds — clerkUserId ↔ mscaAddress mapped on User.metadata.
• Plan-tier limits enforce on Circle surfaces, not just Clerk features. Production API key count, monthly spend cap ceiling, nanopayment discount basis points — all in code keyed on tier. The apiKey.created Clerk webhook revokes keys that bust the plan limit. The agent dispatch path materializes the discount into MeterEvent.priceMicroUsdc.
• Scoped + signed dispatch. Production keys mint with read-mostly default scopes; settlement/treasury keys require HMAC + nonce dedup; every response carries a signed envelope (trace id + meter id + sig).
• Encrypted, durable workflows via Vercel Workflows + Fluid Compute. Multi-step agent runs survive crashes, redeploys, 24h supplier waits. LLM never sees plaintext PII.
• Complete agent surface: OpenAPI 3.1, MCP server, x402-gated /tools/:name HTTP, llms.txt on every origin, per-page docs-as-markdown, self-serve API key minting via Clerk's native UI.

What we want to ship next, with Circle, as a public template:
A Next-Forge-style starter (next-circle-saas) shipping with: Clerk Billing tiers + plan-gated production API keys + Circle Modular Wallets passkey enrollment wired to Clerk identity + DCW treasury per Clerk org via webhook + App Kit (swap/bridge/send/unified balances) embedded + x402 + Nanopayments + Gateway middleware on a sample MCP server + SCP ERC-1155 + Gas Station deployment scripts + env-tagged Webhook + Event Monitor handlers + Vercel Workflows runtime + llms.txt + OpenAPI + docs-as-markdown out of the box.

This is the missing on-ramp for every founder asking "how do I monetize my AI agent both as SaaS AND per-call without picking sides?". The answer in 2026 is Clerk Billing × Circle Nanopayments, and the recipe should be one `bun create`.

Why this matters strategically — Sendero / Bufi axis:
• Sendero is one VERTICAL AI agent on this template. We intend to ship many more (legal, healthcare, real estate, etc), each a wedge into a specific industry sharing the same auth + wallet + nanopayment + escrow plumbing.
• Bufi (horizontal SaaS underneath) provides on/off ramps + lightweight ERP — KYC, fiat in/out, accounting exports, compliance reporting, treasury management. Every business needs it.
• Vertical AI agents are the adoption funnel for the horizontal stack. A traveler signs up for Sendero → their org gets a Circle MSCA + USDC treasury → they discover Bufi's on/off ramp + ERP → they start running broader ops on Circle rails. The vertical pulls users in; the horizontal keeps them.
• YC's "vertical AI agents > SaaS" thesis with one extra move: the verticals SHARE INFRASTRUCTURE rather than each rebuilding their own. Circle is the natural settlement + identity layer for that infrastructure.

The ask: if Circle is interested in seeding the "vertical AI agent on Arc" category beyond hackathon demos, the highest-leverage move is to co-build the SaaS-on-Circle starter template above and put it in the official docs alongside the per-product quickstarts. We've already paid the integration cost across every surface (Clerk Billing, MSCA passkey, DCW, App Kit, Nanopayments, Gateway, SCP, Webhooks, x402). We can extract the template, harden the gotchas surfaced in this doc, and co-maintain it. Happy to chat — tomas.cordero.esp@gmail.com / @criptopoeta on X.

Overall: Arc + Circle is the only stack where this product was buildable by one person in a hackathon timeframe. The combination of MSCA passkeys, USDC-as-gas, Gateway batching, Nanopayments-as-x402-rail, App Kit (swap/bridge/send/unified balances), DCW for treasury, SCP ERC-1155 + Gas Station for NFTs, Webhooks + Event Monitors for indexing, AND Clerk Billing for the SaaS leg is what makes "vertical AI agent paid per tool call, settled on-chain" feel like a real business model and not a demo. Keep going on the agentic-economy thesis — it is working, and we want to help template it.
```

---

## Opt-in for Circle Developer communication

```
Yes (recommended — useful for product updates + further support)
```

---

## Submission Video Post (X/Twitter)

Workflow:

1. Record the demo video (60–90s suggested).
2. Post it on X tagging **all three**: `@buildoncircle` `@arc` `@lablabai`.
3. Paste the post URL into the form field.

**Suggested post copy:**

```
Sendero — vertical AI for travel ops, settled on-chain.

→ Agents quote, book, reconcile flights / hotels / ground legs
→ USDC + EURC settlement on @arc, sub-6s finality
→ x402 nanopayments meter every tool call, batched via Circle Gateway
→ Guest-escrow contract on Arc Testnet, ERC-8183 + ERC-8004 alongside
→ Trip-collectible NFTs via Circle SCP (ERC-1155 + Gas Station)
→ App Kit swap / bridge / send / unified balances in-app
→ MCP + llms.txt — other agents can book through us by spec

Hackathon submission for @buildoncircle × @lablabai's Agentic Economy on Arc.

[video]
```

---

## Pre-submit checklist

- [ ] Record + post demo video on X with all three @-mentions.
- [ ] Confirm Circle Developer Console email matches the account that owns the Arc Testnet API keys.
- [ ] Pick the exact track + category labels from the form's dropdowns (above are the natural fits, but use whatever the form lists verbatim).
- [ ] Decide ONLINE vs ONSITE (assumed ONLINE; flip if attended).
- [ ] Confirm the GitHub URL in the feedback is correct (`github.com/tcxcx/sendero`) — adjust if the repo is at a different path.
- [ ] Make `docs/feedback/submission-feedback.md` reachable to judges (public repo, or paste the doc into a gist + update the link).

---

## Source documents

- Full Circle product feedback (the artifact for the $500 incentive): [`docs/feedback/submission-feedback.md`](./docs/feedback/submission-feedback.md)
- Repo README (full architecture + business model + on-chain proof): [`README.md`](./README.md)
- Contract source + lifecycle: [`contracts/SenderoGuestEscrow.sol`](./contracts/src/SenderoGuestEscrow.sol), [`contracts/README.md`](./contracts/README.md)
- Deployed proxy on Arc Testnet (chain 5042002, verified): [`0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515`](https://testnet.arcscan.app/address/0x640e15B2B7cBa421c93dA1514f8E6Ba3e11f8515)
