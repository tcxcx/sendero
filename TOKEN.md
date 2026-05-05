# TOKEN.md — $SENDR Tokenomics

Internal design doc. Pre-launch. Subject to legal review before any public commitment. Last touched 2026-05-05.

> **Status: SHELVED.** Founder has explicitly chosen B2B SaaS as the primary GTM. This doc remains as a design artifact — the spec is sound, the math doesn't favor the founder. See §16 for the decision log. The §3 identity-only path (Metaplex Agent Registry, no token launch) is still viable as ~$50 optionality and is not shelved.

## 0. TL;DR

Sendero is the autonomous travel agent. $SENDR funds its operations, captures its revenue, and aligns tenants + travelers + holders around a verifiable on-chain identity that already exists on two chains.

- **Identity:** ERC-8004 (Arc, live) + Metaplex Agent Registry (Solana, to register). Permanently bound via `set-agent-token`.
- **Launch vehicle:** Metaplex Genesis bonding curve. 1B fixed supply, 100% on curve, no pre-mine.
- **Revenue → token:** SaaS MRR + nanopay margin + booking take-rate → quarterly buyback-burn into the bonding-curve→Raydium pool.
- **Utility:** stake for nanopay/take-rate discounts, traveler loyalty rewards, premium MCP scope gas, governance over supplier-rate negotiation.
- **Operational rail:** Circle USDC PDA → corporate card (Stripe Issuing or Circle Visa) → Duffel + Faye + AI providers. No off-ramp gymnastics.

## 1. Why a token at all

Three things only a token can do for Sendero, given what's already shipped:

1. **Capital layer** above the existing Circle/Arc ops layer. We have rails (USDC, ERC-8004, metered nanopay, Langfuse, MCP, channel-render). We don't have a way for the agent to be *invested in*. A token is that layer.
2. **Three-sided alignment** that SaaS pricing alone can't reach: tenants get plan discounts via stake, travelers earn rewards per booking, holders capture treasury growth. One asset, three flywheels.
3. **Defensible identity story** — the agent has a permanent, verifiable, dual-chain identity bound to a token that cannot be swapped out. Generic launchpads have none of this.

What a token does *not* solve: product-market fit, supplier negotiation, regulatory posture. Those remain hard. Token amplifies whatever the underlying business does — good or bad.

## 2. Token specs ($SENDR)

| Field | Value |
|---|---|
| Symbol | `SENDR` |
| Name | Sendero |
| Chain | Solana mainnet |
| Standard | SPL via Metaplex Genesis |
| Total supply | 1,000,000,000 (fixed; mint authority revoked post-launch) |
| Decimals | 9 |
| Launch type | Genesis bonding curve (constant-product AMM) |
| Pre-mine | **None.** All 1B starts on curve. |
| Graduation | Auto-migrates to Raydium CPMM at 100% sell-out |
| Creator fee | 2% of every swap, pre- and post-graduation |
| Token-agent binding | Irreversible via `--agentSetToken` |

Rationale for pure bonding curve over launchpool:

- Aligns with the "agent raises funds for itself" thesis. No pre-mine = no team-vs-public optics.
- Team comp comes from creator fees over time, which only flow if the curve trades, which only happens if the agent works. Pure performance pay.
- Instant trading. No 48h deposit window. Easier to coordinate launch with mainnet flip.

Launchpool is documented in §11 as the alternative if legal recommends explicit team vesting.

## 3. Identity stack — dual-chain

Sendero's agent identity is already live on Arc (ERC-8004). Token launch adds the Solana side.

| Layer | Chain | Status | Purpose |
|---|---|---|---|
| ERC-8004 agent registry | Arc | Live | EVM-side verifiable identity, attestation, reputation |
| Metaplex Agent Registry | Solana | **To register** | Solana-side identity + Asset Signer PDA wallet |
| Token-agent binding | Solana | **At launch** | Permanent `setAgentTokenV1` link from agent → $SENDR |
| Cross-chain attestation | Both | **At launch** | Signed message from Arc identity asserting control of Solana PDA, posted to `/docs/agent-identity` |

Solana side, in order:

1. `mplx agents register --name "Sendero" --description "Autonomous travel ops agent" --image ./brand/sendero-mark.png`
2. `mplx agents executive register` (one-time, on executive wallet)
3. `mplx agents executive delegate <ASSET> --executive <EXECUTIVE_WALLET>`
4. `mplx agents fetch <ASSET>` to verify and capture the Asset Signer PDA wallet address
5. Cross-chain attestation: sign payload `{ erc8004: <arc-agent-id>, solana: <core-asset>, ts }` from both wallets, publish to `/docs/agent-identity` + Arweave

The Asset Signer PDA from step 4 becomes the agent's Solana treasury — destination for creator fees, source for any Solana-side ops payments. **No private key exists.** Only the executive can act on its behalf via Core's Execute hook.

## 4. Distribution

Pure bonding curve. There is no allocation table because there is no pre-mine. Every $SENDR enters circulation by being bought from the curve.

**What about the team / treasury / ecosystem?** They earn from creator fees, not from supply. See §6.

## 5. Utility — what $SENDR is *for*

Utility-first design is non-negotiable for legal posture (§9). $SENDR must do things, not just speculate.

### 5.1 Stake → discount (tenants)

Stake $SENDR (escrow contract on Solana, mirrored to tenant record) to unlock multiplied versions of existing plan discounts:

| Plan | Base nanopay discount | Staked nanopay discount | Base take-rate | Staked take-rate |
|---|---|---|---|---|
| Free | 0% | n/a (free tier no stake) | 0% | n/a |
| Basic | 15% | 22% (stake ≥ 5k $SENDR) | 5% | 4% |
| Pro | 30% | 45% (stake ≥ 25k $SENDR) | 10% | 7% |
| Enterprise | 50% | 65% (stake ≥ 250k $SENDR) | 15% | 11% |

Stake is locked 90 days minimum. Slash-free; redemption = unstake then withdraw. No yield from staking itself — discount *is* the yield.

Resolver lives in `apps/app/lib/billing-plan.ts`; new function `getStakedTier(orgId)` reads from on-chain escrow + cache. Wired into existing `buildPlanOverrides()` so the dispatch hot path picks up staked discount with no other changes.

### 5.2 Traveler loyalty (earn)

Per booking confirmation, traveler earns $SENDR proportional to take-rate captured:

```
sendr_earned = booking_take_rate_usd * 0.20 / sendr_spot_usd
```

(20% of take-rate denominated back in $SENDR at spot.) Funded from ops treasury, not from supply. Redeemable for ancillaries — eSIM data, insurance riders, lounge access — at a 10% discount vs USDC. Drives base demand for $SENDR independent of speculation.

### 5.3 Premium MCP scope gas

Privileged tool scopes (`settlement`, `treasury`, signed-request scopes from `packages/auth/src/dispatch-auth.ts`) cost more nanopay. Holders can pay that uplift in $SENDR at a 25% discount vs USDC equivalent. Burned on use — direct deflationary sink tied to actual product usage.

### 5.4 Governance — supplier negotiation

Per the wedge findings in `BUILD_VERTICAL_AI_AGENT.md`, the moat is corporate-rate aggregation. Holders vote (1 token = 1 vote, snapshot) on:

- Which routes/hotels to negotiate corporate rates against next quarter
- How to split treasury between supplier-rate prepay vs buyback-burn
- Insurance fund deployments above $50k
- Adding new utility sinks

Governance starts advisory (multisig executes) and transitions to binding when treasury > $5M and 12 months operating history are established.

## 6. Treasury & revenue loops

Two distinct money flows, both feeding the same outcome.

### 6.1 Creator-fee flow (curve trading)

Every bonding-curve swap pays 2% creator fee. Pre-graduation it accrues in the curve's bucket; post-graduation it accrues from the Raydium CPMM pool. Both go to a single creator wallet.

That wallet is a **3-of-5 multisig** (Squads on Solana). Signers: 2 founders, 1 outside auditor, 2 community-elected at month 6. Multisig disburses on a quarterly schedule:

| Bucket | % of creator fees | Purpose |
|---|---|---|
| Ops runway | 40% | Compute, Vercel, Anthropic/OpenAI, Langfuse, Duffel float |
| Supplier liquidity | 25% | Corporate-rate prepay (the moat) |
| Buyback-burn | 20% | Market-buy $SENDR from Raydium, send to burn address |
| Tenant grants | 10% | Free credits for design partners, free-tier expansions |
| Insurance fund | 5% | Booking refund/dispute backstop, audit-required reserve |

Team comp is a line item *inside* the Ops bucket — capped at 30% of that bucket per quarter. No separate team allocation, no vesting cliff games.

### 6.2 Revenue-fee flow (product)

Sendero's existing revenue (SaaS MRR, nanopay margin, booking take-rate per `packages/billing/src/plans.ts`) is denominated in USDC + fiat and lives in the corporate treasury. Each quarter, **15% of net revenue** goes to buyback-burn, executed as a TWAP over 30 days into the Raydium pool.

This is the load-bearing flywheel: more product usage → more revenue → more burn → tighter supply → stronger floor for stake/loyalty utility.

### 6.3 Sample steady-state (illustrative)

At $5M ARR, $20M FDV, $2M curve volume/month:

```
Creator fees:   $2M * 2% * 12 = $480k/yr
  → $96k buyback-burn, $192k ops (caps team at $58k of that), etc.

Revenue burn:   $5M * 15% = $750k/yr buyback-burn

Total annual burn: ~$846k against ~5% of FDV → ~4.2% supply pressure/yr
```

Not promised. Not modeled. Illustrative only — to show the loop has the right shape.

## 7. Operational rail — card via MoonPay

The agent needs to actually *spend money*. MoonPay's CLI is the agent-native rail: one CLI, MCP-callable, USDC-funded end-to-end, no fiat off-ramp middleware in the loop. Replaces the earlier Stripe Issuing + Bridge.xyz proposal — fewer dependencies, fewer hops, MCP-discoverable for the agent itself.

### 7.1 Why MoonPay over alternatives

| Path | How it works | Pros | Cons |
|---|---|---|---|
| **A. MoonPay card** (chosen) | `mp card create` issues a Visa virtual card linked to a MoonPay-custodied USDC wallet. Agent calls `mp` via MCP. Spends auto-convert USDC → USD at swipe. | Single CLI/MCP surface the agent can call directly, USDC-native, delegation tokens for per-tx auth, instant freeze/unfreeze | MoonPay custodies the funding wallet; KYB lives at MoonPay |
| **B. Circle Mint off-ramp** | USDC → Circle Mint → ACH → Duffel prepaid balance | Lower per-tx fees on >$10k tickets, fully on-chain accounting | Slow (ACH 1–2d), batched not per-booking, only works for merchants accepting bank transfer |
| **C. Direct USDC** | Pay providers in USDC | Pure on-chain | Duffel, Faye, Anthropic, OpenAI don't accept USDC. Non-starter. |
| ~~Stripe Issuing + Bridge.xyz~~ | Replaced by MoonPay — one fewer dependency, MCP-native, no fiat-bridge middleware to babysit |

**Decision:** A as primary, B as batch fallback for >$10k tickets, C closed off until providers add stablecoin acceptance.

### 7.2 MoonPay setup playbook

One-time, run from the executive's machine. Sendero Labs Inc. is the entity (legal posture in §9 unchanged — agent operates the card, Sendero Labs holds it).

```bash
# Install + auth
npm i -g @moonpay/cli
mp login --email ops@sendero.network
mp verify --email ops@sendero.network --code <CODE>

# KYB onboarding for card-issuing
mp card onboarding start
mp card onboarding check       # poll until 'approved'
mp card onboarding finish

# Funding wallet (USDC on Solana)
mp wallet create --name sendero-card-funding
WALLET_ID=$(mp wallet list --json | jq -r '.[] | select(.name=="sendero-card-funding") | .id')

# Issue card + link funding
mp card create
mp card wallet link --wallet-id $WALLET_ID
mp card retrieve --json | tee ./out/card.json
```

Expose to the agent via MCP so dispatch loops can call card tools as first-class tool invocations:

```bash
claude mcp add moonpay -- mp mcp
```

Tool surface available to the agent post-MCP-mount: `card_create`, `card_freeze`, `card_unfreeze`, `card_retrieve`, `card_transaction_list`, `card_delegation_approve_transaction_build`, `card_delegation_token_retrieve`, `card_delegation_revoke_transaction_build`, `card_wallet_link`, plus the wallet/token surface for top-ups. These MUST map to the `treasury` privileged scope in `packages/auth/src/dispatch-auth.ts` so `scopesRequireSignature()` enforces HMAC signing on every card spend the same way it does for on-chain settlement.

### 7.3 Provider payment matrix — two rails, not one

**Duffel does NOT accept ongoing credit-card top-ups.** First top-up at onboarding can be card; every top-up after that is bank transfer only (Duffel cites card processing cost). There is also no per-order card payment for the seller — orders draw from Balance. This forces a two-rail design:

| Provider | Accepts card ongoing? | Rail |
|---|---|---|
| Duffel (Balance top-up) | **No** (onboarding only) | Bank transfer (rail B) |
| Duffel (Duffel Payments) | Customer card pass-through | Customer pays Duffel direct; Sendero takes spread separately |
| Faye (insurance) | Yes | MoonPay card (rail A) |
| Anthropic | Yes | MoonPay card (rail A) |
| OpenAI | Yes | MoonPay card (rail A) |
| Vercel / Langfuse / Resend / Trigger.dev | Yes | MoonPay card (rail A) |
| Stripe / Clerk / Upstash / Neon | Yes | MoonPay card (rail A) |

### 7.4 Rail A — MoonPay card (SaaS providers)

```
Agent PDA (Solana, no private key)
       │ Core Execute via executive (signed)
       ▼
Sendero Labs USDC wallet (Solana, regular keypair, 2-of-3 ops multisig)
       │ MoonPay deposit (scheduled top-up — daily for working capital)
       ▼
MoonPay funding wallet (custodial, name: sendero-card-funding)
       │ swipe-time auto-conversion USDC → USD
       ▼
Visa rails → Anthropic / OpenAI / Faye / Vercel / etc.
```

Two-hop is required because PDAs have no private key — MoonPay needs a regular wallet to pull funding from. The PDA stays canonical agent treasury; the MoonPay wallet is the *spending account* topped up on schedule.

Working-capital target on the MoonPay wallet: ~7 days of forecast spend. Larger balances stay in the PDA or the Sendero Labs USDC wallet — limits blast radius of MoonPay-side compromise.

### 7.5 Rail B — Bank transfer (Duffel Balance)

Duffel Balance funds via ACH/wire only. We need a USDC → bank rail. MoonPay's virtual-account product is the agent-native fit (single CLI), Circle Mint is the audit-clean fit (1:1 redemption). Both work.

```
Agent PDA / Sendero Labs USDC wallet
       │ off-ramp (Rail B variant)
       ▼
USD bank account (Sendero Labs Inc., business banking)
       │ ACH/wire to Duffel
       ▼
Duffel Balance
       │ booking-time draw
       ▼
Airline GDS settlement
```

**MoonPay virtual-account variant:**

```bash
# One-time KYB + bank registration for the entity
mp virtual-account agreement list
mp virtual-account agreement accept --agreement-id <ID>
mp virtual-account create
mp virtual-account bank-account register --account-name "Sendero Labs Inc." \
  --account-number <ACCT> --routing-number <ROUTE>

# Per top-up: USDC → USD bank
mp virtual-account offramp create --amount 50000 --currency USDC --target-bank-id <BANK_ID>
mp virtual-account offramp initiate --offramp-id <ID>

# Then schedule ACH/wire from bank → Duffel via dashboard
```

**Circle Mint variant** (already wired in `packages/circle/`): scheduled USDC → ACH → Duffel. Lower per-tx fees on >$10k tickets, slower (1–2d settlement).

**Top-up cadence:** weekly forecast based on rolling 7d Duffel volume × 1.5, executed Friday for Monday settlement. Low-balance auto-trigger at <2 days runway. Both implemented as a Trigger.dev cron (`packages/tools` already has the off-ramp primitives).

### 7.6 Pass-through alternative — Duffel Payments

Cleanest variant for any booking where the *traveler* is the payer (B2C-flavored TMC use cases): customer card → Duffel Payments → airline. Sendero never holds Duffel float.

- **Pro:** zero balance management, zero off-ramp scheduling, zero pre-funded float risk.
- **Pro:** Duffel handles PCI scope; Sendero stays out of card data.
- **Con:** doesn't apply to corporate/agent-paid bookings (where Sendero is the buyer of record). Those still need Rail B.
- **Con:** Sendero's take-rate accrues outside the Duffel transaction — needs separate billing/invoicing flow on top.

Recommended split: Duffel Payments pass-through for traveler-paid bookings, Rail B (bank top-up) for corporate-paid bookings.

### 7.4 Per-trip authorization via delegation tokens

MoonPay card delegation lets the agent build scoped spend authorizations *before* swiping. This is the per-trip blast-radius control we previously needed Stripe authorization webhooks for.

```bash
# Pre-booking: build delegation approving exactly this trip's expected spend
mp card delegation approve-transaction-build \
  --amount 1850.00 \
  --currency USD \
  --merchant-category travel \
  --reference "trip_${TRIP_ID}" \
  --json

# Agent retrieves token, attaches to booking workflow
TOKEN=$(mp card delegation token retrieve --reference "trip_${TRIP_ID}" --json | jq -r .token)

# Booking proceeds. Charge swipes against approved token only.

# Post-booking, revoke remaining authorization
mp card delegation revoke-transaction-build --reference "trip_${TRIP_ID}"
```

Wired into `apps/app/workflows/lifecycle/` so each `Trip` owns its delegation tokens. New workflow step writes `delegationToken` + `referenceId` to `Trip.events` jsonb on creation; cleanup step revokes after settlement (or on workflow failure). If the agent gets prompt-injected into an off-trip charge attempt, no token exists → MoonPay declines.

### 7.5 Reconciliation + audit

```bash
mp card transaction list --since "2026-01-01" --json
```

Mirrors to:
- New `MoonPayCardTxn` table modeled on the `WhatsAppApiLog` pattern (per-call observability: status, duration_ms, errorMessage, raw envelope reference).
- `Trip.events` jsonb append for charge ↔ booking reconciliation. Atomic update using the same `||` jsonb append pattern as `handleTripNoteSubmission` to stay concurrent-safe.
- Quarterly creator-fee multisig review (§6.1) reads the rolled-up summary.

### 7.6 Kill switch

```bash
mp card freeze       # immediate, no card activity until unfreeze
mp card unfreeze
```

Auto-trip conditions, all wired to `mp card freeze` via the agent dispatch worker:
- Anomaly detection on `card_transaction_list`: spend spike >3× rolling 7d mean, off-MCC merchant, off-region geo.
- HMAC signing failures on `treasury`-scoped tool calls: >3 in 1h via `dispatch-auth.ts` (signals agent compromise).
- Manual emergency button in `/dashboard/treasury` (Sendero Labs ops role only — never tenant-accessible).

Ops manually unfreezes after triage. No auto-unfreeze.

### 7.7 Trade-offs we accept

- **Custodial funding wallet at MoonPay.** Counterparty risk on the working-capital wallet only — caps blast radius via §7.3 top-up sizing.
- **MoonPay-side KYB.** Sendero Labs Inc. has to pass MoonPay's onboarding. Same KYB lift as Stripe Issuing; one less integration than Stripe + Bridge.xyz combined.
- **Single Visa BIN.** Per-supplier virtual cards (the Stripe Issuing benefit) are not native here — we get one card per agent. Per-trip *authorization tokens* substitute for per-trip *cards*. Functionally equivalent for our threat model (prompt injection, off-policy spend) but technically different surface.

## 8. Governance & treasury custody

| Body | Composition | Authority |
|---|---|---|
| Creator-fee multisig | 3-of-5 Squads multisig (2 founders, 1 auditor, 2 community at month 6) | Disburse creator fees per §6.1 schedule |
| Ops treasury | Sendero Labs Inc. corporate accounts | Day-to-day spending, payroll, supplier prepay |
| Insurance fund | 2-of-3 Squads multisig + on-chain claim contract | Refund disputes, audit-required reserve |
| Token holder vote | Snapshot, 1 $SENDR = 1 vote, 7-day window, 5% quorum | Advisory through Y1; binding once treasury > $5M and 12mo operating |

No DAO from launch. DAO transitions are the most common point of failure for token-funded agent projects — operational tempo dies the day the multisig has to consult Snapshot for rent. We earn the DAO over time.

## 9. Legal posture (preliminary, gated on counsel)

### 9.1 Securities risk

Howey four-prong assessment:

1. Investment of money — yes, swaps are payments.
2. Common enterprise — arguably yes (creator fees from common pool).
3. Expectation of profits — **mitigated** by utility-first framing. Buybacks are discretionary, not promised. Marketing must never project token price.
4. From efforts of others — **mitigated** by progressive decentralization (multisig → DAO) and by the agent itself being the operator (not the team).

Posture: **utility token with optional governance**, marketed as a means to access discounts, loyalty, and gas. No revenue-share contract. No price promise. No private allocation to "investors". Counsel sign-off mandatory before any external sale.

### 9.2 Jurisdictional gates

- **US persons:** geo-block from primary launch interface; Raydium-side trading is permissionless (caveat emptor, standard secondary-market posture).
- **EU MiCA:** $SENDR likely classifies as a "utility token" under MiCA if utility goes live before sale. Stake-discount + loyalty + gas must be functional at launch, not promised. We can ship that.
- **UK FCA:** financial-promotion regime applies. Marketing copy gated through counsel.

### 9.3 Tax

- Creator fees received by multisig = ordinary income at receipt, denominated USD-equivalent at block timestamp.
- Buybacks = treasury treats $SENDR as inventory; basis = TWAP price at acquisition.
- Burn = disposal at zero proceeds.

### 9.4 Sanctions / AML

- Card-side: Stripe + KYB on Sendero Labs. No issue.
- Token-side: $SENDR cannot enforce sanctions (it's a permissionless SPL post-graduation). Sendero Labs' websites + frontends MUST geo-block + screen sanctioned addresses against OFAC list. The token contract itself is permissionless.

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SEC enforcement | Medium | Existential | Utility-first launch, no profit promises, counsel sign-off, US geo-block |
| Memecoin perception drags enterprise sales | Medium | Revenue | $SENDR optional, never required for core SaaS. Enterprise contracts in fiat/USDC only |
| Curve gets snipped at launch by bots | High | Reputational | Use `--firstBuyAmount` from agent PDA on launch tx itself (per Genesis docs, fee-free + atomic). Caps initial scalp. |
| Multisig key compromise | Low | Severe | Hardware wallets only, geographically distributed signers, monthly key-rotation drill |
| Agent's card gets compromised → supplier overcharge | Medium | Severe | Per-trip virtual cards via Stripe Issuing, authorization webhook validates against Trip row. Fail-closed default. |
| Buyback creates wash-sale optics | Medium | Tax/legal | TWAP execution over 30 days, public on-chain record, no insider front-run window |
| Bonding curve graduates too fast (no community) | Medium | Long-term liquidity | Cap initial buy via `--firstBuyAmount`. Watch curve fill rate; if >50% in 24h, pause marketing. |
| Bonding curve never graduates (no demand) | Low | Operational | Treasury still gets creator fees on every swap. No graduation = no Raydium LP, but trading continues on curve. |

## 11. Preconditions to launch

Hard gates. None of these are negotiable.

1. **Mainnet flip done.** Per `CLAUDE.md` mainnet cutover gating, distribution surfaces (CLI, plugin, skills) ship same release. Token launch is part of that release, not before.
2. **$100k+ tenant ARR across ≥5 paying TMCs.** No revenue = nothing for buyback-burn to do = pure speculation. Don't launch into a vacuum.
3. **Counsel sign-off** on §9 posture (US securities, MiCA, AML).
4. **Metaplex Agent Registry registration complete** on Solana mainnet, with executive delegation tested on devnet first.
5. **Cross-chain attestation published** at `/docs/agent-identity` linking ERC-8004 (Arc) ↔ Core asset (Solana).
6. **Stake-discount resolver shipped** in `apps/app/lib/billing-plan.ts` and tested. Utility must be live at launch, not promised.
7. **Creator-fee multisig deployed** on Squads with all 5 signers' keys verified.
8. **Insurance fund seeded** with $50k from corporate treasury before any holder funds at risk.
9. **Geo-block live** on the primary launch interface for US/sanctioned regions.
10. **Audit** of stake-escrow contract (one external firm, public report).

## 12. Launch playbook

Run on Solana mainnet, from the executive wallet, after all §11 gates pass.

### 12.1 Devnet rehearsal (run twice, on separate days)

```bash
mplx config set rpcUrl https://api.devnet.solana.com

# Fund executive wallet
mplx toolbox sol airdrop --amount 5

# 1. Register agent on devnet
mplx agents register --name "Sendero" \
  --description "Autonomous travel ops agent" \
  --image ./brand/sendero-mark.png \
  --services '[{"name":"MCP","endpoint":"https://sendero.network/api/mcp"}]' \
  --supported-trust '["reputation","crypto-economic"]' \
  --json

# Capture <ASSET> from output. Wait ~30s for Genesis API indexer (per docs).

# 2. Launch bonding curve token bound to agent
mplx genesis launch create --launchType bonding-curve \
  --name "Sendero" \
  --symbol "SENDR" \
  --image "https://gateway.irys.xyz/<UPLOADED_HASH>" \
  --agentMint <ASSET> \
  --agentSetToken \
  --firstBuyAmount 0.5 \
  --description "Token of the autonomous travel ops agent" \
  --website "https://sendero.network" \
  --twitter "https://twitter.com/senderonet" \
  --json

# 3. Verify
mplx agents fetch <ASSET>
mplx genesis swap <GENESIS> --info
```

Validate: agent has `wallet` (Asset Signer PDA), `token` field set, curve is `swappable: true`, first buy already executed against PDA.

### 12.2 Mainnet launch

Same commands, with `--network solana-mainnet` (auto-detected from configured RPC). Ordering is critical and irreversible at step 2.

```bash
# Pre-flight
mplx config get rpcUrl   # must be mainnet
mplx config get keypair  # must be executive
mplx toolbox sol balance # must be ≥ 1 SOL (covers register + launch + first buy)

# 1. Register agent on Solana mainnet
mplx agents register --name "Sendero" \
  --description "Autonomous travel ops agent. ERC-8004 on Arc. Solana Core asset on Solana." \
  --image ./brand/sendero-mark.png \
  --services '[
    {"name":"MCP","endpoint":"https://sendero.network/api/mcp"},
    {"name":"web","endpoint":"https://sendero.network"}
  ]' \
  --supported-trust '["reputation","crypto-economic"]' \
  --save-document ./out/sendero-agent-doc.json \
  --json | tee ./out/agent-register.json

# Capture ASSET, wait 30s
ASSET=$(jq -r .assetAddress ./out/agent-register.json)
sleep 30

# 2. Register executive profile (one-time per signer)
mplx agents executive register --json

# 3. Delegate execution to executive
mplx agents executive delegate $ASSET --executive <EXECUTIVE_WALLET> --json

# 4. Verify
mplx agents fetch $ASSET --json | tee ./out/agent-verify.json

# 5. Launch — IRREVERSIBLE on --agentSetToken
#    Image must be on Irys; upload first via:
#    mplx toolbox storage upload ./brand/sendero-mark.png
mplx genesis launch create --launchType bonding-curve \
  --name "Sendero" \
  --symbol "SENDR" \
  --image "<IRYS_URL>" \
  --agentMint $ASSET \
  --agentSetToken \
  --firstBuyAmount 1.0 \
  --description "Token of the Sendero travel ops agent" \
  --website "https://sendero.network" \
  --twitter "https://x.com/senderonet" \
  --json | tee ./out/launch.json

# 6. Verify token-agent binding is live
mplx agents fetch $ASSET --json
mplx genesis swap <GENESIS> --info --json
```

### 12.3 Post-launch

- Publish `/docs/agent-identity` with attestation + on-chain links.
- Announcement gates open in this order: (a) Discord/community → (b) Twitter → (c) marketing push. 24h between each. Avoids day-zero scalp.
- Monitor curve fill % via `mplx genesis swap <GENESIS> --info` cron every 5min for first 72h.
- First creator-fee distribution: T+30 days, by multisig vote.

## 13. Alternative: launchpool path

Document for completeness. Not the recommendation.

If counsel requires explicit team allocation with vesting (rather than creator-fee comp), use launchpool:

| Bucket | Allocation | Notes |
|---|---|---|
| Pool (public) | 600M | 48h deposit window, raise goal 2,000 SOL |
| Team locked | 200M | 4-year vest, 1-year cliff, monthly unlock thereafter (Streamflow via `--lockedAllocations`) |
| Ecosystem locked | 100M | 2-year vest, no cliff, weekly unlock |
| Insurance fund | 50M | Unlocked, claimable by 2-of-3 multisig |
| Raydium liquidity | 50M | `raydiumLiquidityBps: 5000` after pool closes |

Launch command:

```bash
mplx genesis launch create \
  --name "Sendero" --symbol "SENDR" \
  --image "<IRYS_URL>" \
  --tokenAllocation 600000000 \
  --depositStartTime "2026-XX-XXT00:00:00Z" \
  --raiseGoal 2000 \
  --raydiumLiquidityBps 5000 \
  --fundsRecipient <OPS_TREASURY> \
  --lockedAllocations ./out/locked-allocations.json \
  --agentMint $ASSET --agentSetToken
```

`./out/locked-allocations.json` per the Streamflow schema in the Metaplex Genesis CLI docs.

Trade-off: cleaner team comp, worse "agent raises funds for itself" optics, worse legal posture (explicit fundraising looks more like a security).

## 14. Open questions

These need decisions before launch.

1. ~~Card issuer~~: **Decided — MoonPay card via `mp` CLI + MCP (§7).** Replaces earlier Stripe Issuing + Bridge.xyz proposal.
2. **Stake-escrow contract:** ship our own or use a battle-tested one (Marinade-style, Tulip)? Default: ours, audited. Smaller surface area, simpler accounting.
3. **First buy size:** 0.5 SOL? 5 SOL? 50 SOL? Bigger first buy = stronger anti-scalp but worse optics ("team front-ran"). Probably 1–2 SOL.
4. **Geo-block scope:** US-only, or US + sanctioned + China + UK? Conservative is safer pre-revenue; expand post-counsel.
5. **Loyalty $SENDR funding:** treasury buys from market and gives to travelers, or creator-fee bucket pays directly? Former is cleaner on tax; latter is cheaper.
6. **Snapshot governance threshold:** 5% quorum of circulating, or of total supply? Total supply is harsher pre-graduation; circulating is too easy to whale.
7. **Insurance fund triggers:** booking refunds only, or also AI-judgment-error compensation (e.g., agent books wrong city)? Latter is much larger surface.

## 15. References

- `BUILD_VERTICAL_AI_AGENT.md` — wedge findings, "Stay for Network" thesis (a16z + YC RFS)
- `CLAUDE.md` — mainnet cutover gating, billing/pricing, Circle wallet authority
- `packages/billing/src/plans.ts` — plan tiers, take-rate, nanopay discount source of truth
- `apps/app/lib/billing-plan.ts` — resolver (extension point for stake-discount)
- `packages/auth/src/dispatch-auth.ts` — privileged-scope list (gas-burn target)
- Metaplex Genesis docs: https://metaplex.com/docs/smart-contracts/genesis
- Metaplex Agent Registry: https://metaplex.com/docs/agents
- ERC-8004 spec: https://eips.ethereum.org/EIPS/eip-8004
- MoonPay CLI (`mp`) — install: `npm i -g @moonpay/cli`. MCP mount: `claude mcp add moonpay -- mp mcp`. Card surface: `mp card --help`.

---

## 16. Decision log — why this is shelved

The doc above is correct as a spec. It is wrong as a plan *for this founder*. Captured here so the reasoning survives the next time someone (including future-self) opens TOKEN.md and asks "why didn't we just launch?"

### 16.1 $ upside, two paths

**B2B SaaS (preferred lifestyle)**

- $5M ARR × 20× revenue multiple × 30% founder ownership post-dilution = **~$30M exit**
- $300–400k/yr salary while operating
- Comps: Navan ~$9B, Concur, TripActions. Real exits, real multiples.
- People work: enterprise sales calls. That's it.

**Token (per this doc, best realistic case)**

- 2% creator fee × $200k/day curve volume (already a *successful* launch) = $1.4M/yr fees → 3-of-5 multisig → Ops bucket → after team + engineers + auditor + ecosystem split, founder personally nets **maybe $200–400k/yr**.
- Pure bonding curve = zero founder pre-mine = nothing to sell on market for upside.
- People work: Discord, AMAs, "wen pump", FUD threads, legal threats, governance forums, anonymous trader expectations management.
- Exit: there isn't one. The token *is* the exit, and the exit is illiquid because selling into your own order book = price collapse = community revolt.

Founder nets **less money for radically more people work.**

### 16.2 When the math flips (and why none apply)

The token is the right move only when one of these is true:

1. You can't raise VC. *Sendero can — travel-ops is a known category with public comps.*
2. The product is fundamentally permissionless. *Sendero isn't — founder controls the agent, rails, data, tenants.*
3. You have a co-founder who absorbs community work. *Doesn't exist.*
4. You're optimizing for narrative/PR over expected value. *Founder explicit: "I don't like people. Communities suck too."*

None apply. The token doesn't fit this founder.

### 16.3 What to do instead

**Shelve the launch. Keep the plumbing.**

The Circle USDC + Arc + ERC-8004 + Metaplex Agent Registry stack is already enough crypto-native credibility for the agent-identity story. Sell that to enterprise TMCs as differentiation ("verifiable agent, on-chain audit, autonomous treasury") without ever launching a tradeable asset.

**The identity is the moat. The token is just liquidity for it — and we don't need liquidity, we need ARR.**

### 16.4 Optionality without the work

Cheap insurance, ~$50 in fees, no public exposure:

```bash
mplx agents register --name "Sendero" \
  --description "Autonomous travel ops agent" \
  --image ./brand/sendero-mark.png
# captures Solana-side identity, mints Asset Signer PDA, no token launch
```

Then publish the ERC-8004 ↔ Solana attestation at `/docs/agent-identity` per §3. `setAgentTokenV1` stays unused. Pull the trigger years later — at acquisition, as a victory-lap launch where the founder has zero operational stake — or never.

### 16.5 Bottom line

Token launches are for founders who want to be public figures running communities. This founder isn't. Sell B2B, exit at 20×, never run a Discord.
