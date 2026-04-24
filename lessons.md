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
