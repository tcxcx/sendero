# CLAUDE.md

Durable project context. Keep terse. Append only what future sessions need.

## Google Cloud Responsible AI ship gate

Every AI/agent-facing shipment must be checked against Google Cloud Responsible AI guidance:
`https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/responsible-ai`.

Before ship, verify:
- **Security risks:** agent tools must fail closed on tenant/auth boundaries; never trust user-provided tenant IDs, org IDs, trip IDs, or secrets without a signed/authenticated binding.
- **Safety testing:** run relevant unit/type/build checks plus at least one adversarial prompt/tool misuse review for new agent capabilities.
- **Grounding/factuality:** tenant-specific claims must come from live Sendero tools, docs, or DB state; agents must not invent setup status, billing state, transactions, tickets, trips, or policy outcomes.
- **Privacy/security:** return the minimum diagnostic data needed; redact tokens/secrets; mask phone/user identifiers where full values are not necessary; avoid storing raw channel envelopes unless explicitly required.
- **Human supervision:** escalate decisions involving tenant account access, legal/financial approval, irreversible payments, settlement/escrow changes, or specialized uncertainty.
- **Language/fairness:** honor user locale and avoid lowering support quality for non-English users; switch language when the user does.
- **Monitoring/feedback:** preserve support ticket, Slack thread, trace ID, workflow execution ID, and channel event links needed to audit outcomes.

Left Hook runs `scripts/check-responsible-ai.ts`. If this section or the guard script is weakened, pre-push must fail.

## Channel topology — B2B2B

Sendero is a **B2B2B platform**. Three audiences, three channels, none interchangeable:

| Audience | Channel | Surface | Relationship to Sendero |
|---|---|---|---|
| **TMC / agency operator** (our B2B customer; the paying tenant) | **Web dashboard** | `/dashboard/*` on `app.sendero.travel` | Buys Sendero; manages their downstream corporate-customer accounts + travelers from web |
| **Corporate customer** (the TMC's client; the B2B2B layer) | **Slack** (installed in the corporate's own workspace) | `@sendero` in the corporate's Slack | Corporate employees self-serve trip provisioning from inside their own company's Slack; the TMC operator monitors + intervenes from web |
| **Traveler** (employee of the corporate customer, or direct consumer) | **WhatsApp** | Per-tenant Meta WhatsApp Business number | Receives boarding pass, balance, claim links, in-trip support |

**Key rules:**

- **Web is the only operator surface.** Slack is NOT the operator handoff channel. Slack-as-operator is a recurring bug pattern that conflates B2 (TMC operator) with B2B2 (corporate customer). When in doubt: operator = web, full stop.
- **Slack install = downstream B2B2B onboarding.** When a TMC signs a corporate customer, that customer installs the Sendero Slack app in **their own workspace**. The TMC operator never reads/writes from that Slack thread directly — they see it surfaced in their `/dashboard` and can intervene via web (which writes back into the Slack thread through the agent).
- **WhatsApp = traveler-facing only.** TMC operators do NOT WhatsApp travelers directly. Conversations happen through the agent; the operator sees them in `/dashboard/inbox/[tripId]` and can take over via web handoff.
- **Kapso orchestration for WhatsApp:** Kapso owns inbound workflow triggers + Flow UX. Sendero stays canonical for tenant auth, tools, MCP, trips, billing, wallets, escrow, audit, web handoff.
- **Canonical tools first:** new channel flows must call `@sendero/tools`, `@sendero/workflows`, channel renderers, and internal Sendero tool endpoints — not duplicate logic inside Kapso functions or a Slack bot.
- **Cross-channel continuity:** Web (operator), Slack (corporate customer), WhatsApp (traveler), and the trip ledger reconcile around tenant id, customer-account id, trip id, workflow execution id, and trace id. The merged thread at `/dashboard/inbox/[tripId]` is the operator's source of truth.
- **Free vs paid:** free workspaces preview setup requirements but cannot run live channels against real audiences. The Sendero-owned WhatsApp sandbox number stays reserved for Sendero customer support. Production WhatsApp requires a paid plan + dedicated WhatsApp Business number. Slack-to-corporate installs require a paid TMC tenant.

## Meta admin: multi-vertical AI agents (apps/admin)

`apps/admin/` is **meta**. It does not exist to "create new orgs in Sendero" — it exists to spin up **multiple vertical AI agents**. Sendero (travel ops) is one of those verticals; the next ones are legal, real-estate, healthcare, etc. Each vertical reuses the same template app shell + channel adapters (WhatsApp, Slack, MCP, web) + settlement rail + billing plumbing. **The only thing that changes per vertical is the tool catalog.**

Hierarchy admin must surface (rollups in this order — note the B2B2B layers):

```
business unit  >  vertical agent (Sendero / legal / …)  >  tenant (TMC, our paying B2B)  >  customer-account (corporate, the TMC's downstream B2B)  >  traveler  >  tool
```

Rules:
- No hardcoded `"Sendero"` strings in admin UI — pull from active vertical context. Branding (logo, copy, default agent persona) replaceable per vertical.
- Tenant/org creation flows ask "which vertical?" first. Vertical → tenant → customer-account → traveler is the auth/permissions tree.
- **Channel ownership:** Web is the TMC operator surface (the paying tenant). Slack is the corporate-customer install surface (B2B2B). WhatsApp is the traveler surface. Admin views must keep these three distinct; conflating Slack with operator handoff is a recurring bug pattern.
- Empty sidebar items use a **single shared** `<ComingSoonScreen feature="…" />` (location: `apps/admin/components/`). Do not populate placeholder pages with bespoke content — one screen, swapped in until the real feature ships.
- Billing dashboards: per-tool spend rolls up cleanly to per-tenant → per-business → per-vertical → per-business-unit. Reuse the existing admin graph/stats primitives (founder approves the look).
- Tool catalog UI is the primary differentiation knob — uploading/swapping/configuring per vertical, not building new app shells.

When in doubt: "does this generalize across verticals?" If not, stop and rebuild the abstraction.

## Billing & pricing (source: `packages/billing/src/plans.ts`)

Two revenue legs, independent: SaaS MRR (Clerk Billing) + nanopayments (per-call x402, agent wallet pays). Trial skips MRR; nanopay keeps flowing.

**Audience split — do not surface nanopay as the headline price to humans.** TMCs / corporate travel buyers see *only* "monthly platform + included usage + transparent overages" plus the agentic resale model on top (they sell agent capacity to their travelers). x402 nanopayments are the agent-to-agent settlement rail surfaced to **other AI agents calling Sendero via MCP**, not on `/app/billing/plans` or in TMC sales decks. Codex consult 2026-05-08 flagged that exposing both legs to the same buyer reads as "subscription + per-click + transaction tax". Keep nanopay internal to the ledger UI for humans, public for MCP consumers.

| Tier | Slug | Monthly | Annual/mo | Public | Workspaces | Prod keys | Cap | Nano % | Take % |
|---|---|---|---|---|---|---|---|---|---|
| Free | `free` | $0 | — | ✓ | 1 | 0 (sandbox) | $100 | 0 | 0 |
| Basic | `basic` | $19 | $15 | ✓ | 5 | 3 | $2,000 | 15 | 5 |
| Pro | `pro` | $60 | $50 | ✓ | ∞ | 25 | $20,000 | 30 | 10 |
| Enterprise | `enterprise` | $1,500 | $1,250 | **private** | ∞ | ∞ | ∞ | 50 | 15 |

**Annual semantics.** Clerk's "Annual base fee" = monthly rate when billed annually (≤ monthly fee). Actual annual = `annualMonthlyUsd × 12`.

**Enterprise private in Clerk** (publicly available off). Marketing + `/app/billing/plans` show "Custom · Contact sales" via `@sendero/billing/plans`. Sales assigns plan via Clerk API.

**Clerk Billing features:** `additional_workspaces`, `production_api_keys`, `nanopayment_discount`, `booking_take_rate_discount`, `channel_whatsapp`, `channel_slack`, `mcp_server_public`, `custom_webhooks`, `audit_log_export`, `priority_support`, `sso_saml`, `white_label`, `custom_sla`. Constants: `BILLING_FEATURES`. Per-plan: `plan.features`.

**Split:** Clerk Billing = plan/feature/lifecycle/payment/trial. `@sendero/billing/plans` = numeric limits + discount bps. Runtime: `has({ feature })` for caps; `PLANS[tier]` for numerics.

**Free trial.** Native Clerk, no card (Oct 2025+). Plan: Pro, 14 days. Dashboard: "Require payment method" OFF, trial=14d on Pro. Don't roll custom logic — `has({ plan: 'pro' })` returns true during trial.

**Resolver:** `apps/app/lib/billing-plan.ts` — `currentOrgPlan()`, `currentOrgPlanTier()`, `hasBillingFeature()`, `canCreateAdditionalWorkspace()`. Nanopay discount: `apps/app/app/api/agent/dispatch/route.ts` → `resolveTenantPlan()` + `buildPlanOverrides()` → `runAgentTurn({ pricingOverrides })`. UI: `/app/billing/plans` + `<PlanTeaser />`.

**Default-free tool pricing.** `priceFor(toolName)` in `packages/tools/src/pricing.ts` returns `'0'` (the `DEFAULT_FREE_PRICE` constant) for any tool without a `TOOL_PRICING` entry — it does NOT throw. The edge worker's `requirePayment` middleware (`apps/edge/src/lib/x402-middleware.ts`) short-circuits when price is `'0'`: it logs a `paid` meter row tagged `'free-tier (no TOOL_PRICING entry)'` and skips the 402 dance. Every tool needs a pricing **policy**, but most should be `'0'` until they actually create infra/provider cost worth charging for. Reads, config lookups, balances, explainers → free. External API calls, on-chain writes, composed flows → priced. Don't reflexively fill in 286 prices; price what creates real cost. Codex consult 2026-05-08.

## Circle wallet balances

Authority: Circle webhook `/api/webhooks/circle` → `CircleWallet.usdcBalanceMicro` + `eurcBalanceMicro`. UI: SSE `/api/wallet/balance/stream`. **Never poll viem from browser.**

- Arc testnet USDC reports `decimals: 18` but amount strings are human-readable. Normalize to 6-decimal micro-USDC. See `packages/circle/src/balance-sync.ts::toMicro`.
- Zero address = `arcWalletAddress` not stamped. WalletDropdown renders "Provisioning", skips fetches.

## Solana gas abstraction (platform hot wallet)

Circle Gas Station is EVM-only. Solana DCWs are regular Solana accounts that need lamports to sign Gateway deposits/spends/bridges. Sendero runs a **platform Solana hot wallet** (`SENDERO_SOLANA_PLATFORM_PRIVATE_KEY`) that JIT-drips ~0.01 SOL into any DCW about to sign — same shape as the EVM sponsor EOA pattern. desk-v1 UB-kit post-mortem #5 informed this.

- **Source of truth:** `packages/circle/src/unified-gateway.ts::ensureSolanaGas`. Reads balance, transfers from platform wallet if below `0.005 SOL`, tops up to `0.01 SOL`. Auto-wired into `deposit / depositFor / spend / bridge` for `circle-wallets` principals on `Sol_Devnet` / `Sol`.
- **Env:** `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` (base58), `SENDERO_SOLANA_RPC_URL` (defaults to `api.devnet.solana.com`). Same scope rules as `TREASURY_PRIVATE_KEY` — no production keys until mainnet flip.
- **Bootstrap:** `bun apps/app/scripts/_local/provision-solana-platform.ts` generates a keypair + tries a devnet airdrop. One-time, gitignored output.
- **Refill cadence:** ≥1 SOL on devnet (https://faucet.solana.com), ≥0.5 SOL on mainnet (corporate ops wallet). 1 SOL covers ~100 deposits.
- **Low-balance alerts:** `apps/app/lib/platform-wallet-alerts.ts::notifyPlatformWalletLow` posts to the Sendero customer-support Slack channel (`SLACK_CHANNEL_ID` via `SLACK_BOT_TOKEN`) when the platform wallet drops below `0.5 SOL`. Throttled to 1 alert per address per 30 min. Wired in `apps/app/instrumentation.ts` via `setSolanaPlatformLowAlertCallback`.
- **Fail-soft contract:** missing env → `{ topped: false, reason: 'platform_wallet_not_configured' }`. The SDK still surfaces the real "Insufficient SOL" error rather than this code crashing.
- **NOT for traveler-side balance display.** The DCW's lamports get spent on tx fees; users may see ~0.01 SOL appear briefly then drop. Cosmetic only. Treat as platform plumbing.

## Gateway signer KMS rewrap (Phase 5 Step 5)

Tenant + user Gateway signer private keys live in two parallel forms during the canary:
- **Legacy** `tenant_gateway_signers.encryptedPrivateKey` / `user_gateway_signers.encryptedPrivateKey` — AES-GCM under env-mode `SENDERO_KEK`. Kept as rollback fallback.
- **KMS envelope** `newEnvelope` (BYTEA) + `kmsKeyResource` + `kmsKeyVersion` — per-row AES-GCM with KMS-wrapped DEK.

Schema enum: `SignerKekProvider` (`env-v1` | `kms-v1`). CHECK constraint: rows must have `kekProvider='env-v1'` OR (`newEnvelope IS NOT NULL AND kmsKeyResource IS NOT NULL`). Both columns coexist; rollback is `READ_MODE=off`, never a schema mutation.

**Runtime gate** (`packages/circle/src/gateway-signer.ts::shouldReadKmsEnvelope`):
1. Row must be `kms-v1` with envelope + key resource.
2. `SENDERO_GATEWAY_SIGNER_KMS_READ_MODE`: `canary` (default) → check canary list; `all` → every kms-v1 row; `off` → force env-mode.
3. Canary lists: `SENDERO_GATEWAY_SIGNER_KMS_CANARY_TENANTS` / `..._CANARY_USERS` (comma-sep IDs, `*` wildcard). Tenant + user gates are independent.

**Canary applied** 2026-05-13 on prod: all 13 rows rewrapped to `kms-v1` (11 tenants + 2 users), envelope ~767 bytes each. Only `cmp24bjrh0000ol9kf6vl1v6v` (sendero-sandbox) is in the canary tenant list — others stay on env-mode decrypt via preserved `encryptedPrivateKey`. KMS key: `projects/sendero-494217/locations/us/keyRings/sendero-tenants/cryptoKeys/gateway-signer-canary` (software, ENCRYPT_DECRYPT, v1).

**DO NOT "rotate" `SENDERO_KEK`** — there is no re-encrypt-with-new-KEK pathway. Env-mode KEK only exists to decrypt pre-cutover ciphertexts. Replacing it bricks every env-v1 row. Correct shape:
1. Rewrap all rows → `kms-v1`.
2. `READ_MODE=all` activates KMS everywhere.
3. Then *retire* (delete) `SENDERO_KEK`. Drop `encryptedPrivateKey` in a follow-up migration.
4. If a fresh env-mode fallback is needed later, add `SENDERO_KEK_V2` alongside (encryption package keys on `kekVersion`).

**Rewrap script**: `apps/app/scripts/migrate-kek-to-kms.ts`. Defaults dry-run. Flags: `--tenant <id>`, `--user <id>`, `--all-tenants`, `--all-users`, `--limit N`, `--apply`. Decrypts via env mode → re-derives the account address → refuses to write on address mismatch (corruption guard) → KMS encrypt + round-trip verify → compare-and-swap UPDATE keyed on (kekProvider='env-v1', encryptedPrivateKey unchanged, kekVersion).

**Full canary runbook (S5.1–S5.10)**: `docs/PHASE_5_PRODUCTION_HARDENING_RUNBOOK.md`.

## Duffel split-ticket integration (PRs #53 + #54)

Sendero surfaces both single-ticket AND split-ticket (multi-carrier, per-slice one-way) flight offers via Duffel's `include_split_ticket: true` + `view=itineraries` API. Per Duffel: median **3× more bookable itineraries** + 25% more combinable departure times.

**Gating** (all three must align):
- `Tenant.metadata.flights.allowSplitTicket === true` — opt-in per TMC. Off by default.
- `search_flights` input `includeSplitTicket: true` — the LLM passes it when round-trip + the customer asked for max options.
- Search has `returnDate` (multi-slice). One-way is single-ticket only.
- Platform kill-switch: `SENDERO_FLIGHTS_DISABLE_SPLIT_TICKET=true` (Vercel env) overrides everything.

**Tools** (`packages/tools/src/`):
- `search_flights` — discriminated response: `{ mode: 'flat', offers }` vs `{ mode: 'itineraries', singleTickets, slices, searchId }`. Returns a UUID `searchId` for provenance binding.
- `book_trip` — multi-slice orchestrator with two-phase hold-all → pay-all. Per-slice idempotency keys (`book-trip-{tripId}-slice-{i}-{hold|pay}`) → real Duffel retry safety via `Idempotency-Key` HTTP header on `/air/orders` + `/air/payments`. NOT used for single-ticket — agent calls `book_flight` for those.

**Safety guards inside `book_trip`** (in order):
1. **Tenant gate** — re-checked even though `search_flights` also gates. Defense in depth.
2. **Offer provenance binding** — every `offerId` must appear in `Trip.metadata.recentSplitTicketSearch.offerIds` saved by the same trip's most recent `search_flights` itinerary call within 30min TTL. When `searchId` is supplied, it must match the stamp's `searchId` (defeats stale / out-of-order overwrite races). `search_flights` writes the stamp via atomic Prisma `$executeRaw` with `WHERE … < NOW()` so Postgres's clock decides "newer" (clock-skew-safe).
3. **Peek validation** (pre-hold, no Duffel orders created yet): bounded retry parallel → backoff → sequential fallback via `peekAllSegmentsWithFallback(offerIds)`. Retryable-error classifier covers Duffel SDK structured errors (`err.errors[].type`), native fetch `TypeError`, Node net codes (`ENOTFOUND/ECONNRESET/ETIMEDOUT`), HTTP-status substrings. Then validates origin/destination continuity + min-layover (default 3h soft, 2h hard floor; tenant override via `Tenant.metadata.flights.minLayoverHours` clamped to `Math.max(raw, 2)`).
4. **Phase-1 rollback** — any `createHoldOrder` failure cancels every prior hold via Duffel two-step `createOrderCancellation → confirmOrderCancellation` (free pre-payment).
5. **Phase-2 partial-paid** — payment failure after one or more slices paid: cancels remaining held-but-unpaid slices, persists `Trip.metadata.splitTicketState` with per-slice snapshot, returns handoff to operator. Auto-refund per airline rule is deferred to v3.

**Booking persistence**: each successful slice produces one `Booking` row under the same `tripId`. `Booking.metadata` carries `{ source: 'book_trip', sliceIndex, offerId, splitTicket: true }` via the typed writer `serializeBookTripMetadata` — `BookingMetadataV1` discriminated union with zod validator in `booking-metadata.ts`. Defensive reader `parseBookingMetadata(unknown): BookingMetadataV1 | null` for downstream code.

**Adapter** (`packages/duffel/src/index.ts`):
- `searchFlightsItineraries(params)` — raw fetch (SDK 4.24 doesn't model these params); zod-validated response via `duffelItineraryViewResponseSchema` + `nonNullableArray` helper that logs offer-level silent drops for telemetry.
- `peekOfferSegments(offerId)` — public peek helper for pre-hold validation.
- `createHoldOrder` + `payFromBalance` swapped from SDK to raw fetch with `Idempotency-Key` header.

**Deferred to v3** (not in PR #54):
- Per-slice Gateway-escrow `reserve → commit` cycles (`book_trip` writes Bookings directly today; `book_flight` does single-slice escrow)
- Auto-refund per airline hold-window rule on partial-paid
- Channel-render bespoke single + split combo cards
- Travel-insurance auto-bundle on split-ticket selection

**Full design** in `docs/duffel-split-ticket-integration.md`. Tests: `packages/tools/src/book-trip.test.ts` (15 tests covering state machine), `packages/duffel/src/index.test.ts` (zod schema variants), `packages/tools/src/booking-metadata.test.ts` (metadata union, 6 added).

## SenderoStamps deployment runbook (Circle SCP, Arc-Testnet)

Live: `0xcc0fa83535675a856d773cfbc71232c3d7b71a03` (proxy) → `0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672` (thirdweb TokenERC1155). Circle ERC-1155 template `aea21da6-0aa2-4971-9a1a-5098842b1248`. Gas via Circle Gas Station (fiat).

**Re-deploys MUST run all four scripts in order. Skipping event-monitor + webhook = mints fire but indexer never learns.**

```
1. bun scripts/deploy-stamps-template.ts
2. CIRCLE_TX_ID=<id> bun scripts/check-stamps-deploy.ts --watch
3. CIRCLE_CONTRACT_ID=<id> bun scripts/get-stamps-contract.ts
4. SENDERO_STAMPS_ADDRESS=<addr> bun scripts/register-stamps-event-monitor.ts
5. bun scripts/verify-deployments.ts
```

After step 4: register receiver URL in Circle Console (per env). Webhook fires to all URLs project-wide:

| Env | URL |
|---|---|
| Production | `https://<host>/api/webhooks/circle/events` |
| Preview | branch-stable Vercel alias |
| Dev | ngrok URL from `bun webhooks:ngrok` |

Distinct from `/api/webhooks/circle` (balance sync) — both stay registered.

Env: `SENDERO_STAMPS_ADDRESS`, `SENDERO_STAMPS_CONTRACT_ID`, `SENDERO_STAMPS_DEPLOY_BLOCK`, `SENDERO_STAMPS_DEPLOY_TX` → `.env.local` (root + `apps/app`) + Vercel Prod/Preview/Dev.

**ABI gotcha:** thirdweb's `mintTo(address, uint256, string, uint256)` requires `tokenId == type(uint256).max` (auto-increment) OR existing tokenId. Custom keccak ids don't work — use sequential, idempotency from Postgres `NftStamp` UNIQUE on `(kind, primaryKey)`.

### Contract verification (Arcscan/Blockscout)

`bun scripts/verify-deployments.ts` audits all six, exits 1 on gap. Three shapes:
- **Full-source** (GuestEscrow proxy, ERC-8004, TokenERC1155 impl) → `is_verified: true`.
- **EIP-1167 minimal proxy** (SenderoStamps proxy `0xcc0f…1a03`) → `is_verified: false` is **expected**. Arcscan auto-detects via `proxy_type: "eip1167"` + `implementations[0]`. Functionally verified.
- **ERC1967 proxies** (GuestEscrow, ERC-8004) → both proxy + impl verified separately, linked.

`scripts/verify-deployments.ts` encodes `expect` per contract. Add new addresses there on every deploy.

## Solana Anchor program runbook (devnet)

Solana parity for Arc lives in two Anchor programs deployed to **sol-devnet**. Tenants whose `Tenant.primaryChain === 'sol'` route prefund/reserve/commit/settle through these instead of the Arc EVM contracts. Identity + NFT stamping reuses Metaplex (one program covers Identity/Reputation/Validation; MPL Core covers stamps).

| Program | Address | Role |
|---|---|---|
| `sendero_guest_escrow` | `9NHw47GifDKsPDggQeQd53sNrAsBWeSayzvvSr2tjUL8` | Solana port of SenderoGuestEscrow.sol — prefund/claim/reserve/commit/settle/refund/sweep parity. |
| `agentic_commerce` | `4dvtCnTgoJpnmjc9zqBTgEdCiGyHkBHFtDquMgXE1PR9` | AI-agent job lifecycle (create/fund/complete/refund) — Solana-native, no Arc twin. |
| Metaplex Core (external) | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d` | Trip-stamp NFT minting — Solana parity for SenderoStamps. `mintCoreTripStamp` mints BoardingPass / SettlementReceipt / TripPassport. |
| Metaplex Agent Registry (external) | `1DREGFgysWYxLnRnKQnwrxnJQeSMk2HmGaC6whw2B2p` | Solana equivalent of ERC-8004 Identity + Reputation + Validation. `provision-identity` mints org agent here on tenant create. |

**Authority**: both Sendero programs sign with the same upgrade authority pubkey held in `SENDERO_SOLANA_PLATFORM_PRIVATE_KEY` (also funds DCW gas via JIT-drip — see "Solana gas abstraction"). Authority drift is the audit's #1 alert.

**Re-deploy flow** (Anchor):

```
1. cd contracts-solana/<program> && anchor build
2. anchor deploy --provider.cluster devnet --program-keypair target/deploy/<program>-keypair.json
3. anchor idl init --provider.cluster devnet --filepath target/idl/<program>.json <program-id>
4. cp target/idl/<program>.json packages/guest/idl/  (or matching consumer pkg)
5. bun apps/admin/scripts/verify-solana-programs.ts  (or hit /dashboard/contracts?chain=sol → Refresh)
```

**TS adapter source of truth**: `packages/guest/src/solana.ts` exports the ix builders consumed by `prefund_trip / reserve_booking / commit_booking` Solana branches in `packages/tools/src/guest-escrow.ts`. Keep IDL + adapter in lockstep.

**Audit surface**: `apps/admin/lib/contracts/audit-solana.ts` reads ProgramData via `BPFLoaderUpgradeab1e…` owner, slices the layout (4-byte discriminator + 8-byte slot + 1-byte authority Option tag + 32-byte authority pubkey), compares vs `expectedAuthority` in registry. External programs (`ownership: 'external'`) skip authority check — a live ProgramData fetch is enough.

**Cluster pin**: SDK defaults to `https://api.devnet.solana.com`. Override via `SENDERO_SOLANA_RPC_URL`. `sol-mainnet` deploys are gated behind the same testnet-beta → mainnet flip as Arc; do not deploy until billing tiers + scopes are finalized.

## Tenant primaryChain — cascade invariant

`Tenant.primaryChain` (`'arc' | 'sol'`, defaults `'arc'`) is a tenant-wide commitment. Picked once at onboarding; locks the entire settlement stack for that tenant. **No tool may silently fall back to Arc when a `'sol'` tenant invokes it.**

**Picked at onboarding by:**
- `/onboarding/corporate` — `<select name="primaryChain">` writes the field on Tenant upsert (server action, before Slack OAuth).
- `/onboarding/agency` — same selector (added with this section).
- `/onboarding/consumer` — N/A (consumers inherit chain from the tenant they join).
- Generic `/onboarding` (Clerk-direct) — falls through to Prisma column default `'arc'`. Customers needing Sol must use `/onboarding/corporate` or `/onboarding/agency`. Post-default flip requires support + zero on-chain state.

**What cascades when `primaryChain === 'sol'`:**

| Surface | Arc | Solana |
|---|---|---|
| Treasury wallet | Circle MSCA (provisionTenantWallet) | Squads V4 + DCWs (provisionTenantSolanaTreasury) |
| Booking escrow | SenderoGuestEscrow.sol | sendero_guest_escrow Anchor program |
| `prefund / reserve / commit / cancel` | `encode*` viem calls | `build*Ix` from `@sendero/guest/solana` |
| `confirm_booking` | commitBookingV2 (vendor + agency + fee) | commit_booking + deferred markup at settle |
| Trip stamps (`mint_stamp`) | SenderoStamps ERC-1155 (thirdweb) | Metaplex Core asset |
| Identity (`provision_identity`) | ERC-8004 IdentityRegistry | Metaplex Agent Registry |
| Reputation (`give_feedback`) | ERC-8004 ReputationRegistry | **Deferred** — typed refusal `GIVE_FEEDBACK_SOL_DEFERRED` until Metaplex feedback ix lands in `@sendero/metaplex` |
| Traveler-pay reimbursement (book_flight settle) | `Arc_Testnet` toChainKey → Arc superadmin treasury | `Sol_Devnet` toChainKey → Solana superadmin treasury |

**Resolver:** `resolveTenantPrimaryChain(ctx)` in `packages/tools/src/guest-escrow.ts` (also inlined in `cancel-booking.ts`, `give-feedback.ts`, etc.). Reads `Tenant.primaryChain` once per call; defaults `'arc'` only when no tenantId is in context (sandbox/test bench).

**Forbidden patterns:**
- Calling `@sendero/arc/identity` or any Arc-specific encoder without first checking `tenant.primaryChain`. The `give_feedback` Sol gate is the canonical example: throw a typed `GIVE_FEEDBACK_SOL_DEFERRED` error rather than silently submit on Arc.
- Defaulting to `'arc'` when a tenant lookup fails for an authenticated request. Treat that as a fail-closed error, not "fall back to Arc".
- Running an Arc-only sweeper against rows with `chain='sol'` (and vice versa). Sweepers must filter on `chain` matching their target.

**Verifying a new tool respects the invariant** (do this for every new on-chain surface):
1. Does the tool make a chain-touching call (escrow, settlement, NFT, identity, reputation)? → must branch on `tenant.primaryChain`.
2. Is there a Solana adapter for the equivalent action? → wire the `'sol'` branch.
3. If no adapter yet → throw a typed `*_SOL_DEFERRED` error with `agentInstruction`. Do NOT default to Arc.

## API keys

Clerk's native API keys (GA 2026-04-17). Clerk mints/hashes/revokes.

- UI: `<APIKeys />` at `/dashboard/settings/api-keys`. Dashboard flag: **Enable Organization API keys**.
- Sandbox key: auto-minted on `organization.created` webhook with `claims: { type: 'sandbox' }`. Users only mint production from UI.
- Resolver: `apps/app/lib/api-key-auth.ts::resolveTenantFromApiKey(req)` extracts `Bearer ak_…`, calls `clerkClient.apiKeys.verify()`, maps `subject` (org_xxx) → `tenant.clerkOrgId` → `tenantId`, returns `{ keyType, effectiveKeyType }`.
- Downgrade: `testnet-beta` mode → production keys resolve `effectiveKeyType = 'sandbox'`. Flipping `SENDERO_NETWORK_MODE=production` activates real settlement, no re-issue.
- Routes: `/api/mcp` POST requires key (JSON-RPC `-32001` if missing); GET stays public. `/api/agent/dispatch` accepts Clerk key OR `AGENT_DISPATCH_SECRET` (internal webhooks); `body.tenantId` must match key's tenant.
- Meter: sandbox keys → `MeterEvent.status = 'sandbox'`. `NanopayBatch` excludes sandbox.

**Testnet downgrade chokepoints — both must be wired:**
- **Tool context:** every surface calling `buildMcpCatalog`/registry MUST set `ctx.caller = { scopes, keyType, effectiveKeyType }`. Without it, gates on `effectiveKeyType` see `undefined`. MCP: `apps/app/app/api/mcp/_mcp-app.ts::buildRequestCatalog`. Dispatch: already wired via `apiKey`.
- **`confirm_booking` meter status:** `ConfirmBookingDeps.recordMeter` requires `status: 'paid' | 'sandbox'`. Handler computes from `input.callerKeyType`, **fails closed to `'sandbox'`** when caller absent. Don't reintroduce default `'paid'`.

**Plan-tier limits** (`PLANS[tier].productionApiKeyLimit`): enforced via `apiKey.created` webhook in `apps/app/app/api/webhooks/clerk/route.ts::onApiKeyCreated`. Lists active prod keys, revokes new key if limit broken. Requires `apiKey.created` subscription. Enterprise (null limit) skips.

**Fails closed on list errors.** If `apiKeys.list()` throws, new key revoked with `list_api_unavailable`/`list_api_error` reason. Count includes fresh key synthetically.

**Revoke cache invalidation.** `apiKey.revoked` + `apiKey.deleted` call `invalidateApiKeyCache(keyId)` — drops cache instead of waiting 60s TTL. Both subscriptions required.

## Caching & Redis

Upstash via Vercel Marketplace. Env: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`. Use `apps/app/lib/redis.ts::getRedis()` — returns `null` when env absent (callers fall through to cache-miss).

**Env-scoped keys mandatory.** Upstash DB shared across Preview/Production unless namespaced. Keys MUST start with `<envTag>:…` (`envTag` from `VERCEL_ENV ?? NODE_ENV`). Canonical impl: `envTag()` in `apps/app/lib/api-key-auth.ts`.

Consumers:
- API key verify cache (`apps/app/lib/api-key-auth.ts`) — 60s TTL, env-scoped, fire-and-forget. Cuts Clerk verify ~6000× on hot keys. Reverse index `<env>:apikey:byid:<keyId>` → tokenHash for revoke webhook.

Planned: x402 tool-call rate limiting per key.

## Balance stream pub/sub

Postgres `LISTEN`/`NOTIFY` on Neon's unpooled endpoint.

- **Publisher:** `apps/app/app/api/webhooks/circle/route.ts::syncAll` runs `pg_notify('wallet_balance', payload)` after sync. Payload: `{ address, usdc, eurc, updatedAt }`.
- **Subscriber:** `/api/wallet/balance/stream/route.ts` opens dedicated `pg.Client` per SSE via `apps/app/lib/pg-listen.ts::openListener()`. Uses `DATABASE_URL_UNPOOLED` (LISTEN doesn't work over Neon HTTP proxy).
- **Filtering:** single channel `wallet_balance`; in-process address filter. Per-address channels if fanout becomes hotspot.
- **Fallback:** missing `DATABASE_URL_UNPOOLED` → slow-poll Prisma every 10s, log-warn.
- **Lifecycle:** SSE max 4min; `stop()` runs `UNLISTEN` + `client.end()` on abort/deadline/close. EventSource auto-reconnects.

## Wallet hydration

`ClerkWalletBridge` (mounted in `AppChrome`) syncs `useSendero().userAuth` from Clerk org metadata on every `/app/*`. Don't duplicate per-route.

## Dialog mounting

`SwapDialog` / `SendDialog` / `BridgeDialog` / `DepositDialog` mounted once in `AppChrome`. Don't re-mount per-route — nuqs state opens globally.

## Slack OAuth state

Signed via `apps/app/lib/slack-oauth-state.ts`. Wire: `<payload>.<signature>`, payload = `base64url(JSON({ tenantId, exp }))`, signature = HMAC-SHA256. 10-min TTL, constant-time verify.

- Construction: `apps/app/app/onboarding/corporate/page.tsx` → `signSlackState(tenant.id)`.
- Verification: `oauth-callback/route.ts` → `verifySlackState(state)` before any DB lookup.
- Secret: `SLACK_STATE_SECRET` (preferred), falls back to `CLERK_SECRET_KEY`.
- **Never** hand-roll `base64(JSON(state))` — install-CSRF footgun.

### Slack user mapping

Slack-driven turns resolve `meter_events.userId` to actual Slack member via `apps/app/lib/slack-user-mapping.ts`. Cached in `SlackUserBinding` by `(tenantId, teamId, slackUserId)`. Cache miss: calls `slack.users.info` (needs `users:read.email` scope, in `DEFAULT_BOT_SCOPES`), looks up `User` by email within tenant, or auto-provisions `User { source: 'slack' }`. Provisional rows claimed when same email signs in via Clerk.

**Never** use `install.authedUserId` as message author — that's the install admin. Falls back only when event has no `user.id`.

### Slack webhook routes (apps/app)

All four on Next.js (Fluid Compute hits Prisma + Workflow DevKit). CF Workers edge adapter retired.

- `events/route.ts` — Events API. HMAC + 5-min replay, install lookup `(teamId, enterpriseId)`, re-validates row matches envelope, drops revoked installs, defers `runSlackAgentTurn()` past 3s ack via `after()`. Redis: dedup `event_id` (1h SETNX) + thread lock `(teamId, channelId, threadTs)`, fail-open. 401 sig fail, 404 unknown install (NOT 200).
- `interactions/route.ts` — Block Kit. Branches on `payload.type`: `block_actions` in `after()`, `view_submission` MUST ack synchronously (Slack reads body for modal lifecycle), `view_closed` deferred. Submission router built per-request to close over `install.tenantId`. Approval `sendero_approval.{approve,reject}` flips `Booking.status`, `chat.update`, resumes paused workflow.
- `commands/route.ts` — slash commands. Same gates. `/sendero note <trip-id>` opens trip-note modal via `views.open` synchronously (trigger_id 3s TTL).
- `oauth-callback/route.ts` — OAuth v2 (Enterprise Grid aware). Verifies state, exchanges via `@sendero/slack::exchangeCode`, upserts `SlackInstall` on `(enterpriseId, teamId)`. Reinstall clears `revokedAt = null`.

## Circle webhook gates

`apps/app/app/api/webhooks/circle/route.ts` runs three gates: signature (ECDSA SHA256) → freshness (`timestamp` in `[now − 10min, now + 5min]`) → dedup (`processDurableWebhook` on `notificationId`).

- **Key ID hardening:** `x-circle-key-id` validated against strict UUID regex before fetch to `api.circle.com`. Prevents SSRF + per-request DoS.
- **Key cache:** bounded LRU 64. Forged keyIds can't grow map.
- **externalId fallback:** `${type}:${timestamp}` (timestamp now required). Don't reintroduce `Date.now()` — defeats dedup on replay.

## Agent dispatch shared secret

`apps/app/app/api/agent/dispatch/route.ts::authorizeDispatch` compares `AGENT_DISPATCH_SECRET`/`CRON_SECRET` with `crypto.timingSafeEqual` via `safeEqual(a, b)`. **Never** revert to `===` — leaks bytes.

Legacy shared-secret trusts `body.tenantId` by design (internal webhooks). Rotate quarterly; leak = any-tenant impersonation. API-key-authed callers pinned to key's tenant; mismatch = 403.

## Invoice rendering — JSX only

`apps/app/app/invoice/[token]/page.tsx` renders `<InvoiceHtml {...props} qrDataUrl={…} />` as JSX. **Never** reintroduce `dangerouslySetInnerHTML` for invoice content — tenant-controlled fields must flow through React auto-escape. `renderInvoiceQrDataUrl()` in `@sendero/invoicing` exists so page skips qrcode dep.

`renderInvoiceHtml()` (string form) still exported for email/PDF. Raw `<title>${invoice.number}</title>` escaped via `escapeHtml()` defense-in-depth.

## UI sizing: px for layout, rem for type

`apps/app/globals.css` sets `html { font-size: 13px }`. `14.5rem` = 188.5px, not 232px.

- Layout (sidebar widths, card max-widths, fixed offsets) → **px**. See `SIDEBAR_WIDTH = '232px'`.
- Visual rhythm (font-size, line-height, text spacing) → **rem**.
- Figma/Claude Design specs in px — honor literally.

## Pre-commit migration lint

`lefthook.yml → pre-commit → migration-lint` runs `scripts/check-prisma-migrations.ts` on staged `migrations/*/migration.sql`:

- **BLOCKS:** `ALTER TYPE ADD VALUE 'x'` + same-file reference to `'x'`.
- **WARNS:** `CREATE INDEX` without `CONCURRENTLY`, `ADD COLUMN NOT NULL` without `DEFAULT`.
- Override: `SKIP_MIGRATION_CHECK=1 git commit` (document why).

Prisma on Postgres doesn't wrap migrations in tx by default — isolated `ALTER TYPE ADD VALUE` is safe. Lint protects against the combined pattern.

## x402 edge hardening — scopes, signing, envelopes

`apps/app/app/api/agent/dispatch/route.ts` runs three controls per turn, shared via `@sendero/auth/dispatch-auth`:

- **Scopes:** `ResolvedApiKey.scopes` filters tool registry via `filterToolsByScopes()` **before** LLM. Sandbox: `['*']`. User-minted prod: `DEFAULT_PROD_SCOPES` (read-mostly), stamped by `apiKey.created` webhook into `tenant.metadata.apiKeyScopes[keyId]`.
- **Signing** (privileged only): `scopesRequireSignature()` triggers on `settlement`, `treasury`, or `*`. Headers: `x-sendero-ts` + `x-sendero-nonce` + `x-sendero-sig = v1=<hex>`. HMAC key = `sha256(bearer)`. Upstash `SETNX EX 120s` dedupes nonces. Read-mostly skips signing (sub-second hot path).
- **Response envelopes:** every reply carries `x-sendero-trace-id`, `x-sendero-meter-id`, `x-sendero-ts`, `x-sendero-sig` via `buildResponseHeaders()`.

When adding tools: update `toolToScope()` in `packages/auth/src/dispatch-auth.ts`. If tool moves USDC or reads PII, add to `PRIVILEGED_TOOLS`. Public recipe: `/docs/security`.

## OpenAPI + agent DX

Single OpenAPI 3.1 doc from canonical `toolList`:
- Spec: `POST /api/openapi.json` → `apps/app/app/api/openapi.json/route.ts` → `packages/tools/src/openapi.ts`. JSON + CORS.
- Viewer: `/api-viewer` in `apps/docs` renders `@scalar/api-reference-react`. Outside Fumadocs shell.
- Docs-as-markdown: `/docs/*` gains `.md` variant via `apps/docs/app/docs/[[...slug]].md/route.ts`. Strips frontmatter.
- Top-nav: `apps/docs/app/docs/layout.tsx` → API Reference, MCP, Get API key (deep-link to `/dashboard/settings/api-keys`).
- `llms.txt`: `packages/llms/src/catalog.ts → buildSenderoDocsLlms`.

New tool = OpenAPI + MCP manifest + docs sidebar all auto-pick. Don't hand-maintain separate spec files.

## Canonical channel-render layer

`apps/app/lib/channel-render/` — single source for cross-channel rendering. Every agent message passes through `ChannelMessage` discriminated union. One canonical input, four native outputs (operator web, Slack, WhatsApp, web traveler).

- **Type:** `types.ts` exports `ChannelMessage = text | card | tool_invocation | tool_result | approval_request | reasoning | sources`. `ChannelCta.kind` covers `approve / reject / cancel / confirm_change / select_offer / confirm_cancel / open_link / tool_invoke / reply`. `ChannelRenderer<T>` is async (mints OG image URLs via HMAC).
- **Operator (web):** `operator.tsx` exhaustive switch on `kind`, emits AI Elements (`Tool`, `Reasoning`, `MessageContent`) + inline `CardBlock`/`ApprovalCard`/`SourcesBlock`. `exhaustive(_: never)` enforces completeness.
- **Per-channel (server-only):** `channels/slack.ts`, `channels/whatsapp.ts`, `channels/web.ts`. Operator-only kinds (`reasoning`, raw `tool_invocation`) return `null` from traveler-side.
- **Barrel discipline:** `channel-render/index.ts` is **client-safe** — exports types + `renderForOperator` only. Per-channel renderers import `@sendero/slack` → `node:fs`, server-only. Server: `import { renderForSlack } from '@/lib/channel-render/channels/slack'`. Static import-graph guard: `__tests__/bundle-leak.test.ts`.
- **Tests:** `__tests__/` — operator coverage + channel snapshots + bundle-leak guard. `bun test`.

New `ChannelMessage` kind: extend union, add case in operator switch + each `channels/*.ts`, update `__fixtures__/messages.ts`, write snapshots. Compiler refuses build until all four switches handle it.

## Channel-send orchestrators

Apps composes; packages don't import back. `apps/app/lib/channel-send/`:

```
const rendered = await renderForSlack(channelMsg)   // canonical → native
await sendBlocks({ client, channel, text, blocks }) // package primitive
```

- Slack: `channel-send/slack.ts` composes `renderForSlack` + `createSlackClient` + `sendBlocks` (from `@sendero/slack/send`).
- WhatsApp: `channel-send/whatsapp.ts` composes `renderForWhatsApp` + `WhatsAppClient.send`.
- Public: `channel-send/index.ts`.
- Returns `{ sent: false, reason: 'kind-not-relayed-to-X' }` when renderer null + surface-specific reasons.
- Tests: mocked `@sendero/slack` + `@sendero/whatsapp` via `mock.module`.

Package primitives take **already-rendered native payloads** — never see `ChannelMessage`. Dependency direction enforced by construction.

## Operator agent chat surface

`/dashboard/agent-chat` — operator AI Elements test bench. Renders only via canonical channel-render layer.

- Page: `apps/app/app/(app)/dashboard/agent-chat/page.tsx` (server) + `agent-chat-client.tsx`. Mounts `Conversation`, `Message`, `PromptInput` + `Persona` (Rive halo) + `AgentPersona` (motion).
- Persona state: `useChat` `status` (`submitted | streaming | error | ready`) → `PersonaState` (`thinking | speaking | asleep | idle/listening`).
- Backend: `POST /api/agent/chat` — streaming sibling of `/api/agent/dispatch`. Three auth modes: API key, shared secret, **Clerk session cookies** (operator). All resolve `tenantId + userId` via `agent-auth`.
- Cap + meter identical to dispatch via `apps/app/lib/agent-auth.ts` (`makeCapStore`, `makeMeterStore`, `resolveSegment`, `buildPlanOverrides`, `preflight`, `buildIdempotencyKey`). One `MeterEvent` per turn, idempotent on `turnId`. Sandbox skips `NanopayBatch`.
- Model: `apps/app/lib/agent-models.ts::resolveDirectModel ?? resolveModel`. Streaming routes prefer **direct providers first** (Vertex → Gemini → Anthropic → OpenAI) — gateway errors arrive in-band. Vertex direct canonical; gateway fallback.
- Streaming: `streamText` → `result.toUIMessageStreamResponse()`. Client maps `UIMessage.parts` → `ChannelMessage[]` via `uiMessageToChannelMessages`.

Don't touch `/dashboard/console` — production operator surface (`MetaInboxLive`). Agent-chat is next-gen test bench.

## Satori share-image generator

Single source for cross-channel share images. When `share` payload lacks `imageUrl`, every channel falls back to Satori-generated card.

- Route: `apps/app/app/api/og/share/route.tsx` — Edge `ImageResponse`, Satori. Public (`proxy.ts` allowlist) for unfurl bots. **HMAC token = integrity gate, not Clerk.** Falls back to generic Sendero card on verify fail (unfurl bots never see 4xx).
- Layout: `apps/app/lib/og/share-card.tsx` — pure JSX-for-Satori. Brand palette parchment + vermillion + midnight. Title scales by length, max 3 bullets, optional CTA pill, right-edge accent.
- URL builder: `apps/app/lib/og/share-url.ts::buildShareImageUrl(share, baseUrl?)`. HMAC-SHA256 + `INVOICE_SIGNING_SECRET`. Returns `null` when secret unset.
- Channel renderers call `buildShareImageUrl(msg.share)` to fill `imageUrl` when absent. Tools with explicit `imageUrl` (e.g. `export_route_map`) keep theirs.
- Email: `packages/notifications/src/share-template.ts::renderFromShare(share)` — canonical share email. `notifier().sendShareCard()` is Resend wrapper. OG at 600×315.
- Tests: `apps/app/lib/og/__tests__/share-url.test.ts` — HMAC roundtrip, tamper, wrong secret, malformed, fail-soft, weak-secret rejection.

Canonical `share` contract: `tool_result` returns `{ title, body, bullets, primaryCta, secondaryCtas, imageUrl? }`. Renders as Slack block kit, WhatsApp interactive, email card, web card. **Anything UX-relevant lives in `share`**, never hard-coded per adapter.

## Wedge findings (a16z + YC RFS, applied)

a16z Speedrun "Come for Agent, Stay for Network" + YC Summer 2026 RFS. Re-read before scoping new surfaces — network is the moat. Expanded template: `BUILD_VERTICAL_AI_AGENT.md`.

**Six-precondition self-test for travel ops: 5.5/6.** ✅ fragmented supply, ✅ offline suppliers, ✅ opaque pricing, ✅ frequent purchases, ✅ different SKUs, ⚠️ commoditized (Hyatt night ≈ Hyatt night, but flight directs aren't fully fungible).

**Already executed:**
- Agent wedge: `book_flight`, `search_flights`, `hold`, `book_stay`, `settle_*` end-to-end.
- Multi-channel: Slack + WhatsApp + MCP + web + email via `runAgentTurn`.
- % of revenue: confirm_booking take-rate (50bps default) + nanopay margin per call.
- Settlement rail: USDC on Arc with on-chain audit. Differentiated for regulated TMCs.
- Tier 2 GTM: per-tenant `/install/slack?tenant=<slug>` for co-branded resale.

**Missing — "Stay for Network":**
1. **Pricing benchmark** (~1wk, low risk). Log every search result, picked offer, supplier rate. Per-tenant: "Your SFO→LHR cost was $1,820. Median: $1,640. 11% above." k-anonymity n≥20. First network hook.
2. **Demand aggregation MVP** (~3wk, medium risk). TMC dashboard: "Your N clients booked X trips on top 5 routes — request corporate rate?" Manual first; automation later.
3. **Direct supplier rates** (multi-quarter, high). Sendero negotiates with airline + hotels. Suppliers compete to be on network. The actual moat.

Stage 2/3 channel platform = distribution scaffolding. Pricing benchmark = lock-in.

**Anti-patterns:**
- ❌ Per-seat pricing (caps at HR-budget; commoditizes vs Concur/Navan)
- ❌ Chatbot bolted on (we're agent-native)
- ❌ Internal tools without buyer × supplier graph data
- ❌ Stage 3 white-label before signed TMC

**YC RFS map:** AI-Native Service Companies (we're it for travel ops), Software for Agents (MCP/OpenAPI/llms.txt/ERC-8004), AI OS for Companies (closed loop), Company Brain (per-tenant policy + memory).

**Founder forcing questions (quarterly):**
1. Smallest buyer bundle that moves an airline price 5%?
2. In 12mo, what's the one sentence TMC operator says about Sendero?
3. If Sendero disappeared, who panics first — buyers, suppliers, or TMC operators? Want all three.
4. Fastest way we lose moat? (Likely: hyperscaler ships generic travel agent. Defense: vertical depth + audit story.)

## Slack channel hardening — dedup, locks, lifecycle, step-streaming

Four hot-path controls before dispatch:

- **Event-id dedup** (`apps/app/lib/slack-dedup-lock.ts::claimSlackEvent`) — Redis SETNX `<env>:slack:event:<event_id>` (1h TTL). Catches retry-on-non-200. Fail-open; sessionStore turnId guard backstops.
- **Single-flight thread lock** — Redis SETNX `<env>:slack:lock:<subjectKey>` (90s TTL). Lua check-and-del so TTL'd-out lock from another instance isn't accidentally freed. Drops concurrent same-thread with `{ ok: true, dropped: 'thread_busy' }`.
- **Subscribed-thread filter** (`slack-thread-subscription.ts`) — channel msgs only trigger when bot @-mentioned OR previously replied. DMs always respond. `markThreadSubscribed` in `slack-agent.ts` (24h TTL). Fail-conservative on Redis outage.
- **Lifecycle (`SlackInstall.revokedAt`):** `tokens_revoked` + `app_uninstalled` stamp `revokedAt`; routes drop traffic. OAuth callback clears on reinstall. Manifest subscribes both events.

**Step-based streaming.** `runAgentTurn` accepts `onStepFinish` (`packages/agent/src/run.ts`) firing per AI SDK step. Slack adapter edits `_Thinking…_` placeholder between tool calls — `🔎 Searching flights…` → `🔎 Searching flights, Searching hotels…` → final. `renderStepStatus` + `toolNameToVerb` in `slack-agent.ts`; unknown tools fall through as `Running \`<name>\``. Same-content edits deduped via `lastStatus` cache (chat.update Tier 3 = 50/min, comfortable). *Step* streaming, not token. True per-token would need `generateText` → `streamText` cross-cutting; deferred.

## Slack slash commands + view modals

`/sendero help | status <trip-id> | note <trip-id>` — first three. `SlashCommandRouter` in `@sendero/slack` (`packages/slack/src/slash-commands.ts`) keys on `(command, subcommand)` with fallback. `parseSlashCommandBody` decodes URL-encoded. Unknown installs respond `response_type: 'ephemeral'` install-prompt (better DX in resold workspaces).

`ViewRouter` keys on `view.callback_id` for `view_submission` + `view_closed`. **Submission MUST ack synchronously** — Slack reads body for modal lifecycle. Per-request submission router closes over `install.tenantId`; closed-handler can be singleton.

**Cross-tenant gate is load-bearing.** `private_metadata` is opaque — opener stuffs `{tripId, channelId, threadTs}` JSON; Slack passes back unchanged. Trip-note submit MUST verify `trip.tenantId === context.tenantId` AND use that in WHERE — without both, any user reads/writes across tenants. "Trip not found" error same on missing vs cross-tenant (no existence leak). Pattern: `apps/app/lib/slack-views/trip-note.ts::handleTripNoteSubmission`.

**Atomic JSON append.** `Trip.events` is Json append-only. `handleTripNoteSubmission` uses `prisma.$executeRaw` with Postgres `||` jsonb append:

```sql
UPDATE trips SET events = COALESCE(events, '[]'::jsonb) || $1::jsonb
WHERE id = $2 AND "tenantId" = $3;
```

Atomic, concurrent-safe. Tenant id double-bound in WHERE prevents TOCTOU between `findUnique` and update.

## WhatsApp inbound hardening

Meta's `x-hub-signature-256` only signs body, not timestamp. Per-message freshness off `messages[].timestamp`:

- **Replay window** (`apps/app/lib/whatsapp-dedup.ts::isWithinReplayWindow`) — pure ±5min, no Redis round-trip.
- **Per-wamid dedup** (`claimWhatsAppMessage`) — Redis SETNX `<env>:wa:msg:<wamid>` (1h TTL). Fail-open like Slack.

Bad-sig still logged to `WhatsAppWebhookEvent` for forensics.

## WhatsApp audit logs + observability

Three append-mostly tables, tenant-scoped:

- **`WhatsAppWebhookEvent`** — one row per inbound: signature_valid, replay_window_ok, normalized counts, duration_ms, traceId, optional rawEnvelope (off by default). Inserted post-200 via `after()` so audit can't extend Meta's ack.
- **`WhatsAppOutboundMessage`** — one row per send, UNIQUE on `wamid`. Source label (`'agent_reply' | 'otp' | 'security_alert' | …`). Updated by `messages.statuses` webhook with `deliveredAt` / `readAt` / `failedAt` + `failureReason`.
- **`WhatsAppApiLog`** — one row per outbound to Kapso/Meta: status_code, duration_ms, ok, errorMessage, method, endpoint shape (path params → `{id}`). Includes failed health pings + 429s + network errors (status_code=0).

**Audit hooks.** `WhatsAppClient` accepts `onSent` + `onApiCall`. Truly fire-and-forget — `void Promise.resolve().then(...)`. Writers in `apps/app/lib/whatsapp-audit.ts` swallow Prisma errors fail-soft.

**Operator UI.** `/dashboard/channels/whatsapp/inbox` — three stacked tables. `apps/app/app/(app)/dashboard/channels/whatsapp/layout.tsx` mounts pill-tab nav (`WhatsappChannelNav`): **Workspace** + **Inbox**. Active from `usePathname()`; `router.push` keeps URLs shareable. Add tabs via `TABS` const.

## Observability + prompt management — Langfuse

`@sendero/langfuse` is the ONLY package importing `@langfuse/*` directly. All surfaces import primitives from there. `apps/app/instrumentation.ts` boots `LangfuseSpanProcessor` at startup — every AI-SDK call (`generateText`/`streamText`/`generateObject`) emits a generation automatically.

### Env (all envs)

```
LANGFUSE_SECRET_KEY=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_PROMPT_MANAGEMENT=true   # pulls persona slabs
LANGFUSE_EVALUATORS=true          # 4 LLM-judges per turn (gpt-4.1-nano)
LANGFUSE_MCP_AUTH=                # base64(public:secret) for .mcp.json
```

`LANGFUSE_MCP_AUTH` on Vercel prod/preview/dev; `vercel env pull .env.local` brings down. Compute: `echo -n "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64`.

### Persona resolution

Composed in `apps/app/lib/agent-persona.ts` from two halves:
- `sendero-soul` (Langfuse, fallback `packages/agent/src/soul.ts::SENDERO_SOUL`) — voice contract.
- Surface-specific routing slab: `sendero-chat-routing-rules` / `sendero-dispatch-routing-rules` / `sendero-web-chat-rules` / `sendero-slack-rules`.

Each surface calls `buildAgentPersona(kind, locale)` (or `buildSlackPersonaWithContext` for Slack — interleaves tenant/channel preamble between SOUL + rules). Vars: `{{locale_lang}}` everywhere, `{{today}}` on web. `localeSteering()` in `packages/agent/src/prompt.ts` runs after Langfuse persona lands.

`LANGFUSE_PROMPT_MANAGEMENT=false` → hardcoded fallbacks, no network. Production toggles on; fallbacks remain as outage safety net.

**Scripts:** `bun langfuse:prompts:seed`, `seed-slack`, `pull` (writes `scripts/langfuse-prompts.snapshot.json`, committed; PRs touching prompts must commit snapshot diff), `diff` (exits 1 on drift).

### Tracing

`runAgentTurn` (`packages/agent/src/run.ts`) wraps each turn in `traceAgent(agentType, metadata, fn)`. `agentType`: `sendero-conversation | sendero-slack | sendero-whatsapp | sendero-mcp`. After meter write, fire-and-forget `scoreLatency + scoreCost + scoreToolSuccess + evaluateTrace + flushLangfuse`. Direct `streamText` callers pass `experimental_telemetry: aiTelemetryConfig(functionId, metadata)`.

**Trace ID server → client → server** via `messageMetadata({ part: 'start' })` in `/api/agent/chat`. Client reads `message.metadata.senderoTraceId`, surfaces to thumbs UI.

### Scoring + feedback

- Engine per turn: `scoreLatency`, `scoreCost`, `scoreToolSuccess`, `evaluateTrace` (when enabled).
- Operator thumbs (`/dashboard/agent-chat`) → `POST /api/agent/feedback` → `scoreGeneration(traceId, 'up' | 'down')`.
- Slack HITL (`webhooks/slack/interactions/route.ts`) reads `Booking.metadata.traceId` (set by `confirm_booking` via `getActiveTraceId()`) → `scoreGeneration(traceId, 'approved' | 'rejected')`.

### Datasets + regression

`sendero-golden-turns` — 8 inputs (search/hold/refund/policy-block/locale-spanish/multi-turn/document-scan/treasury-check). `bun langfuse:regression` (`scripts/langfuse-run-regression.ts`) pulls each, runs through LIVE prompts via `gpt-4.1-nano`, scores `rule-match` (mustMention/mustNotMention) + four LLM-judges, links each trace to dataset run. No tools wired — prompt-quality smoke. Filter: `--scenario <name>`. Name run: `--run-name nightly-YYYY-MM-DD`.

`bun langfuse:dataset:seed` re-creates dataset (additive).

### MCP server

`.mcp.json` registers `langfuse` HTTP MCP at `https://us.cloud.langfuse.com/api/public/mcp` with `Authorization: Basic ${LANGFUSE_MCP_AUTH}`. Restart after first env-pull. Five tools: `getPrompt`, `listPrompts`, `createTextPrompt`, `createChatPrompt`, `updatePromptLabels`. Skill: `.agents/skills/langfuse/SKILL.md`.

### When to use what

| Task | Reach for |
|---|---|
| New system prompt | `bun langfuse:prompts:seed` (after editing fallback in `agent-persona.ts`) |
| Edit live prompt without code | Langfuse MCP `updatePromptLabels` or UI; then `pull` to commit snapshot |
| Detect drift in PR | `bun langfuse:prompts:diff` |
| Score human feedback | `scoreGeneration(traceId, 'up'|'down'|'approved'|'rejected')` |
| Auto quality scoring | flip `LANGFUSE_EVALUATORS=true` |
| Smoke prompt change | `bun langfuse:regression --scenario <name>` |
| Active trace inside tool | `getActiveTraceId()` from `@sendero/langfuse` |

## Vercel env vars: scope to all preview, never single branch

`vercel env add NAME preview <branch>` scopes to one branch. New branches inherit nothing — fall back to broader-scope or code default. Dashboard shows `Preview · <branch>`; CLI hides it.

**Rule:** omit `<branch>` arg. Targets following the app go to `production`, `preview` (no branch), `development`. Branch-scope only for genuinely branch-specific (per-PR mock URL, sandbox creds for one test).

**CLI broken for bulk widening.** `vercel env add NAME preview --value true --yes` returns `git_branch_required` even with `--non-interactive --force --yes`. Use REST API:

```bash
TOKEN=$(jq -r .token ~/Library/Application\ Support/com.vercel.cli/auth.json)
PROJECT_ID=$(jq -r .projectId .vercel/project.json)
TEAM_ID=$(jq -r .orgId .vercel/project.json)

# Add/upsert at all-preview scope. type=encrypted (decryptable) is default;
# type=sensitive locks readback to dashboard. upsert=true keeps existing type.
curl -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&upsert=true" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"NAME","value":"VALUE","type":"encrypted","target":["preview"]}'

# Audit branch-scoped that shouldn't be
curl -s "https://api.vercel.com/v10/projects/$PROJECT_ID/env?teamId=$TEAM_ID&decrypt=true" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.envs[] | select(.target | index("preview")) | select(.gitBranch != null) | {key, gitBranch, id}'

# Delete branch-scoped record
curl -X DELETE "https://api.vercel.com/v10/projects/$PROJECT_ID/env/$ENV_ID?teamId=$TEAM_ID" \
  -H "Authorization: Bearer $TOKEN"
```

`target:["preview"]` with no `gitBranch` = all preview. `decrypt=true` returns plaintext for non-sensitive; sensitive need plaintext from `.env.local`.

History: backfill audit found 11 vars stuck on one ship branch's preview scope. Widened in bulk. Re-run audit before any release. Full lesson: `lessons.md`.

## Mainnet cutover gating — distribution surfaces

Claude Code plugin, skills, MCP server, `@sendero/cli` are **built and committed but not published** until Arc mainnet ships. Reasons:

1. Surface area changes during cutover (skill copy tunes from regression scores; CLI `tools call` shape tightens when `effectiveKeyType` flips).
2. Plan-tier limits not final ($100/$2k/$20k are testnet-beta placeholders).
3. Marketplace listings = signals. Don't push during testnet beta.

### Committed, unpublished

- `packages/cli/` — local via `bun run dev`. Don't `npm publish`.
- `apps/claude-code-plugin/` — install via `claude --plugin-dir ./apps/claude-code-plugin`. Don't open marketplace listing.
- `apps/claude-code-plugin/skills/` — seven authored (travel-booking, settlement, reconciliation, cap-management, audit-export, cross-channel, agent-identity). v0.1; expects regression-tuning before lock.
- `apps/mcpb/` — DOES ship today via GH Releases (Claude Desktop has prod-grade install). Thin stdio→HTTP proxy, won't change shape.

### Cutover playbook (mainnet flip)

1. **CLI publish:** `cd packages/cli && bun run build && npm publish --access public`
2. **Plugin marketplace:** add `marketplace.json` at root → `apps/claude-code-plugin/`. Push tag (`plugin-v1.0.0`) → GH Actions packages + uploads to Release. Submit to Anthropic directory.
3. **MCP discovery:** already live at `/api/mcp`. Promote `llms.txt`.
4. **Skills lock:** `bun langfuse:regression --scenario <each>` against Pro-tier prompts; iterate until ≥90%. Then v1.0.0.
5. **Documentation freeze:** `cli.mdx`, `skills.mdx`, `installer.mdx` authored + merged together.

Until flip: install snippets must say "clone + run locally" or "load via `--plugin-dir`". NEVER `npx @sendero/cli@latest` or `/plugin install sendero@sendero` in user-facing docs. Marketing copy can promise the npm/marketplace flow (it's the public roadmap).

## Edge worker — deployed name vs wrangler name

**Deployed hostname:** `sendero-arc-edge.tomas-cordero-esp.workers.dev` (via CF Workers Builds, dashboard-configured). GH Actions deploy retired.

**`apps/edge/wrangler.toml` says `name = "arc-edge"`** — that name only governs `wrangler dev` locally. CF Builds overrides via dashboard project name (`sendero-arc-edge`). Don't "fix" the wrangler name to match without also re-pointing CF Builds — you'll fork the deploy.

Anything probing/linking the worker (health probe, canary, preview-comment, marketing) MUST use `sendero-arc-edge.*`. The `arc-edge.*` hostname returns CF 404 — historical health-probe outage came from this mismatch silently spamming failures every 5 min for days. Canonical default lives in `.github/workflows/edge-health.yml::HEALTH_URL` and `scripts/edge-health-check.sh`.

## Demand-driven context (Raj's pattern, dev-only)

The agent's own bug tracker. Implements Raj Kapadia's demand-driven context approach (workshop video: https://www.youtube.com/watch?v=_QAVExf_1uw) — push-strategy retrieval caps at ~30% accuracy on real institutional knowledge; flip to pull and let the agent tell you what it needs.

Three artifacts:

- **`report_knowledge_gap`** (`packages/tools/src/report-knowledge-gap.ts`) — agent self-reports missing tools, wrong field names, dead instructions, or missing env. Persisted to `KnowledgeGap` Postgres table, deduped by `sha256(kind|toolName|normalize(hypothesis))`.
- **`list_available_tools`** (`packages/tools/src/list-available-tools.ts`) — agent introspects the canonical catalog when uncertain. Filters by caller scopes; hides `internal: true` tools so customer-facing channels never surface ops surfaces.
- **`bun gaps:scan`** (`scripts/scan-knowledge-gaps.ts`) — aggregates open gaps into `docs/agent-gaps/board.md` kanban. Repeat-offender promotion: blocking + `occurrenceCount ≥ 3` escalates to `high` regardless of column severity. `--resolve-stale-days N` auto-archives non-blocking dormant rows.

**STRICT DEV-ONLY.** Three independent gates at the handler — ALL must pass:

1. **Env.** `NODE_ENV !== 'production'` OR `VERCEL_ENV ∈ {undefined, 'development'}`. Production + preview deploys are dead-zone.
2. **Caller key.** `caller.effectiveKeyType !== 'production'`. Leaked prod-keys are refused regardless of env (capability-leak protection).
3. **Tenant context.** No orphan rows — refused if `ctx.traveler.tenantId` is missing.

Production agents fall back to `request_human_handoff` (Sendero-native, fully wired through Liveblocks `$handoffRequired` notification + Slack default-channel + `/dashboard/handoffs` + trip-ledger event). Override `SENDERO_GAPS_ALLOW_NONDEV=1` exists for the operator dashboard's manual "file gap" surface — **never** wire that into the agent runtime; gate #2 still rejects production prod-keys even with the override.

**Source of truth + replication playbook:** `/raj-demand-driven-context` skill at `~/.claude/skills/raj-demand-driven-context/`. Run `/raj-demand-driven-context` to invoke it. The skill includes:
- `references/wiring-new-vertical.md` — step-by-step playbook for forking the pattern into a new vertical AI agent template (real-estate, legal, healthcare, etc.). Sendero is the first vertical; future templates inherit by copying the schema + tools + scanner verbatim.
- `references/integration-vercel-langfuse-cloudflare.md` — end-to-end debugging chain combining `/mcp` (`langfuse`, `cloudflare-workers`) and `/skills` (`vercel:vercel-cli`, `langfuse`, `automate-whatsapp`, `observe-whatsapp`).

**Debugging chain:** gap board → Langfuse trace (via `traceId` on the gap row) → Vercel logs (`vercel logs <deployment>`) → Cloudflare worker logs (when `kind: 'runtime_constraint'`). Total ~5 min from gap surfacing to root cause; ask Claude one question and it walks all four sources in parallel.

**Pre-push gate:** if you're tempted to expose either gap-tool to a production caller, the answer is `request_human_handoff` instead. The handler-level gate is load-bearing — don't soften it.
