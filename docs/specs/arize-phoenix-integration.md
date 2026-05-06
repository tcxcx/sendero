# Spec: Arize Phoenix integration — closing the demand-driven loop at the agent layer

**Status:** draft v0.4 · 2026-05-05 (post-PR1 + Plurai addendum)
**Owner:** @criptopoeta
**Hackathon:** Google Cloud Rapid Agent Hackathon — Arize track (deadline 2026-06-11)
**Lead pattern:** `/raj-demand-driven-context` (Sendero gap-loop) + Langfuse + Phoenix MCP. x402 + A2A + Plurai-vibe-eval in spec, sequenced post-hackathon.
**One-line:** Sendero already implements Raj's pull-thesis at the human layer. Phoenix completes it at the agent layer — agents walk their own observability chain autonomously before escalating.

**Changelog v0.4 (post-PR1 reality + Plurai):**
- **§4.1 architecture wording corrected** — OTel v2 `BasicTracerProvider` does NOT expose `addSpanProcessor()` after construction (verified against installed `@opentelemetry/sdk-trace-base@2.2.0`). Real shape: each Sendero observability package exports `buildXSpanProcessor()`; the orchestrator at `apps/app/instrumentation.ts` gathers them and constructs the single global provider once with all processors. Same architectural intent as v0.3, different mechanic.
- **PR1 landed** — `packages/arize-phoenix/` skeleton + `traceAgent` stamps `sendero.tenant_id` etc. on OTel spans + `@sendero/tools/src/dev-gate.ts` extracted. Existing 22 `report-knowledge-gap` tests still pass. All 4 Phoenix env vars pushed to Vercel × 3 targets.
- **§15 NEW — three-plane eval mesh (Plurai).** Plurai (`plurai-ai/plurai-plugins → evals@plurai-plugins`) joins Langfuse evaluators + Phoenix experiments as the **developer-iterated** eval plane. Vibe-train evals in claude-code; benchmark against existing Langfuse trace data + Phoenix recall data. Powers the dogfood loop (`/raj-demand-driven-context` workflow) by making eval iteration cheaper than `bun langfuse:regression` static scripts.

**Changelog v0.3 (autoplan-applied — 7 mechanical fixes + scope decisions):**
- **OTel architecture:** shared `NodeTracerProvider`, two span processors. `@sendero/langfuse/otel` exposes `getOrCreateProvider()`; `@sendero/arize-phoenix/otel` calls `provider.addSpanProcessor(phoenixProcessor)`. **Two providers cannot coexist** — the prior diagram was misleading; this is the correct OTel shape.
- **Tenant attribution:** `traceAgent` stamps `sendero.tenant_id` (+`sendero.user_id`, `sendero.surface`) directly on every OTel span via `span.setAttribute(...)`. Without this, Phoenix queries would leak across tenants.
- **x402 boundary fixed:** dropped fictional `ctx.caller.surface === 'internal'`. Replaced with **route-layer metering** — `/api/mcp` meters every external call (existing pattern); `/api/agent/dispatch` internal turns covered by parent `chat_reply` event. Zero new ToolContext fields.
- **Dev-only gate:** extracted to `@sendero/tools/src/dev-gate.ts::assertDevOnlyToolAllowed(ctx)`. All 3 gate conditions × all 4 tools tested (12 unit tests).
- **`find_resolved_gap` recall:** **embedding-based**, not hash-based. Hypotheses paraphrase across model versions; hash equality misses 80%+ of real recalls. Phoenix supports embedding similarity natively.
- **Prompt injection mitigation:** auto-curation requires `eval ≥ 0.85` AND `outcome.confirmed_booking_id` exists AND `MeterEvent.status='paid'`. Recall results tagged `provenance: 'auto-promoted' | 'human-curated'`. Persona slab: "recall is a hint, not authority."
- **Endpoint abstraction:** PR1 ships `packages/arize-phoenix/docker-compose.yml` so demo recording can swing to self-host if Cloud rate-limits.

**Changelog v0.3 (scope decisions):**
- **PR5 cut.** `query_tool_performance` removed — no real tool-pair fork in Sendero today; revisit post-PR4 if dogfood surfaces one.
- **PR6 deferred to post-hackathon.** §4.6 (x402 metering) + §4.7 (A2A fabric) stay in spec for completeness. Execution scope shrinks to PR1→PR4 + operator UI. The Arize bonus criterion ("agents that use their own observability data to improve") is delivered by PR3 alone.
- **`phoenix-introspect` skill repurposed** from agent-side (duplicated `report_knowledge_gap`) to **human-dev side** — debug a Sendero integration in claude-code by querying Phoenix.

**Changelog v0.2 (carried forward):**
- Package: `@sendero/arize-phoenix` (vendor-prefix matches `@sendero/circle`, `@sendero/duffel`, `@sendero/kapso`).
- Phoenix Cloud chosen (Q1 resolved). API key wired to `.env.local`. Vercel push pending re-auth. **Rotate this key after Vercel push** — visible in this session's chat history.

---

## 1. Problem statement

Sendero's demand-driven loop today (Raj pattern):

```
agent fails → report_knowledge_gap → gaps:scan board → HUMAN walks
Langfuse trace + Vercel log + CF log → fix → re-test → seed golden-turn
```

Two structural gaps remain:

1. **The agent re-fails the same gap until a human PR closes it.** Today only the human walks the chain. The agent has no read-side access to its own past failures or successes.
2. **Compounding stops at the operator.** Each gap surfaces, gets fixed once, and the institutional knowledge lives in a markdown board + Langfuse traces nobody else queries at runtime.

**The missing primitive:** runtime trace introspection BY THE AGENT.

Phoenix MCP is the cleanest match — it exposes traces, prompts, datasets, experiments, and evals as MCP tools the agent can call mid-turn. Same OTel/OpenInference span shape we already export to Langfuse.

---

## 2. Goals

1. **Pre-turn recall.** Agent queries `recall_similar_turns({ query, route, tenantId })` against Phoenix BEFORE planning. Returns top-N prior traces with outcomes. Constrains the search space, prevents re-discovery of dead branches.
2. **Mid-turn introspection.** When `list_available_tools` is insufficient, agent queries Phoenix experiments/evals for the tool it's about to call. "Did `book_flight` LLM-judge fail in the last 50 turns? On what corridor?"
3. **Self-healing gap loop.** Before a `report_knowledge_gap` escalation, the agent calls `find_resolved_gap({ hypothesisHash })` against a Phoenix-annotated dataset. If a closed gap matches, agent applies the fix + retries instead of escalating. **This is the magic.**
4. **Closed-loop dataset growth.** Successful turns auto-add to Phoenix dataset; closed gaps auto-add as `mustNotRegress` examples. Compounds without human curation per turn.
5. **Co-existence with Langfuse.** Phoenix is for *agent-side runtime introspection*. Langfuse stays canonical for human ops (prompt management, operator dashboards, golden-turn regression). Both consume the same OpenInference spans — no data lock-in.

## 3. Non-goals

- **Replacing Langfuse.** Langfuse stays. Prompt versioning, evaluator scoring, snapshot diff, MCP-for-prompts → unchanged.
- **Replacing the human gap-scan board.** `bun gaps:scan` + `docs/agent-gaps/board.md` stay the operator's dashboard. Phoenix is the agent's, not the operator's, data plane.
- **Cross-tenant trace sharing in v0.1.** Phoenix queries are tenant-scoped. Cross-tenant anonymized recall is the network-effect play (a16z "Stay for Network") — wedge for v0.2 after hackathon.
- **Production cutover before testnet flip.** Same gating as `report_knowledge_gap`: dev/sandbox only. Production agents still escalate via `request_human_handoff`.

## 4. Architecture

### 4.1 Span pipeline (shared provider, two processors)

```
                    ┌────────────────────────────────────┐
                    │  Single global NodeTracerProvider  │
                    │  (registered ONCE in instrumentation.ts)
                    └─────────────┬──────────────────────┘
                                  │
generateText (AI SDK) ─► OTel span (carries sendero.tenant_id, sendero.surface)
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                                   ▼
     LangfuseSpanProcessor                 PhoenixSpanProcessor
     (existing — unchanged)                (NEW)
                │                                   │
                ▼                                   ▼
         Langfuse Cloud                       Phoenix Cloud
         (human ops)                          (agent runtime introspection)
                                                    │
                                                    ▼
                                              Phoenix REST + MCP
                                                    │
                                                    ▼
                                  agent tools (recall_*, find_resolved_gap)
```

**One provider, two processors — orchestrator-time construction.** OTel only allows one global `NodeTracerProvider` per process. **OTel v2 `BasicTracerProvider` does NOT expose `addSpanProcessor()` after construction** — processors must be passed via the constructor. Each Sendero observability package therefore exports `buildXSpanProcessor()` returning a `SpanProcessor | null`; the orchestrator at `apps/app/instrumentation.ts` gathers builders, filters nulls, constructs the single provider once with all processors, and calls `register()` exactly once. The legacy `initLangfuseOtel()` path (Trigger.dev workers) stays idempotent — `markOtelInitialized()` flips its guard so it no-ops once the orchestrator has run.

**Span attributes Phoenix relies on for tenant filtering** are set by `traceAgent` directly on the active span (not just on Langfuse trace metadata):
- `sendero.tenant_id` — required for cross-tenant isolation
- `sendero.user_id` — optional, used for per-traveler recall
- `sendero.surface` — `'web' | 'slack' | 'whatsapp' | 'mcp' | 'dispatch'`
- `sendero.channel`, `sendero.trip_id`, `sendero.turn_id` — secondary filters

### 4.2 Package boundary (mirrors Langfuse)

**New: `@sendero/arize-phoenix`** — the ONLY package importing `@arizeai/openinference-*` and `@arizeai/phoenix-client`. All surfaces import from here. Vendor-prefix convention matches `@sendero/circle`, `@sendero/duffel`, `@sendero/kapso`, `@sendero/langfuse`. Pattern lifted verbatim from `@sendero/langfuse`:

```
packages/arize-phoenix/
  package.json       # name: "@sendero/arize-phoenix", peer ai/openinference deps
  src/
    index.ts         # public surface (single barrel — same shape as @sendero/langfuse)
    client.ts        # auth + base URL + isPhoenixEnabled() + workspace path
    otel.ts          # initPhoenixOtel() — second exporter alongside Langfuse
    recall.ts        # recall_similar_turns — Phoenix span search wrapper
    experiments.ts   # find_resolved_gap, query_tool_performance — dataset queries
    datasets.ts      # auto-attach successful turns + closed gaps
    metering.ts      # x402 nanopayment hook (NEW — see §4.6)
    a2a.ts           # external-agent surface helpers (NEW — see §4.7)
    flush.ts         # forceFlush for serverless
    types.ts
  README.md          # quickstart + dual-plane explainer (Langfuse vs Phoenix)
```

**Single-import discipline.** Same rule as Langfuse: NO other package imports `@arizeai/*` directly. Architectural test in `packages/tools/__tests__/import-graph.test.ts` enforces it (mirror of the `@sendero/langfuse` boundary check).

### 4.3 Tool surface (2 new for hackathon — dev/sandbox-only, shared gate helper)

| Tool | Inputs | Returns | When agent uses | Recall mode |
|---|---|---|---|---|
| `recall_similar_turns` | `{ query, route?, scope?, limit? }` | `Array<{ traceId, summary, outcome, latencyMs, evalScores, appliedTools, provenance }>` | First step of any planning turn — "have I done this before?" | embedding similarity over span text + filters on `sendero.tenant_id`, `eval ≥ 0.7`, age > 1h |
| `find_resolved_gap` | `{ hypothesis, toolName?, kind? }` | `{ found: boolean, gapId?, resolutionPrUrl?, fixSummary?, mustMention?: string[], provenance }` | **Before** calling `report_knowledge_gap`. If found, retry with fix; only escalate if not. | **embedding similarity** on hypothesis text against `sendero-resolved-gaps` dataset. NOT hash-equality — model paraphrase breaks hashes. |

~~`query_tool_performance`~~ — **CUT (autoplan v0.3).** No real tool-pair fork in Sendero today; revisit post-PR4 if dogfood surfaces one.

All gates routed through `@sendero/tools/src/dev-gate.ts::assertDevOnlyToolAllowed(ctx)` — the SAME helper `report_knowledge_gap` uses. Three independent gate conditions, ALL must pass to actually execute:

1. **Env:** `NODE_ENV !== 'production'` OR `VERCEL_ENV ∈ {undefined, 'development'}`.
2. **Caller:** `caller.effectiveKeyType !== 'production'`.
3. **Tenant:** `ctx.traveler.tenantId` populated.

Failure mode: silent `{ status: 'production_refused', message }` (NOT throw). Production agents fall through to plan-from-scratch, indistinguishable from cold path.

Override: `SENDERO_GAPS_ALLOW_NONDEV=1` extends to these tools — same scope as `report_knowledge_gap` (operator dashboard manual surface only; never wired to agent runtime).

### 4.4 Auto-curation (closes the loop)

Two cron-driven jobs that compound the dataset without human work:

1. **`bun phoenix:promote-successes`** — every 6h. Pulls Langfuse traces with `eval ≥ 0.85` from last window, attaches to Phoenix `sendero-recall` dataset with the input/output as embedding source.
2. **`bun phoenix:promote-resolutions`** — runs after `bun gaps:scan --resolve-stale-days`. Closed gaps (status=resolved + resolutionPrUrl) get attached to `sendero-resolved-gaps` dataset with `(hypothesisHash, fixSummary, mustMention)` payload.

Both are idempotent on Phoenix dataset id + Sendero gapId/traceId.

### 4.5 MCP wiring

Phoenix MCP runs **inside the agent runtime**, not as a separate process. Two access modes:

- **Direct tool path** (preferred for runtime). Three tools above call `@arizeai/phoenix-client` directly through `@sendero/phoenix`. Native AI SDK tool — no MCP overhead.
- **MCP discovery path** (operator dashboard + Claude Code dev). `.mcp.json` adds `phoenix` HTTP MCP entry next to `langfuse`. Lets `claude-code` operators query Phoenix from their dev session. Skill: `.agents/skills/phoenix/SKILL.md`.

```json
"phoenix": {
  "type": "http",
  "url": "https://app.phoenix.arize.com/s/tomas-cordero-esp/mcp",
  "headers": { "Authorization": "Bearer ${PHOENIX_API_KEY}" }
}
```

### 4.6 x402 nanopayment metering (pay-per-introspection) — DEFERRED post-hackathon

> **Scope decision (autoplan v0.3):** This section stays in the spec for completeness, but execution is **post-hackathon**. The Arize bonus criterion is fully delivered by PR3 alone. PR6 ships when an external A2A integration request lands.

Phoenix MCP queries are not free CPU. Each `recall_similar_turns` / `find_resolved_gap` call costs Sendero compute (Phoenix Cloud quota, our embedding lookups, network round-trips). When an **external** agent calls these tools through MCP, that call must meter through the existing x402 pipeline.

**Boundary signal: route, not field.** Earlier draft proposed `ctx.caller.surface === 'internal'` — that field doesn't exist in `ToolContext.caller` (only `scopes / keyType / effectiveKeyType`). Adding it would touch every test fixture and every caller-builder. **Simpler:** rely on the existing route topology:

| Surface | Route | Metering |
|---|---|---|
| External agent / A2A | `POST /api/mcp` | **Per-tool-call meter** (existing nanopayments path — Phoenix tools land here automatically) |
| Internal channel turn | `POST /api/agent/dispatch` | Covered by **parent `chat_reply` MeterEvent** in `runAgentTurn`. Sub-tool calls within a turn are not double-billed today; Phoenix tools inherit. |
| Operator console | Clerk session via `/api/agent/chat` | Same as dispatch — parent-turn metering. |

**Reuses canonical primitives — zero new billing infra:**

- `MeterEvent` already keys on `toolName`. Phoenix tools land alongside `book_flight`.
- `apps/app/lib/agent-auth.ts::buildPlanOverrides` already discounts by plan tier. Phoenix tools inherit.
- `packages/auth/src/dispatch-auth.ts::filterToolsByScopes` gates registry access. Phoenix tools live in NEW scope `introspection`.

**Per-call price (overridable via `pricingOverrides`):**

| Tool | Sandbox | Prod (basic) | Prod (pro) | Prod (enterprise) |
|---|---|---|---|---|
| `recall_similar_turns` | $0 (sandbox skip) | 100 µUSDC | 70 µUSDC (30% nano-discount) | 50 µUSDC (50%) |
| `find_resolved_gap` | $0 | 50 µUSDC | 35 µUSDC | 25 µUSDC |

Cells live in `packages/billing/src/pricing.ts`. Sandbox keys → `MeterEvent.status='sandbox'` (excluded from `NanopayBatch`).

**Cap behavior.** Phoenix tools count toward the tenant's daily/monthly caps via `preflight()` like every other priced tool. Cap-blocked external call → **402 Payment Required** (x402 spec). Internal turn covered by parent cap-check.

When PR6 ships, introspection becomes **a revenue surface** — every external agent that uses our brain pays for it.

### 4.7 A2A (agent-to-agent) — Phoenix as the observability fabric — DEFERRED post-hackathon

> **Scope decision (autoplan v0.3):** Stays in spec for completeness; execution post-hackathon. CLI is committed-unpublished per CLAUDE.md mainnet-cutover gate. No external A2A integrations exist today, so this is a v0.2 wedge, not a hackathon deliverable.

Sendero already supports A2A via `/api/mcp` (Clerk-authed external agents call Sendero tools). Phoenix integration extends A2A in three ways:

**1. Bidirectional trace visibility.** External agent calls to Sendero tools land in Phoenix with `caller.tenantId`, `caller.keyId`, and `caller.surface = 'mcp'`. The external agent can call `recall_similar_turns` against ITS OWN past turns (filtered by `caller.tenantId`) — making Phoenix the cross-agent observability fabric, not just Sendero's.

**2. CLI surface (`@sendero/cli`).** Already exists, hackathon-ready (committed-but-unpublished per CLAUDE.md mainnet-cutover rule). Add three commands:

```bash
sendero phoenix recall "book SFO to LHR" --route SFO-LHR --limit 5
sendero phoenix gap "documentImageUrl undefined" --tool scan_document
sendero phoenix perf scan_document_auto --since 30d
```

Wraps the three tools via the same `/api/mcp` endpoint that an external agent would hit. Operators get the same self-introspection dev humans use.

**3. Claude-code plugin skill (`apps/claude-code-plugin/skills/phoenix-introspect/`).** New skill — **for human developers integrating Sendero, not agents.** (Repurposed from earlier draft after autoplan caught that agents already have native equivalents.) When a developer is debugging a failed Sendero MCP call in their claude-code session:

```markdown
## phoenix-introspect (human-dev surface)

When you're debugging a Sendero integration in claude-code and an MCP call returned
unexpected data, query Phoenix to see whether the failure is documented:

1. `mcp__phoenix__recall_similar_turns` with the query you sent
2. `mcp__phoenix__find_resolved_gap` with the error text as hypothesis
3. Read the trace tree in Phoenix UI for the live call — Sendero stamps
   sendero.tenant_id + sendero.surface so it's filterable to your org

This is human-debug-by-mid-session. Sendero's own agents already do this
natively via report_knowledge_gap + the (deferred) production-callable
recall tools when PR6 ships.
```

**4. `.mcp.json` distribution.** External agents (Cursor, Claude Desktop, Gemini CLI, custom OpenAI agents) drop the snippet from §4.5 into their config and gain `recall_*` + `find_resolved_gap` as native tools. Each call meters through x402 (§4.6). Auth per `Authorization: Bearer ak_…` (Sendero key) — Phoenix's own bearer is server-side only.

**Network play (a16z "Stay for Network", applied).** Every external agent that integrates Phoenix-via-Sendero strengthens the cross-agent corpus. v0.2 (post-hackathon) adds anonymized cross-tenant recall with k-anonymity n≥20 (same shape as the pricing benchmark wedge in CLAUDE.md). Today: zero external A2A integrations, so this is **wedge potential, not realized moat** — don't oversell in pitch decks until at least one external agent ships.

---

## 5. Surfaces to touch (file-level)

```
packages/arize-phoenix/                        ← NEW package, mirror @sendero/langfuse
  package.json                                  name: "@sendero/arize-phoenix"
                                                + @arizeai/openinference-instrumentation-vertexai
                                                + @arizeai/phoenix-client
                                                + @sendero/billing (peer — for metering.ts)
  src/
    {index,client,otel,recall,experiments,datasets,flush,types}.ts
    metering.ts                                 NEW — x402 hook (§4.6)
    a2a.ts                                      NEW — external-agent helpers (§4.7)
  README.md

apps/app/instrumentation.ts                    ← add initPhoenixOtel() AFTER Langfuse
apps/app/lib/agent-models.ts                   ← OpenInference instrumentation hook for Vertex
packages/tools/src/                            ← register 3 new tools in toolList
  recall-similar-turns.ts                       NEW (scope: 'introspection')
  find-resolved-gap.ts                          NEW (dev-only gate, mirrors report-knowledge-gap)
  query-tool-performance.ts                     NEW (scope: 'introspection')
  index.ts                                      + 3 imports + array entries
  __tests__/import-graph.test.ts                + assert no @arizeai/* outside @sendero/arize-phoenix

packages/agent/src/prompt.ts                   ← persona slab: "Self-introspection (dev/sandbox)"
                                                  Move-by-move: recall first → tools second →
                                                  find_resolved_gap before report_knowledge_gap.

packages/auth/src/dispatch-auth.ts             ← scope 'introspection': add to toolToScope() map
                                                  + add to DEFAULT_PROD_SCOPES (read-mostly, opt-in)
packages/billing/src/pricing.ts                ← Phoenix tool price-cells (§4.6 table)

apps/app/app/api/agent/dispatch/route.ts       ← buildPlanOverrides ctx.caller for Phoenix tools
apps/app/app/api/agent/chat/route.ts           ← same
apps/app/app/api/mcp/_mcp-app.ts               ← public MCP surface — Phoenix tools metered when
                                                  caller.surface === 'mcp' (external A2A path)

packages/cli/src/                              ← @sendero/cli — A2A surface (§4.7)
  commands/phoenix/recall.ts                    NEW
  commands/phoenix/gap.ts                       NEW
  commands/phoenix/perf.ts                      NEW

apps/claude-code-plugin/skills/                ← claude-code skill (§4.7)
  phoenix-introspect/SKILL.md                   NEW

scripts/                                        ← cron jobs (Vercel cron via vercel.json)
  phoenix-promote-successes.ts                  NEW
  phoenix-promote-resolutions.ts                NEW
  phoenix-seed-dataset.ts                       NEW (one-shot, hackathon demo prep)

vercel.json                                     ← + 2 cron entries (6h cadence)
.mcp.json                                       ← + phoenix HTTP MCP entry (workspace-scoped URL)

.env.example                                    ← PHOENIX_API_KEY, PHOENIX_PROJECT_NAME,
                                                  PHOENIX_BASE_URL, PHOENIX_COLLECTOR_ENDPOINT
.env.local (root + apps/app)                    ← already wired (this session)

apps/docs/                                      ← /docs/observability page
                                                  "Two planes: human (Langfuse) + agent (Phoenix)"
                                                + /docs/agents/phoenix-via-mcp (A2A onboarding)

CLAUDE.md                                       ← new section: "Phoenix — agent self-introspection
                                                  + x402 metering + A2A fabric"
                                                  mirrors Langfuse section, points at this spec
```

**No changes** to: Kapso workflows, Slack/WhatsApp adapters, channel-render layer, Circle webhooks, billing. Phoenix sits underneath the agent runtime; channels are unaware.

---

## 6. Phases (spec-first → code in slices)

Hackathon critical path: **PR1 → PR2 → PR3 → PR4**. PR5 strengthens demo. PR6 is **post-hackathon**.

### PR1 — OTel shared-provider refactor + Phoenix package skeleton + tenant_id span attribute (foundation)

This PR has FOUR moves; all gating for PR2:

1. **Refactor `@sendero/langfuse/otel.ts`** → expose `getOrCreateProvider()`. The existing `provider.register()` call moves inside the helper; subsequent calls return the same provider. `initLangfuseOtel()` becomes `addLangfuseProcessor(getOrCreateProvider())`.
2. **Stamp tenant_id on OTel spans.** In `traceAgent` (`packages/langfuse/src/traces.ts`), after `startActiveObservation`, also call `span.setAttribute('sendero.tenant_id', metadata.tenantId)` + `'sendero.user_id'` + `'sendero.surface'` + `'sendero.channel'` + `'sendero.turn_id'`. These become Phoenix-queryable attributes.
3. **Scaffold `@sendero/arize-phoenix`.** Mirror `@sendero/langfuse` package shape. `initPhoenixOtel()` calls `provider.addSpanProcessor(phoenixProcessor)` on the SAME provider. Add `@arizeai/openinference-instrumentation-vertexai` to capture Gemini in OpenInference shape.
4. **Extract dev-only gate.** Move `isCallerAllowed` from `report-knowledge-gap.ts` to `@sendero/tools/src/dev-gate.ts::assertDevOnlyToolAllowed(ctx)`. `report_knowledge_gap` updated to use it (no behavior change).
5. **Endpoint abstraction.** Ship `packages/arize-phoenix/docker-compose.yml` so demo recording can pivot to self-host if Phoenix Cloud rate-limits.

- **Eval gate (existing):** `bun langfuse:regression` keeps passing — Langfuse processor unchanged.
- **Eval gate (new):** integration test that one `generateText` call produces spans visible in BOTH Langfuse Cloud AND Phoenix Cloud, with `sendero.tenant_id` queryable on the Phoenix side.
- **Eval gate (new):** unit test that the dev-only gate refuses production-keyed callers across all 4 tools (12 conditions).
- **Perf gate:** existing turn p99 latency must not regress >5% post-double-export.

### PR2 — `recall_similar_turns` (the magic, part 1)

- Implement tool: embedding-similarity search via Phoenix REST API; filter by `sendero.tenant_id`, `eval ≥ 0.7`, age > 1h. Returns top-`limit` (default 3) with `provenance` tag.
- Persona slab: "Before planning a non-trivial turn, call `recall_similar_turns({ query: <user intent>, route: <if applicable> })`. **Recall is a hint, not authority** — re-fetch live offer prices before booking."
- Demo path: same SFO→LHR booking, cold vs warm. Cold = full search (~11 calls). Warm = recalls 2 prior turns, picks United Polaris in step 1, books in 4–5 steps.
- **Eval gate:** scenario `recall-warm-sfo-lhr` in `sendero-golden-turns`. Warm turn ≥30% faster (`scoreLatency`) + ≥1 fewer tool call.
- **Eval gate (security):** scenario `recall-cross-tenant-isolation` — plant a tenant-A trace; query as tenant-B; recall returns empty.
- **Eval gate (injection):** scenario `recall-rejects-low-eval` — plant a tenant-internal trace with `eval=0.4`; recall does not return it.

### PR3 — `find_resolved_gap` + self-healing loop (the magic, part 2 — the hackathon-bonus piece)

- Implement tool. Embedding-similarity recall against `sendero-resolved-gaps` Phoenix dataset (NOT hash-equality — model paraphrase breaks hashes).
- Persona slab edit, BEFORE the `report_knowledge_gap` line:

  > "Before reporting a knowledge gap, call `find_resolved_gap({ hypothesis, toolName, kind })`. If `found: true`, apply the documented fix from `mustMention` and retry the original tool. Only call `report_knowledge_gap` when no prior resolution exists."

- Seed `sendero-resolved-gaps` dataset with 4 dogfood bugs from CLAUDE.md (`documentImageUrl`, `request_human_handoff` kapso, `PASSPORT_VAULT_KEK`, `flowKey: 'trip_intake'`). Each entry tagged `provenance: 'human-curated'`.
- Demo: trigger `documentImageUrl` failure. Agent calls `find_resolved_gap` → applies fix → retries with `documentUrl` → succeeds. **No human in the loop.**
- **Eval gate:** scenario `self-heal-document-url`. mustMention `documentUrl`. mustNotMention `report_knowledge_gap`.
- **Eval gate:** paraphrase-tolerance test — same root cause expressed three ways must all match the seeded gap.

### PR4 — Auto-curation crons (compounds without human work)

- `phoenix-promote-successes` — every 6h. Pulls Langfuse traces with `eval ≥ 0.85` AND `outcome.confirmed_booking_id` exists AND `MeterEvent.status='paid'` from last window. Attaches to Phoenix `sendero-recall` dataset with `provenance: 'auto-promoted'`.
- `phoenix-promote-resolutions` — runs after `gaps:scan --resolve-stale-days`. Closed gaps (status=resolved + resolutionPrUrl) → Phoenix `sendero-resolved-gaps` with `provenance: 'human-curated'`.
- Idempotency: each Phoenix dataset row keyed on `metadata.sendero_id` (`traceId` for recall, `gapId` for resolutions). Pre-insert filter checks for existing row.
- Vercel cron entries.
- **Eval gate:** dataset row count grows over 24h dogfood without manual seeding. No dupe rows on cron re-fire.
- **Eval gate (injection):** auto-curation rejects a synthetic trace with `eval=0.95` but `MeterEvent.status='sandbox'` and no `confirmed_booking_id`.

### PR5 — Operator UI: Phoenix introspection panel (was PR7)

- `/dashboard/agent-trace/[traceId]` — single trace view rendering both Langfuse evals + Phoenix recall context.
- Read-only Phoenix MCP from operator session.
- **Hackathon-strong:** strong demo asset for sales calls; not gating but high-leverage.

### PR6 — x402 metering + A2A fabric (revenue surface) — POST-HACKATHON

> Deferred per autoplan v0.3 scope decision. Specification preserved in §4.6 + §4.7. Execution lands when an external A2A integration request arrives.

- `packages/arize-phoenix/src/metering.ts` — route-layer hook (no `ctx.caller.surface` field).
- `packages/billing/src/pricing.ts` — Phoenix price-cells (§4.6 table).
- `packages/auth/src/dispatch-auth.ts` — `introspection` scope.
- `apps/app/app/api/mcp/_mcp-app.ts` — Phoenix tools metered when surfaced via /api/mcp.
- `packages/cli/src/commands/phoenix/{recall,gap}.ts` — A2A CLI (committed-unpublished).
- `apps/claude-code-plugin/skills/phoenix-introspect/SKILL.md` — **human-dev** surface (repurposed; see §4.7).
- `apps/docs/content/docs/agents/phoenix-via-mcp.mdx` — A2A onboarding.

### ~~PR (cut) — `query_tool_performance`~~

Removed in autoplan v0.3. No real tool-pair fork in Sendero today; revisit post-PR4 if dogfood surfaces one.

---

## 7. Demo script (3-min hackathon video)

| Beat | Time | What viewer sees |
|---|---|---|
| Cold concierge | 0:00–0:45 | Sendero web concierge. Traveler: "Book SFO→LHR under $1,800, leave Thursday, return Sunday." Watch the agent: 11 tool calls, 22s latency, picks a Delta itinerary. |
| Phoenix dashboard | 0:45–1:15 | Cut to Phoenix. Show the trace tree from that turn — every step, tool, eval. Highlight: "We don't just ship traces; the agent itself can READ them." |
| Warm concierge (the magic) | 1:15–2:15 | Identical traveler, same intent. Agent's first call: `recall_similar_turns`. Phoenix returns the prior trace. Agent: "I see I booked United Polaris on this corridor twice with eval 0.92 — let me start there." 5 tool calls, 9s latency. Side-by-side the two traces in Phoenix. |
| Self-heal | 2:15–2:50 | Force the `documentImageUrl` regression. Agent fails once. Calls `find_resolved_gap`. Phoenix returns the closed gap from PR3 seed. Agent: "Resolved 2026-04-22 — try `documentUrl`." Retries. Succeeds. **No human in the loop.** |
| Pitch close | 2:50–3:00 | "Sendero + Phoenix — agents that learn between turns, not just within them." |

---

## 8. Test/eval plan (regression-resistant)

- **Existing:** `bun langfuse:regression` keeps the 8 golden turns. Unchanged.

**New scenarios in `sendero-golden-turns`:**
- `recall-warm-sfo-lhr` — warm turn ≥30% latency + ≥1 fewer tool call vs cold
- `self-heal-document-url` — embedding-recall self-heal, no `report_knowledge_gap` fired
- `recall-paraphrase-tolerance` — three paraphrases of the same root cause all match the same seeded gap

**Security / isolation tests (new):**
- `recall-cross-tenant-isolation` — plant tenant-A trace; query as tenant-B → empty
- `recall-rejects-low-eval` — planted trace with `eval<0.7` not returned
- `auto-curation-rejects-sandbox` — planted sandbox trace with `eval=0.95` but no `confirmed_booking_id` → not promoted
- `provider-singleton` — `initLangfuseOtel()` then `initPhoenixOtel()`; one global provider; both processors receive every span
- `tenant-id-on-span` — `traceAgent` produces span with queryable `sendero.tenant_id` attribute
- `phoenix-down-fail-soft` — Phoenix Cloud unreachable → tools return `{ available: false }`, agent plans cold; no throw
- `dev-gate-combinatoric` — 3 gate conditions × 4 tools = 12 unit tests:
  - prod env + sandbox key + tenant → refuse (env)
  - dev env + prod key + tenant → refuse (key)
  - dev env + sandbox key + no tenant → refuse (tenant)
  - dev env + sandbox key + tenant → allow

**Closed-loop dogfood test:**
- Sandbox turn that mismatches `documentImageUrl` does NOT add a new row to `KnowledgeGap` (self-healed via `find_resolved_gap`).
- 24h cron run produces non-zero `sendero-recall` + `sendero-resolved-gaps` dataset growth without manual seed.

---

## 9. GTM motions (`/gtm-motions` mapping)

Per the framework:

| Motion | Score | How Phoenix integration plays |
|---|---|---|
| **Partner** (primary) | 9/10 | Co-marketing with Arize. Hackathon submission = entry point. Joint case study post-hackathon if we win or place. Arize lists Sendero as Phoenix reference for vertical AI agents. |
| **Inbound** (primary) | 8/10 | Two technical posts: (a) "Demand-driven context for vertical AI agents — the Phoenix loop" (Raj credit), (b) "Closing observability between Langfuse + Phoenix — why we run both." Bait keywords: `agent self-improvement`, `phoenix mcp`, `vertical ai agent observability`. |
| **ABM** (secondary) | 7/10 | Sales asset for TMC outbound: "Our agent introspects its own trace history before every booking. The audit log isn't post-hoc — it's mid-turn." Use the warm-vs-cold demo on calls. Pair with the on-chain settlement story. |
| **Community** | 4/10 | Phoenix has an open-source community; modest fit. Skip until v0.2. |
| **PLG / Outbound / Paid** | n/a | Not the right shape for this beat. |

**Stack:** Partner-led launch (hackathon → joint post → reference) + Inbound (2 technical posts in 30 days) + ABM enablement (warm-vs-cold demo replaces feature pitch on TMC calls). 90-day path: hackathon submit (Jun 11) → result (~Jun 25) → Arize joint blog (Jul) → first TMC sales call using the demo (Jul) → second post (Aug) → reference customer.

---

## 10. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Phoenix Cloud free tier rate limits during demo recording | PR1 ships `docker-compose.yml`; demo recording can pivot to self-host. Cloud stays default. |
| OTel provider conflict — second `register()` call evicts first | PR1 refactors to **shared provider, two processors**. Spec §4.1 + §6 PR1.1 specify this. Provider-singleton test in §8 gates merge. |
| Cross-tenant trace leak — Phoenix span filter relies on `sendero.tenant_id` attribute that doesn't exist on AI-SDK-generated spans | PR1 stamps `sendero.tenant_id` directly on every active span via `traceAgent`. Cross-tenant-isolation test in §8 gates merge. |
| Prompt injection via planted "successful" trace — attacker biases future warm recalls | Auto-curation requires `eval ≥ 0.85` AND `outcome.confirmed_booking_id` exists AND `MeterEvent.status='paid'`. Recall results tagged `provenance`. Persona: "recall is a hint, not authority." Adversarial regression scenario in §8. |
| `recall_similar_turns` returns stale traces from broken pre-PR1 runs | Filter recall by `eval ≥ 0.7` AND `> 2026-05-15` (post-launch cutoff) AND age > 1h (blocks zero-day pollution). |
| Agent over-trusts recall and copies a stale plan when supplier prices changed | Persona slab explicitly says "Recall informs your starting point; you must still re-fetch live offer prices." Add to `mustMention` in regression. |
| Phoenix MCP goes down mid-turn | Both tools fail-soft: return `{ available: false }` instead of throwing. Persona: "if introspection unavailable, plan from scratch." Indistinguishable from cold path. |
| `find_resolved_gap` hash-equality misses paraphrase | Embedding-based recall (PR3), not hash. Paraphrase-tolerance test in §8 gates merge. |
| Rate-limit / latency from extra Phoenix hop adds turn latency | Recall capped at `limit: 3`. Single Phoenix call adds < 200ms; warm path saves 5–10s. Net win. PR1 perf gate caps p99 regression at <5%. |
| Dev-gate replication missed an edge case across the 4 tools | All 4 tools (existing `report_knowledge_gap` + 2 new) route through `assertDevOnlyToolAllowed(ctx)`. 12-test combinatoric in §8. |
| Hackathon judges flag "uses partner observability but doesn't self-improve" — bonus criterion | PR3 (`find_resolved_gap`) is the explicit answer. Without PR3, we lose the bonus. Treat as gating. |

---

## 11. Open questions

1. ~~**Phoenix Cloud or self-host?**~~ ✅ **RESOLVED — Phoenix Cloud** (workspace `tomas-cordero-esp`). API key wired locally. PR1 ships `docker-compose.yml` for demo-day fallback.
2. **OpenInference instrumentor: `vertexai` or `google-genai`?** Vertex direct is our canonical path (`apps/app/lib/agent-models.ts::resolveDirectModel`). Lean `vertexai`; add `google-genai` if gateway fallback needs it.
3. **Branch strategy.** Fork off `whatsapp-e2e` (current) into new `phoenix-loop` branch? Or rebase onto `main` first? Recommend rebase first — keeps the diff scoped to Phoenix work.
4. **Hackathon submission repo.** Devpost requires public repo + LICENSE. Recommend stripped fork at `github.com/sendero-app/phoenix-concierge-hackathon` mirroring relevant packages — full Sendero monorepo stays private.
5. ~~**x402 introspection scope default.**~~ Deferred — PR6 is post-hackathon. Decision lands when first external A2A integration is in pipeline.
6. ~~**A2A CLI publish timing.**~~ Deferred — already gated by mainnet-cutover; not on hackathon path.
7. **NEW — embedding model for recall + find_resolved_gap.** Phoenix supports `text-embedding-3-small` (OpenAI), Vertex embeddings, or self-supplied. Recommend Vertex `text-embedding-005` for tenant-data-residency consistency with Gemini. Decision in PR2.

---

## 12. What I need from you (one-shot)

To unblock PR1:

- [x] **Phoenix API key** — wired to `.env.local` (root + apps/app), Phoenix Cloud workspace `tomas-cordero-esp`. ⚠️ **Rotate this key after Vercel push** — it appeared in this session's chat history.
- [ ] **Vercel push** — REST returned 403 (token scope). Run `vercel login` then re-run the env-push block, or paste 4 vars (`PHOENIX_API_KEY`, `PHOENIX_BASE_URL`, `PHOENIX_COLLECTOR_ENDPOINT`, `PHOENIX_PROJECT_NAME`) into Vercel dashboard targeting all 3 envs.
- [ ] **Decision on open questions 2, 3, 4, 5, 6** above.
- [ ] **Approval to proceed** with PR1 (foundation, no agent behavior changes).

PR1 ships in ~half a day from approval. PR2/PR3 (the magic) over 2–3 days. PR6 (x402 + A2A revenue surface) over 2 more days. ~5 weeks buffer to June 11.

---

## 15. Plurai — three-plane eval mesh (v0.4 addendum)

Plurai (https://plurai.ai) joins the eval surface alongside Langfuse evaluators + Phoenix experiments. Where each fits:

| Plane | Tool | Audience | When | Cadence |
|---|---|---|---|---|
| **Production turn scoring** | Langfuse evaluators (`LANGFUSE_EVALUATORS=true`, 4 LLM-judges) | Platform / ops | Every traced turn, fire-and-forget | Continuous |
| **Curated dataset evals** | Phoenix experiments (PR2+) | Agent runtime | Recall + auto-curation candidate gates | Cron (every 6h) |
| **Developer vibe-evals** | **Plurai** (claude-code plugin) | Engineers iterating on prompts/tools | During dogfood loop, before merging | On demand |

### How Plurai plugs into the demand-driven loop

The current loop (`/raj-demand-driven-context` skill):

```
agent fails → report_knowledge_gap → bun gaps:scan → human reads board →
human walks Langfuse + Vercel + CF logs → ships fix → bun langfuse:regression (static)
```

The static `bun langfuse:regression` step is where Plurai inserts:

```
human reads board → human walks logs → ships fix →
  /plurai evals iterate (vibe-loop) →    ← NEW
  bun langfuse:regression (static gate)
```

Plurai lets engineers iterate on the **eval itself** in claude-code while staring at the failing trace. Static `bun langfuse:regression` becomes the post-iteration regression gate.

### Setup (user-side, not Sendero code)

The Plurai claude-code plugin is installed PER DEVELOPER, not committed:

```bash
/plugin marketplace add plurai-ai/plurai-plugins
/plugin install evals@plurai-plugins
```

No Sendero monorepo changes. Plugin reads Langfuse trace data via `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` already in `.env.local` and Phoenix data via `PHOENIX_API_KEY` (PR1 wired). Same env, three eval surfaces.

### Benchmark layer (post-hackathon)

Once PR2 lands (`recall_similar_turns`), we can run a controlled benchmark across all three planes:

| Trace dataset | Langfuse score | Phoenix experiment score | Plurai vibe-eval score | Delta |
|---|---|---|---|---|
| `sendero-golden-turns` (8 scenarios) | LLM-judge avg | Run vs `sendero-recall` dataset | Vibe-iterated suite | … |

Cross-vendor agreement on the SAME dataset = signal. Disagreement = signal that the eval is brittle, not the agent. This is a **post-hackathon** v0.5 deliverable; mentioned here to anchor the three-plane architecture before vendor-specific code lands.

### Why three vendors, not one

- **Langfuse** owns prompt management + production trace storage. Mature; can't replace.
- **Phoenix** owns agent-runtime introspection (recall + datasets queryable mid-turn). Hackathon-deliverable.
- **Plurai** owns developer eval iteration ergonomics. The "vibe" surface humans use.

Each addresses a distinct moment in the loop. Single-vendor consolidation defeats the demand-driven thesis (the whole point is multiple feedback signals compounding).

---

## 13. Reference

- `/raj-demand-driven-context` skill (this is the lead pattern).
- CLAUDE.md → "Demand-driven context (Raj's pattern, dev-only)".
- CLAUDE.md → "Observability + prompt management — Langfuse" (sibling pattern).
- Phoenix docs: https://docs.arize.com/phoenix
- Phoenix MCP: https://github.com/Arize-ai/phoenix/tree/main/integrations/mcp-server
- OpenInference instrumentors: https://github.com/Arize-ai/openinference
- Hackathon page: Devpost, Google Cloud Rapid Agent Hackathon — Arize track.
- a16z "Stay for Network" applied to Sendero: CLAUDE.md → "Wedge findings (a16z + YC RFS, applied)".
