# CLAUDE.md

Durable project-level context for Claude sessions. Keep terse. Append only what future sessions genuinely need.

## Billing & pricing (source of truth: `packages/billing/src/plans.ts`)

Two revenue legs:
1. **SaaS MRR** — recurring subscription to us (Clerk Billing)
2. **Nanopayments** — per-call x402 on top (agent's wallet pays per tool call)

These are independent. A trial skips leg 1 but leg 2 keeps flowing.

### Plan tiers

| Tier | Slug | Monthly | Annual (mo-equiv) | Annual total | Public | Workspaces | Prod API keys | Cap ceiling | Nano % off | Take-rate % off |
|---|---|---|---|---|---|---|---|---|---|---|
| Free | `free` | $0 | — | — | ✓ | 1 | 0 (sandbox only) | $100 | 0 | 0 |
| Basic | `basic` | $19/mo | $15/mo | $180/yr | ✓ | 5 | 3 | $2,000 | 15 | 5 |
| Pro | `pro` | $60/mo | $50/mo | $600/yr | ✓ | ∞ | 25 | $20,000 | 30 | 10 |
| Enterprise | `enterprise` | $1,500/mo *(internal list)* | $1,250/mo | $15,000/yr | **private** | ∞ | ∞ | ∞ | 50 | 15 |

**Annual pricing semantics.** Clerk's "Annual base fee" field is the monthly rate when billed annually, not the full-year total — Clerk validates it as ≤ the monthly base fee. The actual annual charge is `annualMonthlyUsd × 12`. Savings: Basic 21% off, Pro 17% off, Enterprise 17% off.

**Enterprise is private in Clerk** (publicly available = off). `<PricingTable />` hides it; sales assigns the plan to orgs via Clerk API after a discovery call. Our marketing + `/app/billing/plans` preview cards still show it as "Custom · Contact sales" — that copy is driven by `@sendero/billing/plans`, not Clerk's listing. The $1,500 / $1,250 list price is the invoice baseline; real deals negotiate off it.

### Clerk Billing features (attached to plans in the Clerk dashboard)

`additional_workspaces`, `production_api_keys`, `nanopayment_discount`, `booking_take_rate_discount`, `channel_whatsapp`, `channel_slack`, `mcp_server_public`, `custom_webhooks`, `audit_log_export`, `priority_support`, `sso_saml`, `white_label`, `custom_sla`.

Constants in `BILLING_FEATURES` in `packages/billing/src/plans.ts`. Feature-per-plan matrix is `plan.features` on each `PlanConfig`.

### Clerk vs code split

- **Clerk Billing** — what plans exist, what features each plan grants, subscription lifecycle, payment collection, free-trial timing. Slugs must match `PLANS[tier].slug` and `BILLING_FEATURES.*`.
- **@sendero/billing/plans** — numeric limits (workspace count, API key count, spend cap ceiling) and discount basis points. These are too fiddly to model as Clerk features; they live in code keyed on tier.
- **Runtime gate:** `has({ feature })` for capabilities, `PLANS[tier]` for numerics.

### Free trial

Use Clerk's native trial. As of Oct 2025 Clerk supports trials **without a card**.

- Plan to trial: **Pro** (reveal the ceiling)
- Length: **14 days**
- Dashboard: toggle **"Require payment method for free trials" = OFF** in Billing Settings, set **Free trial = 14 days** on the Pro plan.
- Post-expiry: user manually upgrades or drops to free. Nanopayments keep flowing throughout — they're a separate revenue leg.

Do NOT roll custom trial logic — Clerk handles it end-to-end and `has({ plan: 'pro' })` returns true during trial, so `currentOrgPlan()` and `buildPlanOverrides()` already do the right thing.

### Runtime resolver

- Server: `apps/app/lib/billing-plan.ts` — `currentOrgPlan()`, `currentOrgPlanTier()`, `hasBillingFeature()`, `canCreateAdditionalWorkspace()`.
- Nanopayment discount wiring: `apps/app/app/api/agent/dispatch/route.ts` — `resolveTenantPlan()` + `buildPlanOverrides()` → `runAgentTurn({ pricingOverrides })`. This materializes the discount into `MeterEvent.priceMicroUsdc`.
- UI: `/app/billing/plans` renders `<PricingTable for="organization" />` + a four-card preview. `/app` home has `<PlanTeaser />` showing current tier + upgrade CTA.

## Circle wallet balances

Authority is the Circle webhook at `/api/webhooks/circle` → `CircleWallet.usdcBalanceMicro` + `eurcBalanceMicro` columns. UI subscribes via SSE at `/api/wallet/balance/stream`. **Do not poll viem from the browser.**

Notes:
- Arc testnet USDC reports `decimals: 18` but amount strings are human-readable (`"5"` = 5 USDC). Always normalize to 6-decimal micro-USDC on ingest. See `packages/sendero-circle/src/balance-sync.ts::toMicro`.
- Zero address (`0x0…0`) means `organization.publicMetadata.arcWalletAddress` hasn't been stamped yet. The WalletDropdown renders a "Provisioning" state in that case and skips balance fetches.

## API keys

Uses Clerk's native API keys (GA'd 2026-04-17). We don't mint/hash/revoke; Clerk does.

- UI: `<APIKeys />` from `@clerk/nextjs` embedded at `/dashboard/settings/api-keys`. Clerk scopes it to the active organization.
- Dashboard flag required: Clerk → API keys → **Enable Organization API keys**.
- Sandbox key: auto-minted on `organization.created` webhook via `clerkClient.apiKeys.create({ subject: orgId, claims: { type: 'sandbox' } })`. Users don't see a separate "Sandbox / Production" toggle — any key they mint from the UI is implicitly production.
- Resolver: `apps/app/lib/api-key-auth.ts::resolveTenantFromApiKey(req)` extracts `Authorization: Bearer ak_…`, calls `clerkClient.apiKeys.verify()`, maps `subject` (org_xxx) → `tenant.clerkOrgId` → `tenantId`, returns `{ keyType, effectiveKeyType }`.
- Downgrade: in `testnet-beta` mode, production keys resolve with `effectiveKeyType = 'sandbox'`. The `keyType` column on the Clerk key claims stays `production` — flipping `SENDERO_NETWORK_MODE=production` activates real settlement without re-issuing keys.
- Routes gated:
  - `/api/mcp` — POST requires a key (returns JSON-RPC error `-32001` if missing). GET discovery doc stays public.
  - `/api/agent/dispatch` — accepts either a Clerk API key OR the legacy `AGENT_DISPATCH_SECRET` shared secret (internal webhooks). Body `tenantId` must match the key's tenant.
- Meter routing: sandbox keys → `MeterEvent.status = 'sandbox'`. `NanopayBatch` excludes sandbox rows from settlement, so no real USDC moves.
- Plan-tier limits (`PLANS[tier].productionApiKeyLimit`): enforced via the Clerk `apiKey.created` webhook in `apps/app/app/api/webhooks/clerk/route.ts::onApiKeyCreated`. On mint, the handler lists the org's active production keys (skips sandbox-claimed ones) and revokes the new key if it breaks the plan limit. Requires `apiKey.created` to be added to the webhook subscription in the Clerk dashboard. Enterprise (`productionApiKeyLimit: null`) skips enforcement.

## Caching & Redis

Upstash Redis is provisioned via Vercel Marketplace (`upstash-kv-orange-leaf`). Env is stamped on every scope — `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`. Use `apps/app/lib/redis.ts::getRedis()` which returns `null` when the env is absent (local dev without sync) so callers fall through to cache-miss behavior instead of crashing.

Current consumers:
- **API key verify cache** (`apps/app/lib/api-key-auth.ts`) — 60s TTL, fire-and-forget writes. Cuts Clerk verify spend by ~6000× on hot keys.

Planned consumers (documented, not implemented):
- x402 tool-call rate limiting per API key

## Balance stream pub/sub

Authoritative path: Postgres `LISTEN`/`NOTIFY` on Neon's unpooled endpoint.

- **Publisher:** `apps/app/app/api/webhooks/circle/route.ts::syncAll` runs `SELECT pg_notify('wallet_balance', payload)` via `prisma.$executeRaw` after every successful balance sync. Payload is JSON: `{ address, usdc, eurc, updatedAt }`.
- **Subscriber:** `apps/app/app/api/wallet/balance/stream/route.ts` opens one dedicated `pg.Client` per SSE connection via `apps/app/lib/pg-listen.ts::openListener()`. Connection uses `DATABASE_URL_UNPOOLED` because LISTEN is stateful and doesn't work over Neon's HTTP proxy.
- **Filtering:** single global channel `wallet_balance`. Each listener filters payload's `address` in-process. Fine at <1000 concurrent; swap to per-address channels (`wallet_balance_{addr}`) if fanout becomes a hotspot.
- **Fallback:** if `DATABASE_URL_UNPOOLED` is missing (local dev without `vercel env pull`), stream route slow-polls Prisma every 10s as a safety net. Log-warns so misconfig is visible.
- **Lifecycle:** SSE max duration is 4 minutes; listener's `stop()` runs `UNLISTEN` + `client.end()` on abort, deadline, or stream close. EventSource reconnects automatically client-side.

## Wallet hydration

`ClerkWalletBridge` (globally mounted in `AppChrome`) syncs `useSendero().userAuth` from Clerk org metadata on every `/app/*` route. Don't duplicate this effect inside individual route components.

## Dialog mounting

`SwapDialog` / `SendDialog` / `BridgeDialog` / `DepositDialog` are mounted once in `AppChrome`. Don't re-mount them in route-specific shells — the nuqs state opens them globally.
