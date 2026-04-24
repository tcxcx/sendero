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
- **Fails closed on list errors.** If `clerkClient.apiKeys.list()` is unavailable or throws, the newly-minted key is revoked with a `list_api_unavailable` / `list_api_error` reason rather than let through. Count includes the fresh key synthetically in case Clerk's list hasn't caught up. See `revokeKey` helper in the same file.
- **Revoke cache invalidation.** `apiKey.revoked` and `apiKey.deleted` webhooks call `invalidateApiKeyCache(keyId)` in `apps/app/lib/api-key-auth.ts` — drops the cached verify entry immediately instead of waiting up to 60s for TTL. Both subscriptions must be enabled in the Clerk dashboard alongside `apiKey.created`.

## Caching & Redis

Upstash Redis is provisioned via Vercel Marketplace (`upstash-kv-orange-leaf`). Env is stamped on every scope — `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_URL`. Use `apps/app/lib/redis.ts::getRedis()` which returns `null` when the env is absent (local dev without sync) so callers fall through to cache-miss behavior instead of crashing.

**Env-scoped keys are mandatory.** The Upstash DB is shared across Preview / Production unless you namespace. Every key MUST start with `<envTag>:…` where `envTag` derives from `VERCEL_ENV ?? NODE_ENV`. See `envTag()` in `apps/app/lib/api-key-auth.ts` for the canonical implementation — copy it for any new Redis consumer.

Current consumers:
- **API key verify cache** (`apps/app/lib/api-key-auth.ts`) — 60s TTL, env-scoped keys, fire-and-forget writes. Cuts Clerk verify spend by ~6000× on hot keys. Maintains a reverse index `<env>:apikey:byid:<keyId>` → tokenHash at cache-write time so the `apiKey.revoked` webhook can invalidate without knowing the raw token.

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

## Slack OAuth state

Signed via `apps/app/lib/slack-oauth-state.ts`. Wire format is `<payload>.<signature>` where payload is `base64url(JSON({ tenantId, exp }))` and signature is HMAC-SHA256. 10-min TTL, constant-time verify.

- **Construction site:** `apps/app/app/onboarding/corporate/page.tsx` calls `signSlackState(tenant.id)`.
- **Verification site:** `apps/app/app/api/webhooks/slack/oauth-callback/route.ts` calls `verifySlackState(state)` before any DB lookup.
- **Secret:** `SLACK_STATE_SECRET` env (preferred), falls back to `CLERK_SECRET_KEY`. Set the dedicated env in production.
- **Never** hand-roll `base64(JSON(state))` anywhere else — it's the install-CSRF footgun.

## Circle webhook gates

`apps/app/app/api/webhooks/circle/route.ts` enforces three gates in order: signature (ECDSA SHA256 via Circle pubkey) → freshness (`timestamp` must fall in `[now − 10min, now + 5min]`) → dedup (via `processDurableWebhook` on `notificationId`).

- **Key ID hardening:** `x-circle-key-id` is validated against a strict UUID regex before any outbound fetch to `api.circle.com`. Prevents SSRF + one-fetch-per-forged-request DoS.
- **Key cache:** bounded LRU at 64 entries. Attacker-slipped keyIds can't grow the map.
- **externalId fallback:** `${type}:${timestamp}` is now deterministic (timestamp is required above). Do NOT reintroduce a `Date.now()` branch — it defeats dedup on replay.

## Agent dispatch shared secret

`apps/app/app/api/agent/dispatch/route.ts::authorizeDispatch` compares `AGENT_DISPATCH_SECRET` / `CRON_SECRET` with `crypto.timingSafeEqual` via the `safeEqual(a, b)` helper. **Never** revert to `===` — it leaks bytes through timing.

The legacy shared-secret path trusts `body.tenantId` by design (internal channel webhooks). Rotate `AGENT_DISPATCH_SECRET` quarterly; a leak = any-tenant impersonation. API-key-authed callers on the same route are pinned to the key's tenant and any `body.tenantId` mismatch returns 403.

## Invoice rendering — JSX only

`apps/app/app/invoice/[token]/page.tsx` renders `<InvoiceHtml {...props} qrDataUrl={…} />` directly as JSX. **Never** reintroduce `dangerouslySetInnerHTML` for invoice content — tenant-controlled fields (toName, toEmail, line item descriptions, brand fields) must flow through React's auto-escape. `renderInvoiceQrDataUrl()` in `@sendero/invoicing` exists so the page doesn't need the qrcode dep.

`renderInvoiceHtml()` (the string form) is still exported for email / PDF host pages. Its raw `<title>${invoice.number}</title>` interpolation is escaped via `escapeHtml()` defense-in-depth — keep the escape if the template expands.

## UI sizing: px for layout, rem for type

`apps/app/globals.css` sets `html { font-size: 13px }`. Rem-based layout widths misbehave as a result: `14.5rem` = 188.5px, not 232px.

- **Layout-critical** (sidebar widths, card max-widths, fixed offsets) → **px**. See `SIDEBAR_WIDTH = '232px'` in `apps/app/components/ui/sidebar.tsx`.
- **Visual rhythm** (font-size, line-height, text spacing) → **rem** so it composes with the 13px root.
- Design specs from Figma / Claude Design quote px — honor them literally.

## Pre-commit migration lint

`lefthook.yml → pre-commit → migration-lint` runs `scripts/check-prisma-migrations.ts` against staged `packages/database/prisma/migrations/*/migration.sql`:

- **BLOCKS:** `ALTER TYPE ADD VALUE 'x'` combined with a same-file reference to `'x'` (breaks on PG <12 / tx-wrapped migrations).
- **WARNS:** `CREATE INDEX` without `CONCURRENTLY`, `ADD COLUMN NOT NULL` without `DEFAULT`.
- Override: `SKIP_MIGRATION_CHECK=1 git commit` (document why in the commit message).

Prisma on Postgres does **not** wrap migrations in a transaction by default, so isolated `ALTER TYPE ADD VALUE` statements are safe. The lint protects against the combined-pattern footgun for future migrations.
