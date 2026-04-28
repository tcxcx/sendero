# Post-Hackathon TODO — TaaS positioning, docs redesign, CLI roadmap

**Date assembled:** 2026-04-28
**Branch:** fix/marketing-waitlist-no-redirect
**Sources:** 6 parallel subagent investigations + main-thread implementation across this session.

This file is the consolidated artifact for everything we learned about positioning Sendero as a "Travel-as-a-Service" platform — what's built, what's missing, what to build next, and the docs redesign that beats Deframe.

---

## Table of contents

1. [Investigation: TaaS DX — three lenses](#1-investigation-taas-dx--three-lenses)
2. [Deframe docs deep-dive — patterns to adopt](#2-deframe-docs-deep-dive--patterns-to-adopt)
3. [desk-v1 Deframe integration — lessons learned](#3-desk-v1-deframe-integration--lessons-learned)
4. [Sendero docs current-state audit](#4-sendero-docs-current-state-audit)
5. [Docs redesign — even better than Deframe](#5-docs-redesign--even-better-than-deframe)
6. [CLI P0/P1 build status (this session)](#6-cli-p0p1-build-status-this-session)
7. [Backlog — ordered by integrator-experience leverage](#7-backlog--ordered-by-integrator-experience-leverage)

---

## 1. Investigation: TaaS DX — three lenses

Three subagents, each from a different lens.

### Lens 1: Code-side surface inventory (what exists today)

**TaaS-readiness: 6/10.**

#### Solid

- 83 public tools exposed via OpenAPI 3.1 at `/api/openapi.json` (auto-generated, never drifts)
- MCP JSON-RPC server at `/api/mcp` (protocol version `2024-11-05`)
- Scalar interactive viewer at `/docs/api-reference`
- Per-page markdown exports (`.md` suffix on any docs URL)
- `llms.txt` + `.well-known/llms.txt` for AI crawl
- Bearer-key auth with sandbox/production claim split
- Per-tenant Slack install URL `/install/slack?tenant=<slug>` (the one ISV-friendly hook)

#### Gaps

- **No outbound webhooks** to integrators. Svix env exists but no event catalog. Customers can't subscribe to `booking.confirmed` or `meter.rolled_up`.
- **WhatsApp install isn't ISV-friendly** — Kapso wizard redirects back to `app.sendero.travel`, not the integrator's domain.
- **No published SDKs** in any language. Customers consume raw REST + handle x402 themselves.
- **No "Integrator Quick Start"** doc positioning Sendero as a backend.
- **Channel install requires a pre-provisioned Sendero tenant** — integrators can't programmatically mint tenants per their customer.

### Lens 2: External integrator persona walkthrough

**Could-I-integrate-this: 6.5/10. TTHW: 8 min for first tool call, ~2 hours to wire into a product.**

#### Friction points (verbatim from the journey)

1. **Marketing CTA is "Start automating," not "Integrate Sendero into your product."** Sendero positions for agent hosts, not product teams.
2. **No code samples in Node/Python/Go.** Only bash/curl. The marketing site claims "TypeScript SDK auto-generated" but no link to the npm package.
3. **`/api/workflows/run` requires `SENDERO_INTERNAL_TOKEN`** — gated, requires sales/partnership conversation. Not self-serve.
4. **No documented pattern for "plug my WhatsApp into Sendero."** Sendero runs its own WhatsApp/Slack bots. To use Sendero as a backend with your own channels, you have to delegate via MCP/HTTP per-call, with no session continuity.
5. **x402 (EIP-3009 signatures) is the price of admission** for the dispatch endpoint. New devs see "USDC payment" and bounce.
6. **Sandbox vs production isn't visually obvious in keys** — both are `ak_xxx`. A leaked test key looks identical to a leaked prod key in logs.

### Lens 3: Competitive benchmark — top 5 patterns to steal

1. **Token-prefix split** (Stripe / Duffel) — `ak_test_*` vs `ak_live_*`. Visual diff in logs catches leaks at grep-time. Today's `keyType=sandbox/production` claim is server-side only.

2. **CLI commands `webhooks:listen` + `whatsapp:connect` + `slack:connect`** (Stripe + Twilio) — collapses channel onboarding from 6 steps to 1 command. Sendero just shipped P1 `channels connect <slack|whatsapp>` — this is exactly the pattern. Add `webhooks:listen` next.

3. **`doc_url` on every error** (Stripe) — every error response includes a deep-link to `/docs/errors/<code>`. Costs nothing given Sendero's docs-as-markdown setup.

4. **Hosted OAuth MCP at `mcp.sendero.travel`** (Stripe Agent Toolkit pattern) — let any Claude/Cursor/Code user click "Connect Sendero" and get scoped tools without minting an API key. Sandbox-scoped by default; production scopes require dashboard approval.

5. **Embedded Tech-Provider WhatsApp/Slack onboarding** (Twilio Tech Provider Program) — productize the per-tenant `/install/slack?tenant=<slug>` and `/install/whatsapp?tenant=<slug>` flows as the documented integration story for resold channels. Customers integrate once, inherit every channel `channel-render` supports for free.

---

## 2. Deframe docs deep-dive — patterns to adopt

**Stack:** Mintlify (verified by `<CardGroup>`, `<Card>`, `<Warning>`, `<Tip>`, `mintcdn.com` image host).

### Top-level navigation

Two top tabs: **Documentation** and **API Reference**. The split is hard:
- **Documentation** = prose, guides, architecture, examples, MCP/AI tooling, integrations.
- **API Reference** = one page per HTTP endpoint, generated from OpenAPI, grouped by resource (`strategies/`, `swap-v2/`, `wallets/`, `yield/`, `transfer/`, `health/`).

Plus an "Introduction" landing inside each tab.

### Side menu structure (verified from sitemap)

**Documentation tab:**
```
Getting Started
  ├─ Quickstart            ("Add Yield to Your App in 5 Minutes")
  ├─ Why Deframe
  ├─ Architecture
  ├─ Authentication
  └─ Fees
Guides
  ├─ Yield  → check-protocol-info, deposit, withdraw, check-positions
  └─ Swaps  → get-quote, execute-swap
Examples (JavaScript)
  ├─ strategy-deposit, same-chain-swap, cross-chain-swap, using-eip7702
Iframe / Widgets / Protocols
  ├─ widgets/earn-widget, swap-widget, llm-playbook, process-bytecode
  ├─ iframe/overview, privy, wagmi-viem
  └─ protocols   (single flat page — table by network)
External Integrations
  ├─ privy, dynamic, fireblocks, notus
AI Tools
  ├─ MCP Server, MCP Setup, MCP Tools Reference, Skills
Reference
  ├─ Error Codes, Changelog
```

**API Reference tab:**
```
Introduction
Health        ├─ api-health-check
Strategies    ├─ list-strategies, get-strategy-details, generate-strategy-transaction-bytecode
Swap V2       ├─ get-swap-quote, generate-transaction-bytecode, get-swap-status
Transfer      ├─ generate-transfer-transaction-bytecode
Wallets       ├─ get-wallet-positions, get-wallet-transaction-history
Yield         ├─ get-yield-recommendations
```

13 endpoints total. Generated from a single OpenAPI file (Mintlify auto-generates the pages — no hand maintenance).

### Per-page affordances

- **Copy page** dropdown with options: "Copy as Markdown", "View Markdown", "Open in ChatGPT", "Open in Claude" (Mintlify default).
- **`.md` mirror** at `<path>.md` — returns raw MDX with a `> Documentation Index` prelude pointing at `llms.txt` so any LLM is force-fed the index.

### "Get API Key" CTA

Top-right links to `https://www.deframe.io/plg/select-plan` — a self-serve plan-picker on the marketing site, not a modal. Funnel: marketing → pick plan → signup → dashboard → mint key. No "free dev key" deep link.

### AI-agent affordances

- **MCP server**: `http://mcp.deframe.io/mcp` (note: HTTP, not HTTPS — they pass `--allow-http`). Auth via `x-api-key` header, same key as REST.
- **Per-client install copy**: dedicated page (`/ai-tools/mcp-setup`) with copy-paste blocks for **Claude Code, Claude Desktop, Cursor, Gemini CLI, OpenAI Codex** — five clients. Includes both CLI one-liners (`claude mcp add ...`) and JSON config snippets.
- **25 MCP tools + 9 prompts** across 5 buckets (Shared, Swap, Yield, Code-Gen, SDK Widgets, Skills). Catalog is documented as a flat list with name + 1-line description + parameter list.

### Architecture page

Single PNG diagram + 6-stage flow narrative:
1. **Protocol Data** (GETs)
2. **Transaction Data** (POSTs returning bytecode)
3. **Sign & Propagate** — explicit warning callout: *"User Responsibility: Transaction signature and propagation are handled entirely on your side. Deframe does not hold, manage, or pass any funds."*
4. **Position Monitoring**
5. **Alerts & Notifications** (webhooks)
6. **Integration Features** (multi-provider routing, gas estimation, simulation)

Closes with a 4-card "Key Guarantees" grid (Trustless / Position Monitoring / Status Notifications / Multi-Chain).

### "Add Yield in 5 Minutes" page

Title: **"Add Yield to Your App in 5 Minutes"** — subtitle: *"Integrate DeFi yield strategies into your application in 4 steps"*.

Flow: 3 API calls + 1 signature = end-to-end. That IS the pitch.

### Authentication

- Header: `x-api-key: <key>` (NOT `Authorization: Bearer`).
- **No** `sk_live_` / `sk_test_` prefixes — single namespace.
- **No test mode** — single env, real money from minute one.
- Code samples in **JavaScript, Python, cURL, Go**.

### 10 patterns Sendero docs should adopt

| # | Pattern | What Deframe does | Cost to copy for Sendero |
|---|---|---|---|
| 1 | Hard Documentation / API Reference tab split | Two top tabs; reference is auto-gen from OpenAPI, prose lives in Documentation | **Done** — `apps/docs` already has `/api-viewer` (Scalar). Cost: promote it to a top tab in `apps/docs/app/docs/layout.tsx`. ~2 hrs. |
| 2 | `.md` mirror at every URL with llms.txt prelude | `<path>.md` returns raw MDX prefixed with `> Documentation Index → llms.txt` | **Already shipped** (`apps/docs/app/docs/[[...slug]].md/route.ts`). Add the llms.txt prelude header. ~30 min. |
| 3 | "Copy page" dropdown (Copy MD / Open in Claude / Open in ChatGPT) | Mintlify default on every page | We're on Fumadocs — need a custom client component. `Open in Claude` = `claude://...?prompt=` deep link. ~1 day. |
| 4 | TTHW page titled with explicit time promise | "Add Yield to Your App in 5 Minutes" — 4 steps, 3 API calls + 1 signature | Replace `/docs/quickstart` title → "Book a Trip in 5 Minutes". 4 steps: list-fares → hold → confirm → check trip. ~half day. |
| 5 | Architecture page = 1 diagram + N-stage flow + Key Guarantees grid | PNG + 6 stages + 4-card Trustless/Custody guarantee grid | Sendero parallel: 1 diagram + 5 stages (search → hold → confirm → settle → audit) + 4 guarantees (USDC settlement, on-chain audit, agent-native, take-rate transparency). ~1 day inc. diagram. |
| 6 | MCP install matrix for 5 AI clients | Dedicated page with CLI one-liner + JSON config for Claude Code/Desktop/Cursor/Gemini CLI/Codex | Sendero MCP exists; install copy doesn't. Add `apps/docs/content/docs/mcp-setup.mdx` with the 5 client blocks. ~2 hrs. |
| 7 | MCP tools reference as a flat catalog (25 tools, 1-line each) | One page, grouped by resource, name + description + params | Auto-generate from `packages/tools/src/registry.ts` (the same registry that feeds OpenAPI). ~half day. |
| 8 | "Skills" as orchestrated multi-tool workflows | 4 skills (`swap_and_deposit`, `find_best_yield_for_asset`, `rebalance_position`, `diagnose_integration`) — first-class above raw tools | Sendero parallel: `book_round_trip`, `find_cheapest_route_for_corridor`, `rebook_with_policy`, `diagnose_booking`. Frame existing multi-tool flows as named skills. ~1 day reframe + page. |
| 9 | Self-serve plan-picker as the "Get API Key" funnel | Top-right links to `/plg/select-plan` (no modal, no demo gate) | We have `/billing/plans`. Top-right docs CTA → that page (currently deep-links to dashboard settings). ~1 hr. |
| 10 | Changelog grouped by month with informal Documentation/API tags | Reverse-chrono, no semver, prose-style — readable in 30 sec | Replace generic `/changelog` with month-grouped + tagged entries. Auto-extract from `CHANGELOG.md` split by month headers. ~half day. |

**Three highest-leverage moves:** (a) rename quickstart with a literal time promise + collapse it to N steps with N API calls, (b) ship the MCP install-matrix page, (c) reframe multi-tool flows as named **Skills** so agent consumers see capability, not API surface.

---

## 3. desk-v1 Deframe integration — lessons learned

Located at `/Users/criptopoeta/coding-dojo/desk-v1`. Real production integration. What they got right, what felt clunky.

### File manifest

- `packages/pods/src/client.ts` — REST API client (x-api-key auth, circuit breaker, timeouts)
- `packages/pods/src/types/` — Type exports: `DeframeResponse<T>`, networks, protocols, actions
- `packages/env/src/pods.ts` — Env var accessors for `PODS_API_KEY`
- `apps/shiva/src/services/earn-execution.service.ts` — Strategy bytecode fetch → Circle SDK execution (cross-chain support)
- `apps/shiva/src/services/earn-strategies.service.ts` — List/detail strategy normalization (APY decimal→percent conversion)
- `apps/shiva/src/utils/bytecode-decoder.ts` — Decode Deframe bytecode to Circle format using viem ABI parser
- `packages/transfer-icons/src/chains/network-mapping.ts` — Deframe network → Circle chain mapping
- `packages/dune/src/chain-map.ts` — Deframe network → Dune chain mapping

### Integration shape (core flow, earn-execution.service.ts:168-263)

```typescript
const deframe = await this.getDeframeClient();

// Step 1: Resolve strategy chain
const strategyResult = await deframe.getStrategy(strategyId);
const strategyChainId = NETWORK_TO_CHAIN_ID[strategyResult.data.network];

// Step 2: Detect cross-chain, build params
const needsBridge = walletChainId !== strategyChainId;
const bytecodeParams = {
  action,
  amount,
  wallet: walletAddress,
  ...(needsBridge && {
    fromChainId: walletChainId,
    fromTokenAddress: CHAIN_IDS_TO_USDC_ADDRESSES[walletChainId],
    toTokenAddress: CHAIN_IDS_TO_USDC_ADDRESSES[strategyChainId],
  }),
};

// Step 3: Fetch bytecode (Deframe handles cross-chain routing internally)
const bytecodeResult = await deframe.getStrategyBytecode(strategyId, bytecodeParams);
const { calls } = bytecodeResult.data;

// Step 4-5: Decode & execute via Circle SDK
for (const call of calls) {
  const decoded = decodeTransactionCall(call);
  const response = await circleSdk.createContractExecutionTransaction({
    contractAddress: decoded.contractAddress,
    abiFunction: decoded.abiFunctionSignature,
    abiParameters: decoded.abiParameters,
  });
}
```

### Auth + env

- `x-api-key` header (NOT Bearer)
- `PODS_API_KEY` env var (in root `.env`)
- `PODS_BASE_URL` optional override (defaults to `https://api.deframe.io`)
- No OAuth, no rotation, no test/prod prefix split

### What desk-v1 got RIGHT

1. **Lazy SDK loading** — Deframe client imported only when needed (`await import('@bu/pods')`), keeps bundle small
2. **Circuit breaker** — `circuitBreakerId: 'deframe-api'` prevents cascade failures; timeout 30s
3. **Type safety** — Full TypeScript coverage: `DeframeResponse<T>`, `DeframeTransactionCall`, etc.
4. **Network mapping resilience** — Hard-coded chain lookups prevent silent failures if API returns unknown network name
5. **Atomic cross-chain** — Pass `fromChainId/fromTokenAddress/toTokenAddress` to Deframe once; it returns bytecodes that handle bridging, avoiding N+1 API calls
6. **Bytecode decoding** — Pre-built ABI selector map is O(1) and handles 14 protocols out-of-the-box

### What felt CLUNKY

1. **API docs ≠ reality.** Response shape differs from documented schema. Team had to reverse-engineer actual payloads (`spotPosition` decimal APY, `historic` field structure)
2. **No official SDK.** Built custom `DeframeClient` from scratch. Docs reference is outdated or incomplete
3. **No pagination guidance.** `listStrategies()` supports `page`/`limit` but no example of how many total strategies or which page is "best"
4. **Error response inconsistent.** API sometimes returns `{ error: string }`, sometimes `{ message: string }`, sometimes `{ code: string }`. Error formatting code handles 3 variants
5. **No webhook events.** Forced poll-based sync. Earn execution status requires polling `/wallets/:address/history/:strategyId`
6. **Marketing ≠ reality.** Docs say "15+ protocols" but actual ABI list is 8-9 core ones; coverage unclear for emerging protocols

### Lessons for Sendero

- **Ship a real SDK** before someone has to build their own. desk-v1 has 256 lines of `client.ts` they'd never have written if Deframe shipped one.
- **OpenAPI ≠ truth.** If response shapes drift from spec, integrators reverse-engineer. Test the OpenAPI generation against actual prod responses before publishing.
- **Webhooks > polling** for status changes. desk-v1 explicitly polls because Deframe doesn't deliver events. Sendero must ship `WebhookSubscription` for `booking.confirmed`, `meter.rolled_up`, etc.
- **One error envelope.** Pick `{ code, message, doc_url }` and ship it everywhere. Don't make integrators handle three variants.
- **Document the pagination shape and defaults** in the spec, not just in prose.

---

## 4. Sendero docs current-state audit

### Framework

Fumadocs 14.5.0 + MDX (`apps/docs/package.json:24`). Scalar API reference planned (zod mismatch blocks interactive viewer; fallback at `/api-viewer` → raw OpenAPI JSON).

### Current sidebar structure

```
Sendero API (root: /docs)
├─ index (landing)
├─ Getting started
├─ Quickstart
├─ API reference (link to /docs/api-reference)
├─ Agent-to-agent booking
├─ Clerk auth setup
├─ Tools
│  ├─ Overview
│  ├─ search_flights
│  └─ settle_split
├─ Pricing
│  ├─ Pricing (root)
│  ├─ Markup
│  ├─ Markup error codes
│  └─ Markup scopes
├─ Agents
│  └─ Markup eval recipes
├─ Conventions
│  └─ Errors (error catalog)
├─ Protocol
│  ├─ x402 nanopayments
│  ├─ MCP integration
│  ├─ Claude Desktop install
│  ├─ Security
│  └─ Security: Claim code
└─ Changelog
   └─ 2026-04-tenant-markup-v1
```

**Source:** `apps/docs/content/docs/meta.json:1-32`

22 MDX files total, ~2,729 lines. Only **11 of 49 tools** documented. **One** changelog entry.

### Deframe alignment mapping

| Deframe section | Sendero equivalent | Status |
|---|---|---|
| **Documentation tab** | Implicit (no tab UI) | ✅ Present as default nav |
| **API Reference tab** | `/docs/api-reference` MDX + `/api-viewer` fallback | ⚠️ Separate page, not tab |
| Overview | `index.mdx` + `getting-started.mdx` | ✅ Present |
| Guides | `quickstart.mdx`, `clerk-auth-setup.mdx`, `claude-code-plugin.mdx` | ✅ Present |
| Integrations | `mcp-integration.mdx`, `agent-to-agent-booking.mdx` | ⚠️ Limited (no WhatsApp/Slack/email guides) |
| Agents | `agents/` section | ✅ Present |
| Per-page "Copy as Markdown" | Not in UI (but `.md` route works) | ⚠️ No button; automatic via URL suffix only |
| "Get API Key" CTA | Top-bar button → `app.sendero.travel/dashboard/settings/api-keys` | ✅ Present (`apps/docs/components/docs-top-bar.tsx:128`) |
| Error catalog | `api-conventions/errors.mdx` | ✅ Present |
| Changelog | `changelog/` section | ✅ Present (1 entry) |

### Top 10 integration-experience gaps (ordered by impact)

1. **Missing WhatsApp integration guide** — No how-to for receiving/sending via Meta webhooks. *Largest integration path; zero docs.*
2. **Slack integration guide missing** — Referenced in `getting-started.mdx:47` but no tutorial. Zero code examples.
3. **Per-endpoint reference pages absent** — Only 3 tool pages out of ~49. Integrators reverse-engineer from OpenAPI JSON.
4. **No multi-language code examples** — Quickstart shows only `curl`. No Python/Node/Go snippets in any auth, dispatch, or webhook page.
5. **No webhook inbound spec** — Guides mention Slack/WhatsApp webhooks but never document payload shape, signature verification, or retry logic.
6. **No rate limits or quota docs** — Performance/throttling not mentioned anywhere.
7. **No "What is Sendero" architecture page** — `index.mdx` + `getting-started.mdx` lack high-level system diagram explaining MCP vs REST vs nanopayments vs settlement.
8. **Documentation/API Reference tab UX missing** — Deframe has explicit tab UI; Sendero has navbar buttons but no unified split.
9. **No "Copy page" button in UI** — `.md` export works but is undiscovered. No affordance.
10. **No real-world pricing examples** — `pricing/` documents markup scopes but not concrete examples ("JFK→LIS round-trip = $X+Y% markup = $Z USDC consumed").

---

## 5. Docs redesign — even better than Deframe

### Three things to copy verbatim

1. **Documentation / API Reference tab split** at the top.
2. **"Copy page" dropdown** on every page with: Copy as Markdown · View Markdown · Open in Claude · Open in ChatGPT.
3. **Per-client MCP install matrix page** with copy-paste for Claude Code, Claude Desktop, Cursor, Gemini CLI, Codex.

### Six things Sendero should do BETTER than Deframe

1. **Live runnable code samples in 4 languages, not 1.** Deframe ships JavaScript-only Examples. Sendero should ship `cURL`, `Node`, `Python`, `Go` tabs on every code block — auto-generated from a single source so they never drift.

2. **Honest API Reference that matches reality.** desk-v1's #1 complaint about Deframe was "API docs ≠ reality." Sendero should ship an integration test that fires every documented response shape against the real `/api/openapi.json` and fails the build if they drift. Make the OpenAPI doc the *truth*, not a marketing-adjacent summary.

3. **Outbound webhook catalog with try-it-now.** Deframe doesn't have webhooks at all. Sendero ships `booking.confirmed`, `meter.rolled_up`, `settlement.completed` events with: full payload schema, signature verification recipe in 4 languages, and a `sendero webhooks:listen --forward-to localhost:3000/sendero` CLI command (Stripe pattern) that lets devs test without ngrok.

4. **Real cost calculator on the pricing page.** Don't list markup scopes in prose. Render a live calculator: pick a route, pick a tier, see the breakdown (supplier net + agency markup + Sendero rail + validator tip) in micro-USDC.

5. **"Open in agent" deep-links per skill.** Above every workflow guide, render: `Open in Claude Code` · `Open in Cursor` · `Open in ChatGPT` buttons that pre-fill the agent with the skill's name + a starter prompt. Stripe Agent Toolkit does this for one-shot tools; Sendero does it for *named multi-tool skills*.

6. **Changelog with diff-of-impact.** Group by month + informal tag (Deframe pattern). Add: "If you call X, you need to change Y" — concrete migration text per breaking change. Auto-extract from PR descriptions.

### Concrete redesign deliverables

| Order | Deliverable | Effort | Lever |
|---|---|---|---|
| 1 | Promote `/api-reference` to a top tab in `apps/docs/app/docs/layout.tsx` | 2 hrs | Discoverability |
| 2 | Custom Fumadocs `<CopyPage />` client component with 4-option dropdown | 1 day | AI-agent UX |
| 3 | `apps/docs/content/docs/mcp-setup.mdx` — 5-client install matrix | 2 hrs | TTHW for AI users |
| 4 | Auto-gen `apps/docs/content/docs/tools/` reference pages from `@sendero/tools` registry (one .mdx per tool, ~46 missing) | 1 day | Coverage gap |
| 5 | Rename `quickstart.mdx` → "Book a Trip in 5 Minutes" with 4 steps + 3 API calls + 1 signature | 4 hrs | TTHW pitch |
| 6 | New `architecture.mdx` page with diagram + 5 stages + 4 guarantees grid | 1 day | "What is Sendero" mental model |
| 7 | New `webhooks.mdx` page documenting outbound event catalog (post-build of WebhookSubscription) | 2 days incl. backend | Webhook story |
| 8 | New `integrations/whatsapp.mdx` + `integrations/slack.mdx` with end-to-end ISV install flow | 1 day each | Largest unaddressed surface |
| 9 | New `examples/` folder with `cURL`, `Node`, `Python`, `Go` tabs auto-generated | 1 day | Multi-language |
| 10 | Live cost calculator on `pricing.mdx` | 1 day | Pricing transparency |
| 11 | Skills page reframing multi-tool flows as named skills (`book_round_trip`, `find_cheapest_route`, `rebook_with_policy`) | 1 day | Capability framing |
| 12 | OpenAPI ↔ runtime drift test in CI | 4 hrs | Honesty (vs Deframe's #1 weakness) |

**Total effort: ~13 person-days.** Half can run in parallel (docs are mostly independent).

---

## 6. CLI P0/P1 build status (this session)

### P0 (foundation) — built and tested

| File | Purpose |
|---|---|
| `packages/cli/src/index.ts` | commander entry, status-aware default (`sendero` shows current state + next action) |
| `packages/cli/src/commands/auth.ts` | `auth login` (browser OAuth via PKCE), `auth logout`, `auth whoami` — supports `--profile` |
| `packages/cli/src/commands/mcp.ts` | `mcp install` recommends the plugin bundle (no `.mcp.json` clobber) |
| `packages/cli/src/commands/tools.ts` | `tools list/call/schema` |
| `packages/cli/src/client/auth.ts` | Local-port listener (8765-8770 fallback range) + browser open + key capture |
| `packages/cli/src/client/pkce.ts` | RFC 7636 PKCE primitives |
| `packages/cli/src/client/api.ts` | Bearer-auth fetch wrapper with debug logging |
| `packages/cli/src/output/{formatter,print}.ts` | json/table/agent + NO_COLOR + structured error format |
| `packages/cli/src/ui/spinner.ts` | ora wrapper, muted in agent/quiet/non-TTY |
| `apps/app/app/api/cli/login/route.ts` | OAuth gateway (signed-in vs sign-in bounce) |
| `apps/app/app/api/cli/mint-key/route.ts` | Mints `ak_*` key via `clerkClient.apiKeys.create()`, redirects back to local listener |

### P1 (workflow surface) — built and tested

| File | Purpose |
|---|---|
| `packages/cli/src/config/store.ts` | Profile-based credential store with auto-migration from legacy `~/.sendero/key` |
| `packages/cli/src/commands/profiles.ts` | `sendero profiles list/use/delete/show` |
| `packages/cli/src/commands/channels.ts` | `sendero channels connect <slack\|whatsapp>` + `channels status` (with poll) |
| `packages/cli/src/commands/workflows.ts` | First-class wrappers: `flights search/book`, `treasury check`, `settle split` (with `--dry-run`), `gateway balance` |
| `apps/app/app/api/cli/channels/poll/route.ts` | Per-channel install poll (Bearer-keyed, tenant-pinned) |
| `apps/app/app/api/cli/channels/status/route.ts` | One-shot all-channels status |

### Verified

- 19/19 tests pass (`bun test packages/cli/src`)
- Typecheck clean (`@sendero/cli` + `@sendero/app`)
- Smoke: `sendero --help` shows 8 command groups
- Smoke: `sendero --dry-run settle split 1000.50 0x...` correctly previews the 4-way breakdown without firing on-chain
- Smoke: `sendero channels connect slack` opens browser + polls `/api/cli/channels/poll`

### CLI surface visible to a new user now

```
sendero
├── auth         login (--profile, --no-browser), logout, whoami
├── mcp          install (recommends bundle)
├── tools        list, call, schema
├── profiles     list/ls, use, delete/rm, show
├── channels     connect <slack|whatsapp>, status
├── flights      search, book
├── treasury     check (--verify)
├── settle       split (--dry-run, --commission-bps, --sendero-fee-bps)
└── gateway      balance
```

---

## 7. Backlog — ordered by integrator-experience leverage

### Immediate (next session)

- [ ] **Confirm `/install/slack?tenant=<slug>` accepts `tenantId` param** — the CLI's `channels connect slack` sends `tenantId` but the page expects `slug`. Either add slug-resolution to the install page or have the CLI fetch the slug from `/api/auth/whoami` first.
- [ ] **Document P0/P1 in the docs site** — `apps/docs/content/docs/cli.mdx` doesn't exist yet. Without it, the new CLI is invisible.
- [ ] **Manual end-to-end OAuth test** — needs a Clerk OAuth Application configured with redirect URI `http://localhost:8765-8770/cb`.

### High-leverage TaaS infrastructure

- [ ] **Token-prefix split (`ak_test_*` vs `ak_live_*`)** — server change at Clerk + every consumer route. Stripe pattern. Catches leaked keys at grep-time.
- [ ] **Outbound webhooks for integrators** — needs `WebhookSubscription` table + Svix delivery worker + signed payload spec. Catalog: `booking.confirmed`, `booking.cancelled`, `meter.rolled_up`, `settlement.completed`, `trip.disrupted`.
- [ ] **Hosted OAuth MCP at `mcp.sendero.travel`** — separate route + Clerk OAuth Application config. Lets any Claude/Cursor user click "Connect Sendero" without an API key.
- [ ] **ISV-rebrandable WhatsApp install** — bigger story, touches Kapso flow + tenant model. Today's flow redirects to `app.sendero.travel`; needs to redirect to integrator's domain.
- [ ] **Multi-language SDKs** — auto-gen from OpenAPI. `@sendero/sdk-node`, `sendero-python` (PyPI), `sendero-go` (go modules). Stripe pattern.
- [ ] **`doc_url` on every error** — every JSON-RPC and REST error includes a deep-link to `/docs/errors/<code>`. Free given docs-as-markdown.

### Docs redesign (see §5)

- [ ] Documentation / API Reference top-tab split (`apps/docs/app/docs/layout.tsx`)
- [ ] "Copy page" dropdown component with Copy MD / Open in Claude / Open in ChatGPT
- [ ] MCP install matrix page (5 clients)
- [ ] Auto-gen tool reference pages from `@sendero/tools` registry (~46 missing)
- [ ] Architecture page (1 diagram + 5 stages + 4 guarantees)
- [ ] Webhooks page (post-WebhookSubscription build)
- [ ] WhatsApp + Slack integration guides
- [ ] Multi-language code-sample tabs
- [ ] Live cost calculator on pricing page
- [ ] Skills page (reframe multi-tool flows as named skills)
- [ ] OpenAPI ↔ runtime drift test in CI

### CLI P2 polish

- [ ] `sendero webhooks:listen --forward-to localhost:3000/path` (Stripe pattern; needs outbound webhooks first)
- [ ] `sendero tools schema <name>` already shipped P0; extend to render input schema as a friendly table when TTY
- [ ] ASCII Sendero branding on TTY (`ui/branding.ts` already structured for it)
- [ ] Shell completion (zsh / fish / bash)
- [ ] Scope-aware tool call gating with "did you mean" hints when scope missing
- [ ] CLI install via Homebrew (`brew install sendero-travel/cli/sendero`)

### Open questions for the team

- Workflow commands (`flights search`, `treasury check`, etc.) target a "human at terminal" persona — both CEO + DX review lenses said this isn't a real Sendero user. **Revisit at 90d** if usage data shows zero adoption. (User explicitly kept these in P1 for hackathon/demo value.)
- Should `sendero` itself be the brand-positioned name, or is `sendero-cli` clearer? Stripe ships `stripe`, Twilio ships `twilio`, Cloudflare ships `wrangler`. Single-word command wins.

---

**End of report.**
