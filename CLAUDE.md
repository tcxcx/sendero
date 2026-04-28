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

## SenderoStamps deployment runbook (Circle SCP, Arc-Testnet)

Live contract: `0xcc0fa83535675a856d773cfbc71232c3d7b71a03` (proxy) → `0xCCf28A443e35F8bD982b8E8651bE9f6caFEd4672` (thirdweb TokenERC1155 impl). Deployed via Circle's pre-audited ERC-1155 template (`aea21da6-0aa2-4971-9a1a-5098842b1248`). Auto-routes through Circle Gas Station — gas paid in fiat by Sendero, not from treasury USDC.

**Re-deploys + new envs MUST run all four scripts in order. Skipping the event-monitor + webhook steps means mints fire but the indexer never learns about them — empty `/dashboard/stamps`, no OG previews, no return-for-service loop.**

```
1. bun scripts/deploy-stamps-template.ts                    # POST template, get contractId
2. CIRCLE_TX_ID=<id> bun scripts/check-stamps-deploy.ts --watch  # poll until COMPLETE
3. CIRCLE_CONTRACT_ID=<id> bun scripts/get-stamps-contract.ts    # read proxy address
4. SENDERO_STAMPS_ADDRESS=<addr> bun scripts/register-stamps-event-monitor.ts  # 4 monitors
5. bun scripts/verify-deployments.ts                              # audit Arcscan verification
```

After step 4: register the receiver URL in Circle Console once per env. Circle Event Monitors fire to **all** webhook URLs registered project-wide:

| Env | Webhook URL to register in Circle Console → Webhooks → Add a webhook |
|---|---|
| Production | `https://<production-app-host>/api/webhooks/circle/events` |
| Preview (optional) | branch-stable alias, e.g. `https://sendero-arc-web-git-<branch>-tcxcxs-projects.vercel.app/api/webhooks/circle/events` |
| Development | ngrok URL from `bun webhooks:ngrok`: `https://<subdomain>.ngrok-free.app/api/webhooks/circle/events` |

Distinct from the existing `/api/webhooks/circle` (wallet balance sync) — that one stays registered too.

Env contract: `SENDERO_STAMPS_ADDRESS`, `SENDERO_STAMPS_CONTRACT_ID`, `SENDERO_STAMPS_DEPLOY_BLOCK`, `SENDERO_STAMPS_DEPLOY_TX` — write to `.env.local` (root + `apps/app`) AND push to Vercel Production + Preview + Development.

ABI gotcha: thirdweb's `mintTo(address, uint256, string, uint256)` requires `tokenId == type(uint256).max` (auto-increment) OR an existing tokenId (`< nextTokenIdToMint`). Custom keccak tokenIds don't work — use sequential ids from the contract, idempotency from a Postgres `NftStamp` UNIQUE on `(kind, primaryKey)`.

### Contract verification model (Arcscan / Blockscout)

Every Sendero contract on Arc-Testnet is verified-equivalent — `bun scripts/verify-deployments.ts` audits all six in one shot and exits 1 on a real gap. Three verification shapes to know:

- **Full-source contracts** (SenderoGuestEscrow proxy, ERC-8004 registries, thirdweb TokenERC1155 impl) → `is_verified: true` on Arcscan, source matches deployed bytecode.
- **EIP-1167 minimal proxies** (the Circle SCP-deployed SenderoStamps proxy at `0xcc0f…1a03`) → `is_verified: false` is **expected and correct**. A minimal proxy is 45 bytes of bytecode that delegates every call to its impl; there is no source to verify. Arcscan auto-detects via `proxy_type: "eip1167"` + `implementations[0]` linking to the verified TokenERC1155 impl. The proxy's "Read/Write Contract" tab works through the impl's ABI. Treat as functionally verified.
- **ERC1967 proxies** (GuestEscrow, ERC-8004 registries) → both proxy AND impl must be verified separately; `is_verified: true` + `proxy_type: "eip1967"` + linked impl.

`scripts/verify-deployments.ts` encodes each contract's `expect` ('full-source' / 'eip1167-proxy' / 'erc1967-proxy') and pass/fails accordingly. Add new addresses there whenever a deploy lands so the audit stays comprehensive.

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
- **Testnet downgrade chokepoints — both must be wired or the flag silently doesn't apply:**
  - **Tool context propagation.** Every surface that calls `buildMcpCatalog` / runs the tool registry MUST set `ctx.caller = { scopes, keyType, effectiveKeyType }` from the resolved key. Without it, tools that gate on `ctx.caller.effectiveKeyType` (`confirm_booking`'s markup-override, `confirm_booking`'s meter-status routing) silently see `undefined` and fall through to default behavior. MCP path: `apps/app/app/api/mcp/_mcp-app.ts::buildRequestCatalog`. Dispatch path: `apps/app/app/api/agent/dispatch/route.ts` already does this via `apiKey` plumbing.
  - **`confirm_booking` meter status.** `ConfirmBookingDeps.recordMeter` requires a `status: 'paid' | 'sandbox'` arg — the handler computes it from `input.callerKeyType` (which factors in `effectiveKeyType` via the existing precedence chain) and **fails closed** to `'sandbox'` when caller info is absent. Was previously hardcoded to `'paid'` in default `dbDependencies()`, which broke the testnet downgrade for the booking-commission meter on **both** dispatch and MCP. Don't reintroduce a default `'paid'` — make callers be explicit.
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

### Slack user mapping

Slack-driven agent turns resolve `meter_events.userId` to the actual Slack
member who triggered the message via `apps/app/lib/slack-user-mapping.ts`.
Cached in the `SlackUserBinding` table by `(tenantId, teamId, slackUserId)`.
On cache miss, calls `slack.users.info` (requires the `users:read.email`
scope — added to `DEFAULT_BOT_SCOPES`), looks up the matching `User` row
by email within the tenant, or auto-provisions a `User` with `source =
'slack'` if no match. Provisional rows are claimed later when the same
email signs in via Clerk.

Never use `install.authedUserId` as a stand-in for the message author —
that's the workspace admin who installed the bot, not the active user.
The events route falls back to `authedUserId` only when the inbound
event has no `user.id` (system events, channel-renames, etc.).

### Slack webhook routes (apps/app)

All four Slack endpoints live on the Next.js app — Vercel Fluid Compute is the only runtime that can hit Prisma + Workflow DevKit. The CF Workers edge adapter was retired.

- `apps/app/app/api/webhooks/slack/events/route.ts` — Events API (`event_callback`, `app_mention`, DMs, `url_verification`, `tokens_revoked`, `app_uninstalled`). Verifies HMAC + 5-min replay window, looks up the install via `(teamId, enterpriseId)`, re-validates the resolved row matches the envelope, drops events for already-revoked installs, then defers `runSlackAgentTurn()` from `@sendero/slack/agent` past the 3-second ack via `after()` from `next/server`. Hot-path Redis hardening: dedup on `event_id` (1h SETNX) + single-flight thread lock on `(teamId, channelId, threadTs)`, both fail-open. 401 on signature failure, 404 on unknown install (NOT 200 — surfaces onboarding misconfig).
- `apps/app/app/api/webhooks/slack/interactions/route.ts` — Block Kit interactivity (`payload=…` form-urlencoded). Branches on `payload.type`: `block_actions` runs in `after()` (approval-card flow), `view_submission` MUST ack synchronously inside the 3s window because Slack reads the response body for modal lifecycle (close / show errors / push next), `view_closed` defers cleanup. The submission router is built per-request so handlers close over `install.tenantId` for cross-tenant gating. Approval-card flow (`sendero_approval.{approve,reject}`) flips `Booking.status`, swaps the card via `chat.update`, resumes any paused workflow run waiting on the booking.
- `apps/app/app/api/webhooks/slack/commands/route.ts` — slash commands (`/sendero help|status|note`). Same HMAC + replay + install + revocation gates. `/sendero note <trip-id>` opens the trip-note modal via `views.open` synchronously (trigger_id has a 3s TTL — can't defer past `after()`).
- `apps/app/app/api/webhooks/slack/oauth-callback/route.ts` — OAuth v2 install callback (Enterprise Grid aware). Verifies signed state (`verifySlackState`), exchanges `code` via `@sendero/slack::exchangeCode`, upserts `SlackInstall` keyed on `(enterpriseId, teamId)`. Reinstall clears `revokedAt = null` so the events route resumes dispatching.

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

## x402 edge hardening — scopes, signing, envelopes

`apps/app/app/api/agent/dispatch/route.ts` runs three controls on every turn, all shared via `@sendero/auth/dispatch-auth` so the edge worker can adopt them later:

- **Scopes**: `ResolvedApiKey.scopes` (populated in `apps/app/lib/api-key-auth.ts`) filters the tool registry via `filterToolsByScopes()` **before** the LLM sees it. Sandbox keys default to `['*']`; user-minted production keys default to the read-mostly `DEFAULT_PROD_SCOPES` stamped by the Clerk `apiKey.created` webhook into `tenant.metadata.apiKeyScopes[keyId]`.
- **Signing** (privileged only): `scopesRequireSignature()` triggers when the key has `settlement`, `treasury`, or `*`. Headers: `x-sendero-ts` + `x-sendero-nonce` + `x-sendero-sig = v1=<hex>`. HMAC key is `sha256(bearer)`. Upstash `SETNX EX 120s` dedupes nonces. Read-mostly scopes skip signing entirely — the hot path stays sub-second.
- **Response envelopes**: every dispatch reply carries `x-sendero-trace-id`, `x-sendero-meter-id`, `x-sendero-ts`, `x-sendero-sig` via `buildResponseHeaders()`. Customers verify on reception to detect replay of cached responses as paid.

Priority order when you add tools: update `toolToScope()` in `packages/auth/src/dispatch-auth.ts` (keeps OpenAPI categorizer in sync) and, if the tool moves USDC or reads PII, add it to `PRIVILEGED_TOOLS`. The docs page at `/docs/security` (source: `apps/docs/content/docs/security.mdx`) is the public recipe for customers.

## OpenAPI + agent DX

The Sendero tool surface ships as a single OpenAPI 3.1 doc generated from the canonical `toolList`:

- Spec: `POST /api/openapi.json` → route at `apps/app/app/api/openapi.json/route.ts` → generator at `packages/tools/src/openapi.ts` → served as `application/json` with CORS.
- Interactive viewer: `/api-viewer` in `apps/docs` renders `@scalar/api-reference-react` against the spec. It lives outside the Fumadocs shell because Scalar takes over the page body.
- Docs-as-markdown: any `/docs/*` URL gains a `.md` variant via `apps/docs/app/docs/[[...slug]].md/route.ts`. Serves raw MDX with frontmatter stripped. Mirrors Sherpa's "Trips LLM Friendly" pattern across the whole tree.
- Top-nav on docs: `apps/docs/app/docs/layout.tsx` → API Reference, MCP, Get API key (deep-links to `/dashboard/settings/api-keys` — Clerk-native, no form).
- `llms.txt` advertises every surface: `packages/llms/src/catalog.ts → buildSenderoDocsLlms` surfaces OpenAPI URL, Scalar viewer, self-serve key path, per-page `.md` pattern.

When you add a new tool, the OpenAPI doc + the MCP manifest + the docs sidebar all pick it up with no extra edits — the canonical registry is the single source of truth. Don't hand-maintain separate spec files.

## Canonical channel-render layer

`apps/app/lib/channel-render/` is the single source of truth for cross-channel message rendering. Every agent message — text, card, tool call, tool result, approval request, reasoning, sources — passes through the canonical `ChannelMessage` discriminated union before any surface paints it. One canonical input, four native outputs (operator web, Slack, WhatsApp, web traveler).

- **Type**: `apps/app/lib/channel-render/types.ts` exports `ChannelMessage = text | card | tool_invocation | tool_result | approval_request | reasoning | sources`. `ChannelCta.kind` covers `approve / reject / cancel / confirm_change / select_offer / confirm_cancel / open_link / tool_invoke / reply`. `ChannelRenderer<T>` is `async` (Promise-returning) so renderers can mint OG image URLs via HMAC-signed tokens.
- **Operator renderer (web)**: `operator.tsx` exhaustively switches on `kind` and emits AI Elements primitives (`Tool`, `Reasoning`, `MessageContent`) plus inline `CardBlock` / `ApprovalCard` / `SourcesBlock`. The compiler enforces switch completeness via the `exhaustive(_: never)` pattern.
- **Per-channel renderers (server-only)**: `channels/slack.ts`, `channels/whatsapp.ts`, `channels/web.ts`. Each maps the canonical kind to its native shape (Slack Block Kit, WhatsApp Cloud API interactive, web bubble JSON). Operator-only kinds (`reasoning`, raw `tool_invocation`) return `null` from traveler-side channels by design.
- **Barrel discipline**: `channel-render/index.ts` is **client-safe** — exports types + `renderForOperator` only. Per-channel renderers import `@sendero/slack` → `@slack/web-api` → `node:fs` and CANNOT be in the client bundle. Server code imports them directly: `import { renderForSlack } from '@/lib/channel-render/channels/slack'`. The `__tests__/bundle-leak.test.ts` static import-graph guard catches regressions.
- **Tests**: `apps/app/lib/channel-render/__tests__/` — exhaustive operator coverage + Slack/WhatsApp/Web snapshot tests + the bundle-leak guard. Run via `bun test`.

When adding a new ChannelMessage kind: extend the union in `types.ts`, add a case in `operator.tsx`'s switch, add a case in each `channels/*.ts` (return `null` if intentionally not relayed), update `__fixtures__/messages.ts`, write the snapshot tests. The compiler will refuse to build until all four switches handle the new kind.

## Channel-send orchestrators

Apps composes; packages don't import back. The dependency direction stays clean by routing through `apps/app/lib/channel-send/`:

```
apps caller
  ├─ const rendered = await renderForSlack(channelMsg)      // canonical → native
  └─ await sendBlocks({ client, channel, text, blocks })    // package primitive
```

- **Slack orchestrator**: `apps/app/lib/channel-send/slack.ts` — composes `renderForSlack` with `createSlackClient` + `sendBlocks` (both from `@sendero/slack/send`).
- **WhatsApp orchestrator**: `apps/app/lib/channel-send/whatsapp.ts` — composes `renderForWhatsApp` with `WhatsAppClient.send` (added to `packages/whatsapp/src/client.ts` for this purpose).
- **Public surface**: `apps/app/lib/channel-send/index.ts`.
- **Returns** `{ sent: false, reason: 'kind-not-relayed-to-X' }` when the renderer returns `null`, plus surface-specific reasons for missing install fields (`'install-missing-phone-number-id'`, `'access-token-unavailable'`).
- **Tests**: `apps/app/lib/channel-send/__tests__/` — mocked `@sendero/slack` + `@sendero/whatsapp` boundaries via `bun:test`'s `mock.module`.

The package primitives (`sendBlocks`, `WhatsAppClient.send`) take **already-rendered native payloads** — they don't see `ChannelMessage`. That's how the apps/app → packages dependency direction is enforced by construction.

## Operator agent chat surface

`/dashboard/agent-chat` is the operator-facing AI Elements test bench. It exclusively renders messages through the canonical channel-render layer, so the operator preview shows what the traveler will receive on whatever channel they use.

- **Page**: `apps/app/app/(app)/dashboard/agent-chat/page.tsx` (server) + `agent-chat-client.tsx` (client). Mounts `Conversation`, `Message`, `PromptInput` from `apps/app/components/ai-elements/` plus `Persona` (Rive halo variant) and the Sendero-custom `AgentPersona` (motion-driven brand mark) side-by-side in the chat header.
- **Persona state mapping**: `useChat`'s `status` (`submitted | streaming | error | ready`) → `PersonaState` (`thinking | speaking | asleep | idle/listening`). When the agent starts streaming, both Personas animate.
- **Backend**: `POST /api/agent/chat` — streaming sibling of `/api/agent/dispatch`. Three auth modes: API key, `AGENT_DISPATCH_SECRET`/`CRON_SECRET` shared secret, **OR Clerk session cookies** (operator-side use case). All three resolve `tenantId + userId` server-side and pass through the same `agent-auth` cap/meter/scope plumbing.
- **Cap + meter behavior is identical** to dispatch via the shared `apps/app/lib/agent-auth.ts` helpers (`makeCapStore`, `makeMeterStore`, `resolveSegment`, `buildPlanOverrides`, `preflight`, `buildIdempotencyKey`). One `MeterEvent` per turn, idempotent on `turnId`. Sandbox keys still skip `NanopayBatch`.
- **Model resolution**: `apps/app/lib/agent-models.ts::resolveDirectModel ?? resolveModel`. Streaming routes prefer **direct providers first** (Vertex when `GOOGLE_CLOUD_PROJECT` set → Gemini API → Anthropic → OpenAI) because in-band gateway errors arrive as data events and can't be caught for retry. Vertex direct is the canonical path; gateway is the fallback.
- **Streaming protocol**: `streamText` → `result.toUIMessageStreamResponse()`. Client maps `UIMessage.parts` (text, reasoning, source-url, tool-*) to `ChannelMessage[]` via `uiMessageToChannelMessages` for `renderForOperator`.

Don't touch `/dashboard/console` — it still ships `MetaInboxLive` and is the production operator surface. `/dashboard/agent-chat` is the next-gen test bench.

## Satori share-image generator

Single source of truth for cross-channel share images. When a tool's `share` payload has no explicit `imageUrl`, every channel falls back to the same Satori-generated card — Slack `image` block, WhatsApp `image+caption`, web `card.imageUrl`, and the email `<img>` at the top of the body.

- **Generator route**: `apps/app/app/api/og/share/route.tsx` — Edge runtime `ImageResponse`, Satori-rendered. Public (in the `proxy.ts` `isPublicRoute` allowlist) so Slack/WhatsApp/email unfurl bots can fetch without auth. **HMAC token signature is the integrity gate, not Clerk auth.** Falls back to a generic Sendero card on any verify failure so unfurl bots never see 4xx.
- **Card layout**: `apps/app/lib/og/share-card.tsx` — pure JSX-for-Satori. Brand palette matches `apps/app/app/stamps/[tokenId]/opengraph-image.tsx` (parchment + vermillion + midnight). Title scales by length; max 3 bullets; optional CTA pill; right-edge accent bar.
- **URL builder**: `apps/app/lib/og/share-url.ts::buildShareImageUrl(share, baseUrl?)`. HMAC-SHA256 via Web Crypto + `INVOICE_SIGNING_SECRET` (re-uses the existing key — rotation cost is bounded by the SignedSharePayload TTL handling). Returns `null` when secret unset so dev falls through cleanly.
- **Channel renderers** call `buildShareImageUrl(msg.share)` to fill `imageUrl` when not provided. Tools that already emit explicit `imageUrl` (e.g. `export_route_map`'s static-map URL) keep that; the OG generator only fills the gap.
- **Email**: `packages/notifications/src/share-template.ts::renderFromShare(share)` is the canonical share-email template. `notifier().sendShareCard()` is the Resend wrapper. Embeds the OG image at 600×315 above the headline.
- **Tests**: `apps/app/lib/og/__tests__/share-url.test.ts` — HMAC roundtrip, payload tamper, signature tamper, wrong-secret rejection, malformed token, secret-unset fail-soft, weak-secret rejection.

The canonical `share` contract: any tool can return a `share` block on `tool_result` (`{ title, body, bullets, primaryCta, secondaryCtas, imageUrl? }`). That single shape renders as a Slack block kit card, a WhatsApp interactive message, an email body card, and a web card. **If a field matters to the UX, it lives in `share` — never hard-coded in one adapter.**

## Wedge findings (a16z + YC RFS, applied)

Strategic synthesis after reviewing a16z Speedrun's "Come for the Agent, Stay for the Network" thesis (Speedrun 2026) + YC Summer 2026 RFS. Re-read this when scoping any new product surface — the network is the moat, every decision should compound it.

The expanded template is in `BUILD_VERTICAL_AI_AGENT.md` (root); this section is the Sendero-specific applied version.

**Six-precondition self-test for travel ops: 5.5/6.** ✅ Fragmented supply (Duffel aggregates 100s carriers/hotels), ✅ offline suppliers (corporate rate negotiations are still phone/email/PDF), ✅ opaque pricing (corporate fares vs published, dynamic surge, ancillary fees), ✅ frequent purchases (corporate travel = monthly+ per company), ✅ different SKUs (every flight, every hotel night, every ground leg), ⚠️ commoditized (Hyatt night = Hyatt night; SFO→LHR direct at 16:00 isn't fully fungible). **Travel ops clears the framework — agent-procurement-network economics apply.**

What Sendero already executes (don't re-invent):
- **Agent wedge**: `book_flight`, `search_flights`, `hold`, `book_stay`, `settle_*` end-to-end, no human-in-the-loop. Shipped.
- **Multi-channel surface**: Slack + WhatsApp + MCP + web + email. One `runAgentTurn` engine, channel-shaped wrappers at the edges.
- **% of revenue model**: take-rate on confirm_booking (`packages/billing/src/pricing.ts` 50bps default) + nanopay margin per tool call. Two-leg: take-rate + nanopay defends each leg against the other being commoditized.
- **Settlement rail differentiator**: USDC on Arc with on-chain audit trail. Not in a16z's framework — a16z's portfolio companies (Heavi, Vereda) settle in fiat. Sendero's auditable network effect is differentiated for regulated-industry TMCs (financial services, healthcare, public sector).
- **Tier 2 GTM (co-branded resale)**: per-tenant install URL `/install/slack?tenant=<slug>` lets a tenant share Sendero with their corporate customers without white-label friction. Bot is "Sendero" in workspace; tenant owns the dashboard relationship + billing. Stage 1 of the multi-tenant channel platform plan.

**What's missing — the "Stay for the Network" half (priority order):**

1. **Pricing benchmark surface** (~1 week CC, low risk). Per-booking, log every `search_flights` result set, picked offer, and supplier rate. Per-tenant view: "Your SFO→LHR cost was $1,820. Median across N platform bookings on this route this month: $1,640. You paid 11% above median." Cross-tenant aggregation gated by k-anonymity (n≥20). This is the first network hook — without it, every Sendero install is an island. Required before Stage 2/3 of the channel platform pays off.
2. **Demand aggregation MVP** (~3 weeks CC, medium risk). TMC dashboard surfacing "Your N corporate clients booked X trips on these top 5 routes — want to request a corporate rate?" Manual negotiation tooling first; automation later. Higher ceiling than #1; needs supplier engagement to prove value.
3. **Direct supplier rates** (multi-quarter, high risk). Sendero negotiates with one airline + two hotel chains for Sendero-only corporate rates. Suppliers compete to be on the network. The actual a16z moat. Heavy GTM lift — only after #1 and #2 prove out.

**Stage 2 (tenant brand fields) and Stage 3 (full per-tenant SlackApp + WhatsAppApp model with KMS) of the channel platform plan support the network-effect thesis but don't BUILD it.** They're distribution infrastructure — necessary scaffolding for resale-led GTM. The pricing benchmark surface above is what creates the lock-in once the distribution exists.

**Reframing implications:**

- Lead with "Stay for the Network" in TMC-facing copy. Today the README leads with the agent surface ("AI travel agent with on-chain settlement"). The right pitch at scale is "the more TMCs use Sendero, the better every TMC's pricing gets."
- The `/install/slack?tenant=` flow IS the entry point to the network. Tell that story explicitly: install → contribute to network → benefit from network insights.
- For regulated-industry TMCs (finserv, healthcare, public sector), lead with the auditable-settlement-rail moat, not the agent surface.

**Anti-patterns to refuse:**

- ❌ Pricing per seat as the primary axis — caps Sendero at HR-budget logic; commoditizes against Concur/Navan
- ❌ Building a chatbot bolted onto the existing booking surface — Sendero is agent-native, not copilot
- ❌ Internal-only tools that don't generate buyer × supplier graph data
- ❌ Spending engineering cycles on Stage 3 (full white-label) before a TMC has signed for it — speculative platform engineering before customer demand

**YC RFS items Sendero already maps to (for fundraising / messaging):**

- "AI-Native Service Companies" (Alströmer): Sendero IS this for travel ops. We don't sell software; the TMC sells the trip getting booked.
- "Software for Agents" (Epstein): MCP server, OpenAPI surface, `/llms.txt`, ERC-8004 agent identity. Sendero is a first-class citizen for agent consumers.
- "AI Operating System for Companies" (Diana Hu): Sendero is the closed loop for corporate travel ops — agent watches trips → flags policy violations → routes to approver → settles → audits.
- "Company Brain" (Blomfield): adjacent — per-tenant travel policy + cap exceptions + traveler memory. Productizable as a future surface.

**Founder forcing questions to revisit quarterly:**

1. What's the smallest bundle of our buyers that moves an airline's price by 5%? (If we can't answer, we don't have demand-side leverage yet.)
2. In 12 months, when a TMC operator hears "Sendero", what's the one sentence they say? (If it's "they have a chatbot", we've failed.)
3. If Sendero disappeared tomorrow, who panics first — corporate buyers, suppliers, or TMC operators? (We want all three. If only one, we've built a feature, not a platform.)
4. What's the single fastest way Sendero loses its moat? (Likely: a hyperscaler ships a generic travel agent in their API. Defense: depth of vertical integration + on-chain settlement audit story.)

## Slack channel hardening — dedup, locks, lifecycle, step-streaming

The Slack inbound path runs four hot-path safety controls before dispatch:

- **Event-id dedup** (`apps/app/lib/slack-dedup-lock.ts::claimSlackEvent`) — Redis SETNX on `<env>:slack:event:<event_id>` with 1h TTL. Catches Slack's retry-on-non-200 + rare duplicate-after-200 deliveries. Fail-open on Redis outage; the session-store turnId guard is a backstop.
- **Single-flight thread lock** (`acquireThreadLock` / `releaseThreadLock` in the same file) — Redis SETNX on `<env>:slack:lock:<subjectKey>` (90s TTL). Lua check-and-del release so a TTL'd-out lock taken by another instance isn't accidentally freed. Drops concurrent same-thread events with `{ ok: true, dropped: 'thread_busy' }`.
- **Subscribed-thread filter** (`apps/app/lib/slack-thread-subscription.ts`) — channel/group messages only trigger the agent when the bot was @-mentioned OR has previously replied in this thread. DMs and explicit mentions always respond. Marked-on-post via `markThreadSubscribed` in `slack-agent.ts` (24h TTL); checked at dispatch time. Fail-conservative on Redis outage (treat as not-subscribed → bot drops the follow-up).
- **Lifecycle (`SlackInstall.revokedAt`)** — `tokens_revoked` and `app_uninstalled` events stamp `revokedAt = now()`; the events / interactions / commands routes drop traffic for revoked installs. OAuth callback clears `revokedAt = null` on reinstall. Manifest subscribes both lifecycle events (`/dashboard/channels/slack/manifest`).

**Step-based streaming.** `runAgentTurn` accepts an optional `onStepFinish` callback (`packages/agent/src/run.ts`) that fires after each AI SDK step (text gen or tool call). The Slack adapter installs the hook to edit the `_Thinking…_` placeholder between tool calls — `🔎 Searching flights…` → `🔎 Searching flights, Searching hotels…` → final answer. `renderStepStatus` + `toolNameToVerb` mapping in `slack-agent.ts` covers the high-traffic Sendero tools; unknown tools fall through readably as `Running \`<name>\``. Same-content edits are deduped via a `lastStatus` cache — Slack's chat.update Tier 3 limit (50/min) is comfortably under-used. This is *step* streaming, not token streaming. True per-token would require swapping `generateText` → `streamText` in the engine (cross-cutting with `dispatch` + `chat`); intentionally deferred.

## Slack slash commands + view modals

`/sendero help | status <trip-id> | note <trip-id>` — first three subcommands. `SlashCommandRouter` in `@sendero/slack` (`packages/slack/src/slash-commands.ts`) keys on `(command, subcommand)` with fallback support; `parseSlashCommandBody` decodes the URL-encoded payload. Unknown installs respond with a friendly `response_type: 'ephemeral'` install-prompt instead of 404 — better DX in resold workspaces that haven't installed Sendero yet.

`ViewRouter` in the same package keys on `view.callback_id` for `view_submission` + `view_closed` payloads. **Submission MUST ack synchronously** — Slack reads the response body for modal lifecycle (close / errors / push). The interactions route builds a per-request submission router so handlers close over `install.tenantId`. Closed-handler router can be a singleton (no install scope needed).

**Cross-tenant gate is load-bearing.** `private_metadata` is opaque to Slack — opener stuffs `{tripId, channelId, threadTs}` JSON in, Slack passes it back unchanged. The trip-note submit handler MUST verify `trip.tenantId === context.tenantId` AND use that tenant id in the WHERE clause of the write — without both, any Slack user could read/write across tenants by typing a different tenant's tripId into the slash command. The "trip not found" error string is the same on missing-trip vs cross-tenant so existence isn't leaked. Pattern lives in `apps/app/lib/slack-views/trip-note.ts::handleTripNoteSubmission` — copy this shape for every new view handler.

**Atomic JSON append.** `Trip.events` is a Json column with append-only semantics. `handleTripNoteSubmission` uses `prisma.$executeRaw` with Postgres `||` jsonb append:

```sql
UPDATE trips SET events = COALESCE(events, '[]'::jsonb) || $1::jsonb
WHERE id = $2 AND "tenantId" = $3;
```

Atomic in Postgres, concurrent-safe (no read-then-write race that could lose notes). Tenant id is double-bound in the WHERE so a TOCTOU between `findUnique` and the update can't write across tenants.

## WhatsApp inbound hardening — replay window + dedup

Meta's `x-hub-signature-256` only signs the body, not a timestamp, so freshness gating happens per-message off the server-stamped `messages[].timestamp`. Two controls in the route (`apps/app/app/api/webhooks/whatsapp/route.ts`):

- **Replay window** (`apps/app/lib/whatsapp-dedup.ts::isWithinReplayWindow`) — pure function, ±5 min around now. Pure-function so the route can drop stale messages without a Redis round-trip.
- **Per-wamid dedup** (`claimWhatsAppMessage` in the same file) — Redis SETNX on `<env>:wa:msg:<wamid>` with 1h TTL. Same fail-open posture as Slack.

Bad-signature requests still get logged to `WhatsAppWebhookEvent` for forensics — nobody hits our public endpoint with a wrong sig by accident.

## WhatsApp audit logs + observability

Three append-mostly tables, all under tenant scoping:

- **`WhatsAppWebhookEvent`** (`packages/database/prisma/migrations/20260427193912_whatsapp_audit_logs`) — one row per inbound webhook delivery: signature_valid, replay_window_ok, normalized counts (messages / identityChanges / statusUpdates / droppedReplay / droppedDuplicate / dispatched), duration_ms, traceId, optional rawEnvelope (off by default). Inserted post-200 via `after()` so audit can never extend Meta's ack window.
- **`WhatsAppOutboundMessage`** (same migration) — one row per send, UNIQUE on `wamid`. Source label (`'agent_reply' | 'otp' | 'security_alert' | …`) separates handlers. Updated by the inbound `messages.statuses` webhook handler with per-status timestamps (`deliveredAt` / `readAt` / `failedAt`) + `failureReason`.
- **`WhatsAppApiLog`** (`20260427201429_whatsapp_api_log`) — one row per outbound API call to Kapso or Meta: status_code, duration_ms, ok, errorMessage, method, endpoint *shape* (path params replaced with `{id}` so rows aggregate per endpoint pattern). Includes failed health pings + 429-throttled sends + network errors (status_code=0).

**Audit hooks.** `WhatsAppClient` config accepts `onSent` (post-success per send) and `onApiCall` (per request attempt, including each retry). Both are truly fire-and-forget — `void Promise.resolve().then(...)` so a downed audit DB never extends send latency on the wire-edge. Writers in `apps/app/lib/whatsapp-audit.ts` (`logOutboundMessage`, `logApiCall`, `logKapsoCall`, `logMetaCall`, `reconcileOutboundStatus`) all swallow Prisma errors fail-soft.

**Operator UI.** `/dashboard/channels/whatsapp/inbox` shows three stacked tables (inbound deliveries / outbound API calls / outbound messages) with empty states, relative-time, redacted recipients, status badges. `apps/app/app/(app)/dashboard/channels/whatsapp/layout.tsx` mounts a pill-tab nav (`WhatsappChannelNav`) so every WhatsApp sub-route inherits **Workspace** + **Inbox** tabs. Active state from `usePathname()`; `router.push` on tab change so URLs stay shareable for support tickets. Add new tabs by extending the `TABS` const in `whatsapp-channel-nav.tsx`.

## Observability + prompt management — Langfuse

`@sendero/langfuse` is the ONLY package that imports `@langfuse/*` directly. All surfaces (engine, app-api, slack, whatsapp, mcp, workflows, ocr) import primitives from there. `apps/app/instrumentation.ts` boots `LangfuseSpanProcessor` on Node.js startup so every AI-SDK call (`generateText`, `streamText`, `generateObject`) emits a Langfuse generation automatically.

### Env vars (all envs)

```
LANGFUSE_SECRET_KEY=     # Langfuse project secret key (sensitive)
LANGFUSE_PUBLIC_KEY=     # Langfuse project public key
LANGFUSE_BASE_URL=https://us.cloud.langfuse.com
LANGFUSE_PROMPT_MANAGEMENT=false   # flip to true to pull persona slabs from Langfuse
LANGFUSE_EVALUATORS=false          # flip to true to fire 4 LLM-judges per turn (gpt-4.1-nano)
LANGFUSE_MCP_AUTH=       # base64(public:secret) — consumed by .mcp.json for in-IDE prompt CRUD
```

`LANGFUSE_MCP_AUTH` is stored on Vercel for production / preview / development; `vercel env pull .env.local` brings it down so the Langfuse MCP server in `.mcp.json` works without per-dev setup. Compute manually with `echo -n "$LANGFUSE_PUBLIC_KEY:$LANGFUSE_SECRET_KEY" | base64`.

### Persona resolution (system prompts)

Sendero's persona is composed in **`apps/app/lib/agent-persona.ts`** from two halves:

- `sendero-soul` (Langfuse, with `packages/agent/src/soul.ts::SENDERO_SOUL` as fallback) — the canonical voice contract.
- A surface-specific routing-rules slab — `sendero-chat-routing-rules`, `sendero-dispatch-routing-rules`, `sendero-web-chat-rules`, or `sendero-slack-rules`.

Each surface calls `buildAgentPersona(kind, locale)` (or `buildSlackPersonaWithContext` for Slack, which interleaves a dynamic tenant/channel preamble between SOUL and rules). Variables wired in: `{{locale_lang}}` everywhere, `{{today}}` on web rules. `localeSteering()` in `packages/agent/src/prompt.ts` runs in the `buildSystemPrompt` assembler **after** the Langfuse-managed persona lands — locale detection stays code-side.

When `LANGFUSE_PROMPT_MANAGEMENT=false` the helper returns the hardcoded fallback strings with zero network calls. Production toggles the flag on; fallbacks remain in code as the safety net for Langfuse outages.

**Scripts:**
- `bun langfuse:prompts:seed` — re-seed all four routing prompts from code fallbacks (versions increment on Langfuse).
- `bun langfuse:prompts:seed-slack` — re-seed `sendero-slack-rules`.
- `bun langfuse:prompts:pull` — write live prompts to `scripts/langfuse-prompts.snapshot.json` (committed; PRs that touch prompts must commit the snapshot diff).
- `bun langfuse:prompts:diff` — compare snapshot vs live, exit 1 on drift.

### Tracing

`runAgentTurn` (`packages/agent/src/run.ts`) wraps every turn in `traceAgent(agentType, metadata, fn)`. Channel-aware `agentType`: `sendero-conversation | sendero-slack | sendero-whatsapp | sendero-mcp`. After the meter write, fire-and-forget `scoreLatency + scoreCost + scoreToolSuccess + evaluateTrace + flushLangfuse`. Direct `streamText` callers (`/api/agent/chat`, `/api/chat`, `/api/inbox/rewrite`, stamp workflows, OCR) pass `experimental_telemetry: aiTelemetryConfig(functionId, metadata)` so spans land in the same project.

**Trace ID flows server → client → server** via `messageMetadata({ part: 'start' })` in `/api/agent/chat`'s stream response. The agent-chat client reads `message.metadata.senderoTraceId` and surfaces it to the operator thumbs UI.

### Scoring + feedback

- Engine fires per turn: `scoreLatency`, `scoreCost`, `scoreToolSuccess`, `evaluateTrace` (when enabled).
- Operator thumbs (`/dashboard/agent-chat`) → `POST /api/agent/feedback` → `scoreGeneration(traceId, 'up' | 'down')`.
- Slack HITL approval/reject (`apps/app/app/api/webhooks/slack/interactions/route.ts`) reads `Booking.metadata.traceId` (set by `confirm_booking` via `getActiveTraceId()`) → `scoreGeneration(traceId, 'approved' | 'rejected')`.

### Datasets + regression

`sendero-golden-turns` dataset holds 8 representative agent inputs (search / hold / refund / policy-block / locale-spanish / multi-turn / document-scan / treasury-check). `bun langfuse:regression` (script: `scripts/langfuse-run-regression.ts`) pulls each item, runs it through the LIVE persona prompts via `gpt-4.1-nano`, scores `rule-match` (mustMention / mustNotMention) plus the four LLM-judges, and links each trace to a dataset run. No tools wired in the runner — this is a prompt-quality smoke, not full-stack integration. Filter with `--scenario <name>`; name a run with `--run-name nightly-YYYY-MM-DD`.

`bun langfuse:dataset:seed` re-creates the dataset (additive — items duplicate on re-run; prefer editing in the Langfuse UI thereafter).

### MCP server

`.mcp.json` registers `langfuse` as an HTTP MCP at `https://us.cloud.langfuse.com/api/public/mcp` with `Authorization: Basic ${LANGFUSE_MCP_AUTH}`. Restart Claude Code after first env-pull to load the server. Five tools available: `getPrompt`, `listPrompts`, `createTextPrompt`, `createChatPrompt`, `updatePromptLabels`. Use the `langfuse` skill (`.agents/skills/langfuse/SKILL.md`) for documentation-first workflows.

### When to use what

| Task | Reach for |
|---|---|
| Add a new system prompt | `bun langfuse:prompts:seed` (after editing fallback in `agent-persona.ts`) |
| Edit a live prompt without code change | Langfuse MCP `updatePromptLabels` or the UI; then `bun langfuse:prompts:pull` to commit snapshot |
| Detect prompt drift in a PR | `bun langfuse:prompts:diff` |
| Score human feedback on an agent reply | `scoreGeneration(traceId, 'up'|'down'|'approved'|'rejected')` |
| Score quality automatically | flip `LANGFUSE_EVALUATORS=true`, evaluators fire per turn |
| Smoke a prompt change against goldens | `bun langfuse:regression --scenario <name>` |
| Read the active trace inside a tool | `getActiveTraceId()` from `@sendero/langfuse` (returns undefined when no span) |
| Read prompts from the Anthropic skills system | the `/langfuse` skill — documentation-first, CLI-native |

## Mainnet cutover gating — distribution surfaces

The four agent-distribution surfaces — Claude Code plugin, skills,
MCP server, and `@sendero/cli` — are **built and committed but
intentionally not published to public registries** until the day Arc
mainnet ships. The reasons:

1. **Surface area changes during cutover.** Skill copy will get tuned
   based on real agent regression scores from Langfuse. The CLI's
   `tools call` shape will tighten when `effectiveKeyType` flips off
   the testnet-beta downgrade. Publishing now would burn a version
   number on every tweak.

2. **Plan-tier limits are not final.** Free $100 / Basic $2,000 / Pro
   $20,000 caps are placeholder values for testnet beta. Mainnet GA
   may move them; we don't want a published CLI whose error messages
   reference numbers that no longer match reality.

3. **Marketplace listings are signals.** A `/plugin install
   sendero@sendero` that lands during testnet beta sends the wrong
   signal — buyers assume mainnet means production, not "settlements
   land in test USDC." Hold the marketplace push for the mainnet
   announcement.

### What stays committed but unpublished today

- `packages/cli/` — runs locally via `bun run dev`. Source is final
  enough for development; do **not** `npm publish` until the mainnet
  flag flips.
- `apps/claude-code-plugin/` — installable via `claude --plugin-dir
  ./apps/claude-code-plugin`. Do **not** open a marketplace listing
  yet.
- `apps/claude-code-plugin/skills/` — seven skills authored
  (travel-booking, settlement, reconciliation, cap-management,
  audit-export, cross-channel, agent-identity). Copy is reasonable
  v0.1 but expects regression-suite tuning before lock-in.
- `apps/mcpb/` — the .mcpb bundle DOES ship today via GH Releases
  (Claude Desktop already has a prod-grade install path). Treat as
  the exception — it's a thin stdio→HTTP proxy that won't change
  shape during mainnet cutover.

### The cutover playbook (when Arc mainnet flips)

1. **CLI publish.**
   ```bash
   cd packages/cli && bun run build
   npm publish --access public
   ```
2. **Plugin marketplace.**
   - Add `marketplace.json` at repo root pointing at `apps/claude-code-plugin/`.
   - Push a tag (`plugin-v1.0.0`) → GH Actions release workflow
     packages the zip and uploads it to the GH Release.
   - Submit to the Anthropic plugin directory.
3. **MCP discovery.** Already live at `/api/mcp`. Promote `llms.txt`
   so directory crawlers see the production endpoint.
4. **Skills lock.** Run `bun langfuse:regression --scenario <each>`
   against the Pro-tier prompts; iterate copy until pass rate ≥ 90%.
   Then bump the plugin version to v1.0.0.
5. **Documentation freeze.** `apps/docs/content/docs/cli.mdx`,
   `skills.mdx`, and `installer.mdx` (currently absent) get authored
   in the cutover sprint and merged together.

Until that flag flips: every install instruction should say "clone
the repo + run locally" or "load via `--plugin-dir`," NEVER `npx
@sendero/cli@latest` or `/plugin install sendero@sendero`. Marketing
copy that promises the npm/marketplace flow is allowed (it's the
public roadmap), but install snippets users would actually run today
must use the source-loaded path.
