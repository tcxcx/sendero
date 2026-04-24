# Lessons

Design decisions worth preserving. Append, don't rewrite.

## Billing & pricing strategy (2026-04)

### The two revenue legs

Sendero has two independent revenue legs:

1. **SaaS MRR** — recurring subscription through Clerk Billing.
2. **Nanopayments** — per-call x402 settled on Arc. The agent's wallet pays per tool call (search, book, MCP). Continuous, consumption-based.

This split is the foundation of everything else. Once you see it, the trial model, the discount model, and the feature split between Clerk and our code all become obvious.

### Why discount nanopayments at higher plans

Paid tiers give a percentage off nanopayment unit prices and booking take rate (in basis points):

| Tier | Nanopayment off | Booking take-rate off |
|---|---|---|
| Free | 0% | 0% |
| Basic ($19/mo) | 15% | 5% |
| Pro ($60/mo) | 30% | 10% |
| Enterprise | 50% | 15% |

**Why this shape:**
- Paying SaaS MRR earns you unit-economics on usage. That's the classic "committed spend" bargain applied to an agent-native catalog.
- Lowering take-rate at higher tiers rewards GMV-heavy customers (TMCs) who would otherwise negotiate custom deals — we default-price the relationship instead of quoting.
- Discount *in bps on the micro-USDC price*, not on the USD equivalent. Keeps math integer, composes with the segment catalog (consumer / agency / corporate / ai_agent).

### Monthly vs annual

Annual plans priced as a discounted monthly-equivalent rate billed yearly:

- Basic: $19/mo monthly or **$15/mo billed annually** ($180/yr, save $48)
- Pro: $60/mo monthly or **$50/mo billed annually** ($600/yr, save $120)
- Enterprise: $1,500/mo monthly or **$1,250/mo billed annually** ($15,000/yr, save $3,000) — internal list only
- Free: no annual option

**Clerk form mechanics** — Clerk's "Annual base fee" field is the *monthly rate when billed annually*, not the full-year total. Clerk validates `annualMonthlyUsd ≤ monthlyUsd` (the annual rate is a discount on the monthly rate). The annual charge the customer sees on checkout is `annualMonthlyUsd × 12`. Dashboard field label is misleading — read the validation rule, not the label.

**Why $15 and $50 (not exactly ×10 / 2-months-free):**
- Clean per-month numbers ($15, $50) read better than $15.83 or $49.17 in the Clerk form and on `<PricingTable />`.
- Both cleared 15%-off, which is plenty of incentive. Basic leans harder (21% off) to lower the commit bar on the entry tier.
- Uniform percentages matter less than clean list prices at small-volume price points. Save the optimization tax for enterprise quotes.

### Feature flags vs numeric limits — the split

Two different concepts, both needed. Put them in the right place:

- **Clerk Billing features** — boolean capability gates. `has({ feature })` returns yes/no. Examples: `additional_workspaces`, `production_api_keys`, `mcp_server_public`, `sso_saml`.
- **`@sendero/billing/plans` numeric fields** — how many, how much. Examples: `workspaceLimit: 5`, `productionApiKeyLimit: 3`, `monthlySpendCapCeilingMicro: $20k`.

**Why split them:**
- Clerk features are designed for yes/no checks. Modeling "3 API keys vs 25 API keys" as two separate features (`api_keys_3`, `api_keys_25`) is ugly and breaks if you add a fourth tier later.
- Our numeric fields are code-local, versioned, testable. A migration that changes the Basic cap ceiling from $2k to $3k is a one-line PR, not a dashboard operation.
- Discount bps also live in code, not Clerk. Clerk has a `nanopayment_discount` feature flag for UI presentation ("Discount: ON" badge), but the actual bps value is derived from the tier.

### Trials — use Clerk's native, don't roll your own

**Correction logged 2026-04:** Early draft proposed custom trial logic (track `tenant.createdAt + 14d`, synthesize a 'trial' tier in `currentOrgPlan()`). Wrong call. Clerk shipped no-card trials in **Oct 2025** ([changelog](https://clerk.com/changelog/2025-10-30-start-free-trials-without-payment-methods)).

**Correct setup:**
1. Clerk Dashboard → Billing Settings → toggle **"Require payment method for free trials" = OFF**.
2. On the Pro plan, set **Free trial = 14 days**.
3. `<PricingTable />` renders a "Start trial" button that works zero-friction, zero-card.
4. During trial, `has({ plan: 'pro' })` returns true → our existing `currentOrgPlan()` returns Pro → `buildPlanOverrides()` applies Pro discounts to MeterEvents automatically.
5. At trial end, `has({ plan: 'pro' })` flips to false → back to free → `<PlanTeaser />` shows upgrade wall.

**Why Pro, not Basic, as the trial tier:** the trial should reveal the ceiling, not a throttled middle. Letting users taste public MCP, custom webhooks, and audit export for 14 days makes the upgrade ask land.

**Why nanopayments still flow during trial:** they're leg 2 — independent of the Clerk subscription. The user's wallet already exists, the x402 calls already settle. Trial = skip SaaS, charge for usage. This is an unusually good trial shape: we earn during the trial, user builds habit, MRR ask post-trial is justified by what they already shipped.

**Lesson:** For any third-party product question, **verify against current docs before asserting**. I initially claimed Clerk trials required a card, which was true pre-Oct-2025 but false now. `claude-code-guide` agent took 60 seconds to verify. Always pay that cost.

### Enterprise is a private plan, not a public "$15k/yr" tier

Clerk requires numeric base fees on every plan — there's no "Contact sales" option in the dashboard. Options:

1. **Public with numbers** — Enterprise appears on `<PricingTable />` at $1,500/mo. Self-serve, transparent, no friction.
2. **Private with numbers** — Enterprise hidden from `<PricingTable />`. Sales assigns the plan via Clerk API after discovery. Our marketing copy still says "Custom · Contact sales".

Chose **private**. Three reasons:
1. Real enterprise deals negotiate SLA, settlement cadence, dedicated support — none of which fit self-serve checkout. Listing a price implies the price is the deal. It isn't.
2. Published prices anchor negotiations at the list — downward for big GMV customers (they'd pay more custom) and upward for strict budget buyers. Private pricing preserves price-discrimination flexibility.
3. The discovery call *is* the product at this price point. Skipping it forfeits procurement/compliance/integration context that decides whether the deal even fits.

The $1,500 / $1,250 numbers live in Clerk as the invoice baseline so a closed-at-list deal can be billed automatically. Deals that don't close at list get invoiced off-Clerk (NetSuite / Stripe direct) with the Clerk subscription only gating feature access.

Added `publiclyListed: boolean` to `PlanConfig` so code can query "is this tier in the public table" without re-reading the Clerk dashboard state.

### Supplier IP stays behind the abstraction layer

Hackathon/demo code tends to proudly name its flight supplier in every LLM prompt and MCP description ("Books real flights via X"). That's advertising the vendor, not the product. When we launch, the supplier is a swappable adapter — we don't want LLMs, judges, or copy-scraping competitors assuming the supplier is the moat.

**Rule:** no supplier brand name in any user-facing or LLM-facing surface. Marketing, llms.txt, MCP server description, agent personas, tool descriptions, docs, README — all neutral ("live flight inventory", "supplier network", "first-party supplier integrations"). Internal code (types, imports, env vars, migrations) keeps the real name. Tool *identifiers* (`confirm_ticketing` not `confirm_duffel`) also neutralize because they ship in the MCP catalog to external LLMs.

When adding a new supplier-facing integration, ask: "does this string reach a user or an LLM?" If yes, abstract it. If no, ship the real name.

### API keys — use Clerk's primitive, don't roll your own (correction logged)

Initial design called for a custom `ApiKey` Prisma model + HMAC-peppered lookup + mint/list/revoke UI. Second verification caught that **Clerk shipped native API keys GA on 2026-04-17** — seven days before we needed it. The custom plan would have been ~12 files of auth code we'd maintain forever. Clerk's `<APIKeys />` component + `clerkClient.apiKeys.verify()` collapses it to two files.

**What we kept in code:**
- `apps/app/lib/api-key-auth.ts::resolveTenantFromApiKey()` — extract bearer, verify via Clerk, map `subject` (org_xxx) → `tenant.clerkOrgId` → `tenantId`. Returns `{ keyType, effectiveKeyType, keyId, label }`.
- Dispatch + MCP route guards.
- Sandbox auto-mint in the `organization.created` webhook via `clerkClient.apiKeys.create({ claims: { type: 'sandbox' } })`. Clerk's UI doesn't expose the claims field, so user-minted keys are implicitly production. Our resolver reads `claims.type` to tag sandbox vs production at verify time.
- `MeterStatus.sandbox` enum value. `NanopayBatch` filters `status: 'paid'` only, so sandbox events are analytics-only and never touch USDC.
- Network-mode downgrade: when `env.isTestnetBeta()`, production keys resolve with `effectiveKeyType: 'sandbox'`. The on-record type stays production so promoting Arc mainnet is a one-env-flip change.

**What we did NOT build (because Clerk does it):**
- Key mint, hash, prefix, pepper, constant-time lookup.
- Create/list/revoke UI.
- Per-org revocation store and cache invalidation.
- Bearer-token parsing beyond `Authorization: Bearer …` extraction.
- A `prisma.apiKey` model.

**Meta-lesson (repeat of the Clerk trial one):** Before scaffolding auth/crypto primitives, check the auth provider's recent changelog. Clerk ships fast. The second WebFetch check was worth 10x the cost of building it the first way.

### API keys belong on the scale axis

Original feature matrix had workspaces, discounts, channel integrations. Missing: production API keys. For an agent-native platform where x402 is the primary distribution mechanism, **API keys are equivalent to seats on a traditional SaaS**. They're how external agents authenticate metered calls.

Tiered as:
- Free: **0** production keys (sandbox only, rate-limited, mock-settled)
- Basic: 3
- Pro: 25
- Enterprise: unlimited

Free keeping a sandbox key (not zero total) matters — the dev-to-customer funnel needs a key to hello-world against. Production keys being gated is the commercial ask.

### Clerk dashboard copy is not a spec

The Clerk dashboard field "Free trial: Delay billing new customers for a set number of days" *sounds* like it requires a card. It doesn't, post-Oct-2025. Reading dashboard UI copy as if it were normative docs is a failure mode. Check the docs, not the form label.

## Security sweep — pre-production review (2026-04)

A 12-finding security review caught several classes of bug the codebase would otherwise have shipped. The specific fixes are in `fix(security): close 8 critical findings from pre-prod review` — the patterns below are the durable takeaway.

### Prefer removing attack surface over patching it

The public invoice viewer originally round-tripped through `renderInvoiceHtml()` (returns a full `<!doctype>` string), extracted `<body>` via regex, and piped the result into `dangerouslySetInnerHTML`. Three seams that could leak tenant input as executable HTML.

The fix wasn't "add an `escapeHtml()` for each field" — it was "render `<InvoiceHtml {...props} />` as JSX directly". React already escapes every text node and attribute. Removing `dangerouslySetInnerHTML` eliminated the class, not a specific instance. The regex body-extraction went with it.

**Rule:** when a review flags "tenant input reaches dangerouslySetInnerHTML / eval / exec / raw SQL", check whether the dangerous primitive is needed at all. Usually it isn't — it was reached by accident, and the safe primitive was one refactor away. Patches decay. Removed surfaces stay removed.

### Webhook security is a stack: signature + freshness + dedup

The Circle webhook had signature verification (ECDSA) and dedup via `notificationId`. Still replay-able: if an attacker strips `notificationId` from a captured signed payload, the fallback `externalId = ${type}:${timestamp ?? Date.now()}` lets each replay through because `Date.now()` changes.

Fix: require `timestamp` after signature verify, reject if outside `[now − 10min, now + 5min]`, and make the externalId fallback deterministic (`${type}:${timestamp}` with no `Date.now()` branch).

**Rule:** every inbound webhook needs all three gates — signature (authenticity), freshness (replay), dedup (idempotency). Missing any one leaves a working exploit. The Slack/Stripe/Circle norm is a ~5–10 min freshness window; use it.

### Validate URL-interpolated headers before fetch

Circle's webhook took `x-circle-key-id` from the request, interpolated it into `https://api.circle.com/v2/notifications/publicKey/${keyId}`, and `fetch()`-ed. Attacker-controlled → SSRF + cache-growth DoS (one outbound fetch per forged request, plus an unbounded in-memory map).

Fix: strict UUID regex + bounded-LRU cache. Two lines, kills both vectors.

**Rule:** any attacker-controlled string that ends up inside a URL path, a SQL fragment, a shell command, a file path, or a fetch target needs a pattern gate at the boundary — even when the downstream system "probably" rejects bad input. Defense at the seam beats defense at the sink.

### Fail closed on quota enforcement

The apiKey quota enforcement had a silent fail-open: if `clerkClient.apiKeys.list()` returned null (transient error, missing API), we counted zero active keys and let the mint through. A free-tier org could mint unlimited production keys during any Clerk hiccup.

Fix: on list failure, revoke the freshly-minted key with a `list_api_error` reason and ask the user to retry. Also: include the new key in the count synthetically if Clerk's eventually-consistent list hasn't picked it up yet.

**Rule:** quota/gate logic that depends on an external API must fail closed. The cost of a transient "please retry" is trivially small compared to the class of "attacker exploits the outage window".

### OAuth state is a capability token

Our Slack OAuth state was `base64(JSON({ tenantId }))` — unsigned. An attacker can forge a state carrying any tenantId, trick a target into the install URL, and end up with the victim's Slack workspace bound to the attacker's tenant. Classic install-CSRF.

Fix: HMAC-SHA256 signed `payload.signature` wire format with a 10-min TTL and constant-time verify. Lives in `apps/app/lib/slack-oauth-state.ts`. Both construction site (onboarding page) and verification site (webhook) share the helper.

**Rule:** any state/nonce/continuation parameter that's round-tripped through an external service IS a capability token. Sign it with HMAC, bound it with `exp`, verify in constant time. `JSON.parse(base64url(param))` anywhere in the codebase is a red flag — grep for it quarterly.

### Constant-time compare for every secret header

Internal shared secrets (`AGENT_DISPATCH_SECRET`, `CRON_SECRET`) were compared with JavaScript `===`. String `===` short-circuits on the first mismatched character. Measuring N requests lets a remote attacker recover the secret byte-by-byte. Real, not theoretical.

Fix: `crypto.timingSafeEqual` via a `safeEqual(a, b)` helper that length-checks first (length leak is acceptable for ~32-byte secrets, content leak is not).

**Rule:** every secret-bearing header comparison uses `crypto.timingSafeEqual`. Add it to the checklist when introducing any shared-secret auth path.

### Env-scope any shared cache

Upstash Redis on Vercel Marketplace (`upstash-kv-orange-leaf`) is shared across Preview / Production / Development by default — same `KV_REST_API_URL` gets stamped on every Vercel scope. Without a namespace prefix, a Preview-tenant cache entry can short-circuit a Production verify (and vice versa).

Fix: every Redis key starts with `<envTag>:…` where `envTag` is derived from `VERCEL_ENV ?? NODE_ENV`. Applied to the API-key verify cache; the pattern is now the default for any shared-Redis consumer we add.

**Rule:** any shared infra (Redis, blob, queue) used in multiple Vercel scopes needs an env prefix on the key namespace. Small function, huge blast radius if skipped.

### Cache invalidation beats TTL-only expiry when the source emits events

Our verify-cache's 60s TTL bounded the stale-authz window on a revoked API key. Acceptable floor, but we already get `apiKey.revoked` webhooks from Clerk — the real stale window should be webhook RTT, not TTL.

Fix: maintain a reverse index `<env>:apikey:byid:<keyId>` → tokenHash at cache-write time, and have the revoke webhook call `invalidateApiKeyCache(keyId)` which drops both entries. TTL still protects against missed webhooks.

**Rule:** if the source of truth emits a lifecycle event (revoke/delete/update), subscribe to it and invalidate the cache. TTL is a safety net, not a primary mechanism. The reverse index trick (main cache keyed by token, lookup cache keyed by id) generalizes to any cache where the lifecycle event knows the id but not the raw key.

## Prisma migration safety (2026-04)

### `ALTER TYPE ADD VALUE` inside a Prisma migration is safe — here's why

The review flagged `ALTER TYPE "MeterStatus" ADD VALUE 'sandbox'` as potentially unsafe inside "a Prisma tx". Investigated: **it's fine on this stack**.

- **Prisma Migrate does NOT wrap Postgres migrations in a transaction by default.** Source: Prisma's own blog, "Prisma Migrate DX Primitives" — *"PostgreSQL users can opt-in to transactions by adding `BEGIN;` and `COMMIT;` to their schema migrations, though it's not the default."* Every single-file Postgres migration Prisma runs is already tx-free unless the migration explicitly opens one.
- **Postgres 12+ allows `ALTER TYPE ADD VALUE` inside a tx anyway**, with one constraint: the new value can't be referenced in the same tx. Neon runs PG 16. We don't reference `'sandbox'` in the migration — runtime code does. Safe.

The *actual* landmine is `ALTER TYPE ... ADD VALUE 'x'` + a same-file `'x'` reference (UPDATE / CHECK / etc.). That combo fails on PG <12 and on any tx-wrapped migration. Split into two migrations to avoid it.

### Pre-commit lint beats code review for migration footguns

Shipping a bad migration is a one-way door — rollback means a second migration + data reconciliation. Worth blocking at commit time, not at review time.

`scripts/check-prisma-migrations.ts` (wired via lefthook `pre-commit` as `migration-lint`):
- **BLOCKS:** `ALTER TYPE ADD VALUE 'x'` combined with a same-file reference to `'x'`.
- **WARNS:** `CREATE INDEX` without `CONCURRENTLY` (write-blocks large tables).
- **WARNS:** `ADD COLUMN NOT NULL` without `DEFAULT` (locks during backfill).

Override with `SKIP_MIGRATION_CHECK=1 git commit` when you genuinely know better (rare). Add new checks as we learn new footguns.

**Rule:** for any class of bug where rollback is expensive, write the static check once. Dev environment cost is ~30ms; future-review cost is 0.

## UI sizing: px vs rem isn't a style preference (2026-04)

`apps/app/globals.css` sets `html { font-size: 13px }` for dense dashboard typography. This silently breaks every rem-based layout measurement in the app:

- `14.5rem` you'd expect to be 232px resolves to **188.5px**.
- Sidebar pill designed for 232px overflowed the main card on every `/dashboard/*` route until we noticed the root font-size.

**Rule:** layout-critical widths (sidebar, card max-widths, fixed positioning offsets) use **px**. Visual-rhythm sizing (font-size, line-height, margin/padding at the text scale) stays **rem** so it composes with the 13px root. Design specs from tooling (Figma, Claude Design) quote px — honor them literally.

If you change `html { font-size }` again, grep for rem-based `SIDEBAR_WIDTH` / `MAX_WIDTH` / `HEADER_HEIGHT` constants and reconsider each.

## x402 edge hardening — three small controls, zero hot-path tax (2026-04)

x402 changes the attack economics. In a non-metered API, a stolen key = cost to us to revoke. In x402, every unrevoked second = real USDC bleeding out. The mental shift: **treat every leaked key as adversarial from second zero**, not as a future problem to fix.

### The three controls we shipped

1. **Scoped API keys.** Each key carries a capability set (`search`, `bookings`, `settlement`, `treasury`, …). Sandbox defaults to `['*']`, production to read-mostly (`search + compliance + trip_assistance + utilities + documents`). Settlement and treasury require explicit admin opt-in per key. Enforcement: filter the tool registry **before the LLM sees it** (`filterToolsByScopes` in `apps/app/lib/dispatch-scopes.ts`). A tool the model can't see can't be called via prompt injection.

2. **HMAC request signing on privileged tools only.** Keys with `settlement`/`treasury`/`*` must sign every dispatch with `x-sendero-ts` + `x-sendero-nonce` + `x-sendero-sig`. The shared HMAC key is `sha256(bearer_token)` — **no separate key distribution, no rotation dance**. Upstash `SETNX EX 120s` dedupes nonces. Read-mostly scopes stay bearer-only so the hot path keeps its sub-second budget. See `packages/auth/src/dispatch-auth.ts` + `apps/app/lib/dispatch-signing.ts`.

3. **Signed response envelopes on every reply.** Every `/api/agent/dispatch` response carries `x-sendero-trace-id`, `x-sendero-meter-id`, `x-sendero-ts`, `x-sendero-sig`. The signature covers the response body + meter-event id. Customers verify on reception → MITM replays of cached responses are exposed. The trace id is the universal support-ticket anchor.

### Principles worth reusing

- **Symmetric HMAC with the bearer-as-secret** beats the usual "give the customer two secrets" pattern. One key to manage, one to revoke. Derive the HMAC key as `sha256(bearer)` so logs accidentally emitting the HMAC key don't leak the Authorization header.
- **Scope enforcement at the registry level, not at the call site.** Filter the tools the LLM *can see* rather than checking at invocation time. Prompt-injection attacks stop being interesting.
- **Signing is a conditional tax, not a uniform one.** Hot-path scopes (search/compliance/assistance) stay bearer-only; only privileged scopes pay the ~200µs signature verify. The read side of x402 can ship Gemini-speed; the write side carries its own proof.
- **Every response has a trace id, not just errors.** We added `x-sendero-trace-id` universally. Costs 50µs, saves hours of "paste your request and I'll dig through logs" in support.

### Performance budget we held

| Path | Extra latency |
| --- | --- |
| Discovery (`/api/openapi.json`, `/llms.txt`, docs) | — |
| Hot path (`search`, `compliance`, `trip_assistance`, `utilities`) | ~0 |
| Privileged (`settlement`, `treasury`, `*`) | ~200µs sig verify + one Redis SETNX |
| Every response | Trace id + HMAC sign ~50µs |

We never hit Clerk on the hot path — Upstash caches key verify for 60s; scope check is a `Set.has`; signature verification happens at the Vercel function boundary before Node runtime allocates. Envelope signing reuses the same HMAC key we already computed.

### Rollout rule

New security controls must be **backwards-compatible by default** or adoption is zero. Existing integrations keep working because:
- Default scopes on new production keys are the old behavior (read-mostly). Admins opt into settlement.
- Signing is only *required* once a key has a privileged scope. Upgrading a key = upgrading its signing requirement at the same moment.

## Developer experience as a shipping discipline (2026-04)

Sherpa's docs UX is the B2B API bar. What made their integration fast wasn't their product — it was that **they let us integrate without talking to them**. Two hours from "here's the JSON" to a working client. That's the number to beat.

### What actually matters to integrators

1. **One URL that returns the full wire spec.** We ship `/api/openapi.json` generated from the canonical tool registry in `packages/tools/src/openapi.ts`. Can't drift from code — there's no hand-maintained spec.
2. **A self-service key-issuance path that's one click.** Sherpa gates behind a form + email thread. We ship Clerk-native API keys — signed-in user → `/dashboard/settings/api-keys` → production key in 10 seconds, no sales call.
3. **Every docs page available as plain markdown.** Sherpa has one LLM-friendly endpoint. We automate the pattern: append `.md` to any `/docs/*` URL. Route at `apps/docs/app/docs/[[...slug]].md/route.ts`.
4. **Progressive disclosure**. `/docs/api-reference` for the overview, `/api-viewer` for the interactive Scalar UI, `/api/openapi.json` for the raw spec. Readers pick depth.

### What the developer-experience skill recommended that stuck

- **Time-to-first-success is the metric.** If a developer can't call their first tool in under 5 minutes, you have a DX problem. Every friction point in the mint → sign → call flow should be measured in seconds, not minutes.
- **Pit of success.** The common path has to be the correct path. Our dispatch body is the same shape for every tool; service-account `userId` is derived from the key, so there's no way to accidentally impersonate a user.
- **Changelog as contract.** Every entry answers *what changed, why, what to do*. Internal refactors don't belong there.
- **Error messages as documentation.** `signature_required` errors cite `/docs/api-reference#request-signing` in the response body so a developer's first-contact with signing requirements is a link to the recipe, not a 401 with no context.

### The "vendor the spec" pattern

When Sherpa handed us their Swagger 2.0 JSON file, we dropped it into `packages/sendero-sherpa/openapi/sherpa-requirements-api-v3.json` and rewrote the client against it in one evening. **Vendoring the upstream spec inside the package that consumes it** is the right default for partner integrations: the JSON is authoritative, the TypeScript types are a convenience view, and diffing on upgrade is mechanical. Commit the JSON — the 94KB once is cheaper than the 2h it takes to rediscover a field name.
