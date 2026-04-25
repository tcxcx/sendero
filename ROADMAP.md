# ROADMAP — vertical-AI traveler-OS tool kernels

> **Heads-up.** Everything below is a **kernel of an idea, not a commitment.**
> None of these tools, workflows, or surfaces will be built until we have
> **initial traction or product validation with design partners** (a TMC, a
> corporate-travel buyer, a guest-travel ops lead, or a B2C concierge desk).
> The shape, scope, and naming will almost certainly change once a design
> partner pushes back. Treat this as a thinking artefact — useful as a
> conversation starter with partners, not as a sprint plan.

This document distills four Vercel reference templates into concrete tool
candidates that would extend Sendero's existing `@sendero/tools` registry,
MCP surface, OpenAPI spec, llms.txt manifest, and x402 dispatch layer
without rewriting any of them. The templates are MIT-licensed scaffolds —
the value they offer is the *architecture* (durable agents, HITL hooks,
schema-pinned categorization, sandboxed code exec), not the verticalized
copy. Sendero supplies the travel verticalization on top.

## Scaffold references

Four Vercel templates we want to learn from. Each one solves a problem
adjacent to a Sendero gap. Links are reproduced here so future sessions
can re-read source without leaving the repo.

| Template | Vercel page | Source repo | What it gives us |
|---|---|---|---|
| **Sales Call Summary Agent** | [vercel.com/templates/other/call-summary-agent](https://vercel.com/templates/other/call-summary-agent) | [vercel-labs/call-summary-agent-with-sandbox](https://github.com/vercel-labs/call-summary-agent-with-sandbox) | Webhook-driven summarization, Vercel Sandbox for safe agent code exec, structured output via Zod, ToolLoopAgent pattern. |
| **Slack Agent Template** | [vercel.com/templates/other/slack-agent-template](https://vercel.com/templates/other/slack-agent-template) | [vercel-partner-solutions/slack-agent-template](https://github.com/vercel-partner-solutions/slack-agent-template) | DurableAgent, threaded streaming, HITL approvals via Block Kit, `defineHook` / `hook.resume` for human-in-the-loop pauses, Slack Assistant pane. |
| **Lead Processing Agent** | [vercel.com/templates/other/lead-processing-agent](https://vercel.com/templates/other/lead-processing-agent) | [vercel-labs/lead-agent](https://github.com/vercel-labs/lead-agent) | Autonomous research agent (Exa.ai), `generateObject` schema-pinned categorization, personalized outreach generation, Slack approval gate before send. |
| **Chat SDK Knowledge Agent** | [vercel.com/templates/template/chat-sdk-knowledge-agent](https://vercel.com/templates/template/chat-sdk-knowledge-agent) | [vercel-labs/knowledge-agent-template](https://github.com/vercel-labs/knowledge-agent-template) | Docs-grounded chat **without a vector store** — `grep` / `find` / `cat` over a snapshot repo inside Vercel Sandbox. Smart-model routing (cheap classifier → expensive deep model), sandbox pooling, Vercel Chat SDK adapters for web / GitHub / Discord. |

All four are **Workflow DevKit + AI Gateway + AI SDK v6** — the same
runtime Sendero already runs on (`packages/workflows`, the AI Gateway
default in `Stack`, AI SDK across `runAgentTurn`). No platform migration
required. The integration is additive.

---

## Five tool kernels

Each kernel lists: the wedge (why we'd want it), the surface
(MCP / OpenAPI / x402 scope / channel), audience (`internal: true`
vs publicly advertised), prerequisites (concrete file paths to edit),
a kill criterion (what invalidates this kernel), and a starter
scaffold block. Scaffolds are conversation starters for the design-
partner discovery, not implementation tickets.

> **Convention notes for every scaffold below.** The canonical shape
> is `packages/tools/src/scan-document.ts` — `ToolDef` is **not**
> declared with generics in real code, every tool ships a hand-written
> `jsonSchema` (consumed by MCP `tools/list`) alongside the Zod
> `inputSchema`, and operator-only tools set `internal: true` (see
> `packages/tools/src/types.ts`). The output schemas shown in scaffolds
> below are documentation-only — they are not part of the `ToolDef`
> contract today. The `defineWorkflow(...)` / `step(...)` shape used
> in workflow scaffolds is **pseudocode** — confirm the actual API
> against an existing file in `packages/workflows/src/` before lifting.
> `generateObject` calls go through the AI Gateway-wrapped model
> resolver, not a bare `'openai/...'` string — see how `runAgentTurn`
> resolves models before copy-pasting Kernel 3's snippet verbatim.

> **Three integration footguns the kernels share.** (1) `toolToScope()`
> in `packages/tools/src/scopes.ts` is hand-maintained — every new
> tool name needs an explicit edit there or it silently falls into
> `'utilities'`. (2) Tools that move USDC, gate settlement, or pause
> a workflow run with privileged side effects (e.g. `request_approval`)
> belong in `PRIVILEGED_TOOLS` in the same file. (3) URL-fetching tools
> (Kernels 1, 3, 4) all need the SSRF guard currently private to
> `scan-document.ts` — extract `assertFetchableUrl` + `fetchDocument`
> into `@sendero/tools/safe-fetch` as a prerequisite primitive, not as
> a copy-paste-per-kernel task.

### Kernel 1 — Concierge Call Intelligence

> Reference: [call-summary-agent](https://github.com/vercel-labs/call-summary-agent-with-sandbox)

**Wedge.** TMCs and concierge desks still run a meaningful chunk of
high-touch trip planning over voice — supplier negotiations, premium-cabin
upgrades, group-rate calls, disruption recovery. Today those calls
disappear into someone's Notion or never get logged. Sendero already
owns the trip object — pulling the call into it as structured deltas
(action items, objections, supplier commitments, next-step deadlines)
lets the workflow runtime react to what was *said*, not just what was
*typed in chat*.

**Why it fits.** The call-summary template's `bash-tool` + Vercel Sandbox
pattern is exactly what we'd want for a tool that has to grep across a
multi-MB transcript without giving the agent raw shell on the production
worker. Sandbox's GA-since-Jan-2026 status (per Vercel session context)
makes this a low-risk dependency.

**Surface candidates.**
- New tool family `call_intelligence` added to `KEY_SCOPES` in
  `packages/tools/src/scopes.ts`. Default for production keys
  (read-mostly).
- Tools: `summarize_concierge_call`, `extract_supplier_commitments`,
  `triage_call_objections`.
- MCP / OpenAPI / llms.txt pickup is automatic — but only **after**
  each tool name is added to `toolToScope()` in
  `packages/tools/src/scopes.ts`. The catalog generator reads from
  there.
- Webhook entry: `POST /api/webhooks/call/<provider>` (Gong, Aircall,
  Dialpad, or a generic Twilio Voice handler) → kicks the
  `sendero.summarize_call` workflow.

**Audience.** All three tools default `internal: false` — concierge
ops + agency-admin operators may want to call them via API key.
Marked `internal: true` only if a partner asks for op-only restriction.

**Prerequisites (file-path checklist).**
1. Add `'call_intelligence'` to `KEY_SCOPES` in `packages/tools/src/scopes.ts`.
2. Add the three tool names to `toolToScope()` in the same file.
3. Add a `CallSummary` Prisma model in `packages/database/prisma/schema.prisma`.
4. Wire the SSRF-safe fetch util (see "Convention notes" footgun #3).
5. New webhook route file `apps/app/app/api/webhooks/call/[provider]/route.ts`.
6. New workflow file `packages/workflows/src/summarize-call.ts`.

**Kill if:** no design partner can name a single weekly recurring
voice-ops loop the team would willingly let an LLM summarize within
60 days of intro.

**Starter scaffold.**

```ts
// packages/tools/src/summarize-concierge-call.ts
//
// Kernel only — needs a design partner to confirm: which call provider,
// what fields actually matter to ops, whether the trip linkage is by
// PNR, by traveler email, or by a manual operator pick.

import { z } from 'zod';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  transcriptUrl: z
    .string()
    .url()
    .describe('HTTPS URL of the call transcript (Gong / Aircall / Twilio recording transcript). SSRF guard applies.'),
  tripId: z
    .string()
    .optional()
    .describe('Sendero trip id to attach the summary to. If omitted, the agent attempts to resolve via traveler email mentioned in the transcript.'),
  participantHints: z
    .array(z.string())
    .optional()
    .describe('Known participant emails / display names — speeds up speaker attribution.'),
});

const outputSchema = z.object({
  summary: z.string(),
  actionItems: z.array(z.object({
    owner: z.string(),
    due: z.string().optional(),
    text: z.string(),
  })),
  supplierCommitments: z.array(z.object({
    supplier: z.string(),
    commitment: z.string(),
    confidenceScore: z.number().min(0).max(100),
  })),
  objections: z.array(z.object({
    raisedBy: z.string(),
    text: z.string(),
    handled: z.boolean(),
    handlingScore: z.number().min(0).max(100),
  })),
});

export const summarizeConciergeCall: ToolDef = {
  name: 'summarize_concierge_call',
  description: 'Extract structured action items, supplier commitments, and objection handling from a concierge / TMC call transcript.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['transcriptUrl'],
    properties: {
      transcriptUrl: { type: 'string', format: 'uri' },
      tripId: { type: 'string' },
      participantHints: { type: 'array', items: { type: 'string' } },
    },
  },
  // outputSchema documented above for reader clarity — not part of the
  // ToolDef contract today; the runtime trusts the handler's return type.
  async handler(input: z.infer<typeof inputSchema>, ctx?: ToolContext) {
    // TODO(design-partner): confirm the provider catalog before wiring up
    // a real fetcher. For the kernel: fetch transcript via SSRF-guarded
    // util (mirror the guards from packages/tools/src/scan-document.ts),
    // run AI SDK generateObject() pinned to outputSchema, persist to
    // CallSummary table, return structured payload.
    throw new Error('not implemented — design-partner gate');
  },
};
```

```ts
// packages/workflows/src/summarize-call.ts (sketch)
//
// Triggered by /api/webhooks/call/<provider>. Mirrors sendero.book_flight
// shape — durable, encrypted-by-default per the Vercel Workflows guarantee
// already documented in README.md.

import { defineWorkflow, step } from '@sendero/workflow-runtime';

export const summarizeCallWorkflow = defineWorkflow('sendero.summarize_call', {
  input: z.object({ transcriptUrl: z.string().url(), tripId: z.string().optional() }),
  async run({ input, tools }) {
    const summary = await step('extract', () => tools.summarize_concierge_call(input));
    await step('attach-to-trip', () => persistCallSummary(summary, input.tripId));
    await step('notify-ops', () => notifyOps(summary)); // routes through one-share-many-channels per design-travel-experience-ai
    return summary;
  },
});
```

---

### Kernel 2 — HITL Slack approvals + Slack Assistant pane

> Reference: [slack-agent-template](https://github.com/vercel-partner-solutions/slack-agent-template)

**Wedge.** Sendero already has Slack OAuth, signed-state, events, and
interactions wired (see `apps/app/app/api/webhooks/slack/*` and the
CLAUDE.md "Slack OAuth state" section). What we don't have yet is a
first-class **human-in-the-loop approval primitive** that pauses a
workflow run mid-flight and resumes when an admin clicks an Approve /
Reject button. Today, risky operator actions (cancel a confirmed flight,
override a policy guard, refund > $X, sweep an MSCA balance) either
auto-execute or require an out-of-band ack. The slack-agent template's
`defineHook` + `hook.resume` pattern is exactly the missing piece.

**Why it fits.** Vercel Workflows already supports suspension and
resumption — this is the encrypted-by-default property the README leans
on for `sendero.book_flight`'s overnight ticketing wait. Wiring an
approval card into that same primitive means the operator-approval queue
at `/dashboard/admin-retries` and the Slack approval message become
**two views of the same paused workflow run**, not parallel systems.

**Surface candidates.**
- New tool `request_approval` in `packages/tools/src/`, scope
  `settlement` (it gates settlement-class side effects). **Also
  belongs in `PRIVILEGED_TOOLS`** in `packages/tools/src/scopes.ts` —
  any tool that pauses a workflow on a humans-with-money decision is
  privileged by definition, regardless of which downstream tool the
  approval ultimately unblocks.
- Sibling tool `evaluate_travel_policy` (scope `bookings`) — runs the
  tenant's `TransferPolicy` + `ReputationPolicy` pre-check before the
  agent even reaches `reserve_booking`. `request_approval` fires only
  when `evaluate_travel_policy` returns `requiresApproval: true`. This
  split lets the cheap deterministic check stay cheap.
- Slack-side helpers (not LLM-callable, used by the events route):
  `slack_search_threads`, `slack_assistant_summarize_thread`.
- The Slack Assistant pane (right-hand side panel) becomes the
  proactive nudge surface — disruption alerts, approval queue, daily
  trip digests. Same `share` payload as every other channel adapter.

**Audience.** `request_approval` is publicly advertised (`internal: false`)
because partner agents need to pause and ask. The `slack_*` helpers are
`internal: true` — operator-only orchestration, not customer-facing tools.

**Prerequisites (file-path checklist).**
1. Add `request_approval` and `evaluate_travel_policy` to `toolToScope()`
   in `packages/tools/src/scopes.ts`.
2. Add `request_approval` to `PRIVILEGED_TOOLS` in the same file.
3. Confirm `defineHook` / `hookResume` API against the actual
   `@sendero/workflow-runtime` exports (today's CLAUDE.md mentions
   Workflow DevKit but doesn't pin the API surface).
4. Extend `apps/app/app/api/webhooks/slack/interactions/route.ts` with
   the new `sendero_approval.{approve,reject}` action_ids — re-use
   the existing HMAC + 5-min replay window + install-resolve gates.
5. The `action.value` payload must be wrapped in a Sendero-signed
   envelope (HMAC over `hookId|exp` using `SLACK_STATE_SECRET`),
   mirroring `apps/app/lib/slack-oauth-state.ts`. Block Kit `value`
   strings are bot-supplied, so the envelope is what proves
   authenticity at resume time.

**Kill if:** the first design partner says "we'd rather just get a
push notification and click a link" — at which case the kernel
collapses to a magic-link approval page and the Slack-card surface
becomes a v2 nice-to-have.

**Starter scaffold.**

```ts
// packages/tools/src/request-approval.ts
//
// HITL primitive. Pauses the calling workflow run and posts a Block Kit
// card to the configured approver(s). Resume happens via the existing
// /api/webhooks/slack/interactions route, which routes the action to
// hook.resume(approval.hookId, { decision }).

import { z } from 'zod';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  action: z.string().describe('Human-readable description of the action being approved. e.g. "Cancel confirmed booking BK-2026-0421-001 and refund $1,840 to traveler wallet."'),
  reason: z.string().describe('Why approval is needed — pulled from the policy that triggered the gate. e.g. "Refund > $1k threshold", "Outside corporate policy: business class on flight under 4h"'),
  channel: z.enum(['slack', 'email', 'web']).default('slack'),
  approvers: z.array(z.string()).optional().describe('User ids or email addresses. If omitted, falls back to tenant.metadata.approvalRouting.'),
  timeoutSeconds: z.number().default(86_400).describe('How long to wait before auto-rejecting (default 24h).'),
});

export const requestApproval: ToolDef = {
  name: 'request_approval',
  description: 'Pause the workflow run and request human approval. Resumes automatically when the approver clicks Approve / Reject in Slack (or replies via the configured channel).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['action', 'reason'],
    properties: {
      action: { type: 'string' },
      reason: { type: 'string' },
      channel: { type: 'string', enum: ['slack', 'email', 'web'] },
      approvers: { type: 'array', items: { type: 'string' } },
      timeoutSeconds: { type: 'number' },
    },
  },
  async handler(input: z.infer<typeof inputSchema>, ctx?: ToolContext) {
    // TODO(design-partner): confirm approver routing model. Today's plan:
    //   1. resolve approvers → fall back to tenant.metadata.approvalRouting
    //   2. post Block Kit card via @sendero/slack
    //   3. defineHook({ kind: 'approval', tripId, refundCents, ... })
    //   4. await hook with timeoutSeconds → auto-reject on timeout
    //   5. mirror to /dashboard/admin-retries so web admins can also resolve
    throw new Error('not implemented — design-partner gate');
  },
};
```

```ts
// apps/app/app/api/webhooks/slack/interactions/route.ts (delta)
//
// The route already exists with HMAC + 5-min replay window +
// install-resolve gates intact (see CLAUDE.md "Slack webhook routes").
// The kernel addition is the new action_id namespace plus a
// Sendero-signed envelope around the hookId so the resume path can't
// be forged from a hand-crafted Block Kit value.

import { hookResume } from '@sendero/workflow-runtime'; // pseudocode — confirm against @sendero/workflow-runtime exports
import { verifySenderoEnvelope } from '@sendero/auth/envelope'; // mirrors slack-oauth-state.ts pattern

if (action.action_id === 'sendero_approval.approve' || action.action_id === 'sendero_approval.reject') {
  // action.value is bot-supplied — never trust it raw.
  const { hookId, exp } = verifySenderoEnvelope(action.value, process.env.SLACK_STATE_SECRET!);
  if (Date.now() / 1000 > exp) throw new Error('approval card expired');

  await hookResume(hookId, {
    decision: action.action_id === 'sendero_approval.approve' ? 'approve' : 'reject',
    approvedBy: payload.user.id,
  });
  // Existing chat.update card swap stays — operator sees confirmation in-thread.
}
```

---

### Kernel 3 — Inbound qualification + travel-research agent

> Reference: [lead-agent](https://github.com/vercel-labs/lead-agent)

**Wedge.** Two distinct surfaces both need the same machinery:

1. **GTM lead intake.** Today the marketing site's "talk to sales" form
   drops into an inbox. The lead-agent template gives us a one-shot
   pipeline: qualify (QUALIFIED / FOLLOW_UP / SUPPORT / SPAM), research
   the company via Exa, draft the personalized reply, gate on Slack
   approval before send. Direct lift, minor copy changes.

2. **Traveler / guest intake research.** When a guest claims a Peanut-
   style escrow link, an agent can pre-research the destination, the
   traveler's prior trips, expected visa friction, and surface a
   tailored welcome card *before* the human types anything. Sherpa's
   visa API (pending) plugs in cleanly here. Until then, the Exa
   research tool is a credible v0.

**Why it fits.** The `generateObject` schema-pinned categorization
pattern is identical to the OCR philosophy already documented in the
README ("Zod schemas pin Gemini's output. The schema IS the contract.").
Same discipline, applied to inbound triage: never hand-parse free text
when a Zod schema can pin the output.

**Surface candidates.**
- New tool family `research` (could fold into existing `utilities`).
- Tools: `web_research_destination`, `web_research_supplier_reputation`,
  `web_research_visa_changes` (sunsets when Sherpa lands), `triage_inbound_request`.
- Workflow `sendero.qualify_inbound_lead` — webhook from marketing form
  → categorize → research → draft → request_approval (Kernel 2) → send.

**Audience.** `triage_inbound_request` and `web_research_*` are public
(`internal: false`) — partner agents researching destinations on
behalf of travelers is a primary use case. The lead-qualification
workflow that wraps them stays operator-only via API-key scope, not
via `internal: true` on the tools themselves.

**Posture note.** This kernel pulls double duty: GTM (marketing-form
qualification) AND product (traveler/guest intake research).
Sequence the **traveler-intake half first** — it composes with
`prefund_trip`, `guest_claim_link`, and the existing welcome flow.
The GTM lift is a 2-hour copy job once the underlying tools exist.

**Prerequisites (file-path checklist).**
1. Add the four tool names to `toolToScope()` in
   `packages/tools/src/scopes.ts`.
2. New workflow file `packages/workflows/src/qualify-inbound-lead.ts`.
3. Re-use the same SSRF-safe fetch util from Kernel 1's checklist.
4. Configure Exa.ai API key as an env var; document in `.env.example`.
5. The model resolver in the scaffold below must go through the
   AI Gateway wrapper — see `runAgentTurn` in `packages/agent/` for
   the canonical pattern.

**Kill if:** the design partner's existing CRM (HubSpot, Salesforce,
Pipedrive) already has a "lead score" column the sales team trusts
within 90 days of intro. At that point, qualification belongs in the
CRM, and Sendero only needs the research subset (which folds into
the broader `utilities` scope as a one-off addition).

**Starter scaffold.**

```ts
// packages/tools/src/triage-inbound-request.ts
//
// Schema-pinned categorization. Same trick as @sendero/ocr — give the
// LLM a tight enum, get back a deterministic bucket the workflow router
// can switch on without parsing prose.

import { z } from 'zod';
import { generateObject } from 'ai';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  channel: z.enum(['marketing_form', 'whatsapp', 'slack', 'email']),
  body: z.string().describe('Raw inbound message / form body.'),
  sender: z.object({ email: z.string().email().optional(), phone: z.string().optional(), name: z.string().optional() }),
});

const outputSchema = z.object({
  category: z.enum([
    'qualified_buyer',          // routes to sales workflow
    'qualified_traveler',       // routes to onboarding workflow
    'support_request',          // routes to /dashboard/admin-retries
    'follow_up',                // routes to drip sequence
    'spam',                     // dropped, logged
  ]),
  confidence: z.number().min(0).max(100),
  reasoning: z.string(),
  intent: z.string().describe('One-sentence summary of what the sender actually wants.'),
});

export const triageInboundRequest: ToolDef = {
  name: 'triage_inbound_request',
  description: 'Bucket an inbound message / form submission into a routing category before any downstream workflow fires.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['channel', 'body', 'sender'],
    properties: {
      channel: { type: 'string', enum: ['marketing_form', 'whatsapp', 'slack', 'email'] },
      body: { type: 'string' },
      sender: { type: 'object' },
    },
  },
  async handler(input: z.infer<typeof inputSchema>, ctx?: ToolContext) {
    // TODO(design-partner): confirm category taxonomy with first TMC partner.
    // Likely splits further (qualified_buyer → corporate vs agency vs guest).
    //
    // Model resolution MUST go through the AI Gateway wrapper used by
    // runAgentTurn — a bare 'openai/gpt-4o-mini' string bypasses both
    // the gateway and the nanopayment-discount table on plan tiers.
    const { resolveGatewayModel } = await import('@sendero/agent/gateway');
    return generateObject({
      model: resolveGatewayModel({ task: 'triage', tier: 'cheap' }),
      schema: outputSchema,
      prompt: `Categorize this inbound ${input.channel} message...`,
    }).then((r) => r.object);
  },
};
```

```ts
// packages/workflows/src/qualify-inbound-lead.ts (sketch)
//
// Mirrors the lead-agent template flow, with two Sendero-specific deltas:
//   1. Routes through request_approval (Kernel 2) before any outbound send.
//   2. The "research" step also writes to the trip context so a
//      qualified_traveler categorization warms the welcome card before
//      the user lands on /app for the first time.

export const qualifyInboundLeadWorkflow = defineWorkflow('sendero.qualify_inbound_lead', {
  input: z.object({ channel: z.string(), body: z.string(), sender: z.object({}).passthrough() }),
  async run({ input, tools }) {
    const triage = await step('triage', () => tools.triage_inbound_request(input));
    if (triage.category === 'spam') return { dropped: true };

    const research = await step('research', () => tools.web_research_destination({
      query: input.sender.email ?? input.body.slice(0, 200),
    }));

    const draft = await step('draft-reply', () => tools.draft_personalized_reply({
      triage, research, sender: input.sender,
    }));

    const approval = await step('approval', () => tools.request_approval({
      action: `Send personalized reply to ${input.sender.email}`,
      reason: `Triage: ${triage.category} (${triage.confidence}%)`,
      channel: 'slack',
    }));

    if (approval.decision === 'reject') return { dropped: true, reason: approval.note };

    await step('send', () => tools.send_email({ to: input.sender.email, body: draft.body }));
    return { sent: true, triage, approvedBy: approval.approvedBy };
  },
});
```

---

### Kernel 4 — Docs-grounded chat without a vector store

> Reference: [knowledge-agent-template](https://github.com/vercel-labs/knowledge-agent-template)

**Wedge.** Sendero already maintains a deep, structured corpus: docs at
`apps/docs/content`, help articles at `apps/help`, the canonical OpenAPI
spec, the per-page `.md` exports, and the live tool registry. A
customer or partner asking "how do I issue a guest pass via API?"
shouldn't have to read five tabs — they should be able to ask in chat
and get a citation-grounded answer pointing at the exact MDX section,
the exact tool, and the exact `curl`. The knowledge-agent template
solves this **without** standing up a vector DB: it `grep`s and `cat`s
files inside a Vercel Sandbox over a snapshot repo. For Sendero, where
the docs already live in git and the MCP catalog is the source of
truth, this is a much better fit than embeddings.

**Why it fits.** Three reasons:

1. **No vector DB to provision, embed, re-embed, or stale-evict.** Our
   docs change with every PR; embedding pipelines lag. `grep` over a
   git-cloned snapshot is always current.
2. **The "smart-model routing" (cheap classifier → expensive deep
   model) maps cleanly onto the existing AI Gateway setup** and the
   nanopayment cost story. A simple "what plan tier supports X?" query
   shouldn't burn Opus tokens.
3. **The Vercel Chat SDK adapter pattern** (web / GitHub / Discord)
   composes with Sendero's existing one-share-many-channels model
   (WhatsApp / Slack / web / email) — same shape, additional adapters.

**Surface candidates.**
- New tool `search_sendero_docs` (scope: `utilities`) — agent-callable
  grep over the docs snapshot. Useful inside `runAgentTurn` when a
  traveler-facing answer needs a citation.
- Public-facing chat at `help.sendero.travel/chat` (and embedded in
  `/dashboard/help`) backed by the same engine.
- Admin agent pattern: a `query_ops_metrics` tool that lets a tenant
  admin ask "how many bookings settled this week?" in natural language
  — answers grounded in the existing `MeterEvent` / `WorkflowRun` /
  `TransferAttempt` tables rather than a custom dashboard.
- Sandbox pool reused from Kernel 1's call-intelligence transcript
  search — one infra, two consumers.

**Audience.** `search_sendero_docs` is publicly advertised
(`internal: false`) — partner agents grounding answers in our docs
is the whole point. `query_ops_metrics` is `internal: true` (operator
admin only) since it touches per-tenant settlement state.

**Metering.** Sandbox spawn time gets folded into the
`MeterEvent.priceMicroUsdc` for `search_sendero_docs` as a fixed
surcharge above the LLM cost; the warm-pool baseline is platform
overhead absorbed into the SaaS leg, not metered per call.

**Prerequisites (file-path checklist).**
1. Add `search_sendero_docs` and `query_ops_metrics` to `toolToScope()`
   in `packages/tools/src/scopes.ts`. Mark `query_ops_metrics` as
   `internal: true` in its `ToolDef`.
2. New workflow file `packages/workflows/src/sync-docs-snapshot.ts`.
3. Add the two cron entries to `vercel.ts` (snapshot rebuild +
   sandbox warm-up).
4. Vercel Blob bucket for the published snapshot — env vars in
   `.env.example`.
5. Add a smart-routing eval suite (cheap-vs-deep model selection
   correctness) — same shape as the existing OCR eval harness.

**Kill if:** existing `/api-viewer` + per-page `.md` traffic doesn't
indicate any unmet "I want to ask a question" demand within 90 days
of v0 (measure: how many `?q=...` URL params land on docs pages,
how many docs-search queries get logged with zero clicks afterward).

**Starter scaffold.**

```ts
// packages/tools/src/search-sendero-docs.ts
//
// Grep-based docs search inside a Vercel Sandbox. No embeddings, no
// vector DB, no re-index pipeline. The snapshot is rebuilt nightly
// from the same git that ships the docs site, so the corpus is
// always at most 24h behind production.

import { z } from 'zod';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  query: z.string().min(2).describe('Natural-language question or search term. The tool runs `grep -ri` for keywords AND a small LLM-powered intent expander for synonyms.'),
  surface: z
    .enum(['docs', 'help', 'openapi', 'all'])
    .default('all')
    .describe('Which corpus to search. docs = apps/docs/content, help = apps/help, openapi = the generated spec, all = everything.'),
  maxResults: z.number().min(1).max(20).default(5),
});

const outputSchema = z.object({
  results: z.array(z.object({
    path: z.string().describe('Source path inside the snapshot, e.g. apps/docs/content/docs/security.mdx'),
    snippet: z.string().describe('Context window around the match.'),
    citation: z.string().url().describe('Public URL where the source can be linked from a chat response.'),
    confidence: z.number().min(0).max(100),
  })),
  modelUsed: z.enum(['cheap', 'deep']).describe('Which routing tier handled this query — surfaced for cost observability.'),
});

export const searchSenderoDocs: ToolDef = {
  name: 'search_sendero_docs',
  description: 'Search the Sendero docs / help / OpenAPI corpus and return cited snippets. Grounded — every response carries a public URL the user can verify.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 2 },
      surface: { type: 'string', enum: ['docs', 'help', 'openapi', 'all'] },
      maxResults: { type: 'number', minimum: 1, maximum: 20 },
    },
  },
  async handler(input: z.infer<typeof inputSchema>, ctx?: ToolContext) {
    // TODO(design-partner): confirm whether a per-tenant snapshot makes
    // sense (tenant-scoped runbooks, private MCP catalog) or whether the
    // single global snapshot is enough for v0. Today's plan:
    //   1. Spawn a sandbox from the pre-pooled snapshot
    //   2. Classify query complexity → pick cheap vs deep model via AI Gateway
    //   3. Run grep -ri inside sandbox, scoped by `surface`
    //   4. Stream results back, attach public-URL citations
    //   5. Persist trace for the smart-routing eval harness
    throw new Error('not implemented — design-partner gate');
  },
};
```

```ts
// packages/workflows/src/sync-docs-snapshot.ts (sketch)
//
// Nightly cron via vercel.ts. Builds the snapshot the search tool
// queries against. Mirrors the knowledge-agent template's content-sync
// pattern but reads from our own git rather than external sources.

import { z } from 'zod';
import { defineWorkflow, step } from '@sendero/workflow-runtime';

export const syncDocsSnapshotWorkflow = defineWorkflow('sendero.sync_docs_snapshot', {
  input: z.object({}),
  async run({ tools }) {
    await step('clone', () => cloneFromGitHubMain());
    await step('emit-openapi', () => writeFile('snapshot/openapi.json', await fetchOpenApi()));
    await step('flatten-mdx', () => stripFrontmatterAcrossDocs()); // mirrors apps/docs/app/docs/[[...slug]].md/route.ts
    await step('publish', () => uploadSnapshotToBlob()); // Vercel Blob, public read
    await step('warm-pool', () => prewarmSandboxPool({ count: 4 }));
    return { ok: true, snapshotAt: new Date().toISOString() };
  },
});
```

```ts
// vercel.ts addition (kernel sketch)
//
// Schedule the snapshot rebuild + a low-frequency sandbox-pool warmer
// so the first user-facing chat after a deploy doesn't pay the cold-
// start tax.

import { type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  // ...existing config
  crons: [
    { path: '/api/cron/sync-docs-snapshot', schedule: '0 4 * * *' }, // nightly @ 04:00 UTC
    { path: '/api/cron/warm-sandbox-pool', schedule: '*/15 * * * *' }, // top-up every 15min
  ],
};
```

---

### Kernel 5 — Disruption-recovery (IROPS) agent

> Reference: composes `cancel_booking`, `request_order_change`,
> `request_approval` (Kernel 2), and the existing `sendero.book_flight`
> workflow. No new external template — the wedge is in the *wiring*.

**Wedge.** Every TMC ops lead measures themselves on **minutes saved
during irregular operations**: a flight cancels at 22:30, a connection
gets missed in transit, a hotel walks the guest at check-in. Today
that loop is 3-7 humans + a phone tree + Slack DMs + a frantic Sabre
session. None of the four kernels above touches it directly, and it's
the single highest-pain wedge a TMC buyer will name on the first call.
The pieces already exist in the Sendero codebase — `cancel_booking`,
`request_order_change`, the `cancellationRecoveryWorkflow` mentioned
in the README, `request_approval` from Kernel 2, the
`travel_safety_aid` Google-Maps tool, the `share` payload that lets
one decision land on WhatsApp + Slack + email + web at once. The
kernel here is the **orchestrator** that strings them together, not a
new vertical capability.

**Why it's missing from Kernels 1-4.** This kernel is the moat
extension; Kernels 1, 3, 4 are GTM / DX kernels and Kernel 2 is the
HITL primitive that this one consumes. We split it out because the
disruption loop has its own design-partner shape (an ops lead, not a
buyer), its own success metric (minutes-to-rebook), and its own
failure mode (a wrong rebook is worse than a slow rebook).

**Surface candidates.**
- New workflow `sendero.recover_from_disruption` — input is a supplier
  webhook (cancellation, schedule change, NO-OP fail) or an inbound
  WhatsApp/Slack message that the agent classifies as a disruption.
- New tool `propose_rebook_options` (scope: `bookings`) — runs supplier
  search constrained to the existing PNR + traveler context, scores
  options on policy fit + minutes-of-disruption + dollar delta.
- Re-uses `request_approval` (Kernel 2) when the rebook crosses a
  policy threshold (e.g. cabin-class up, > $X delta, more than one
  alternative airport).
- Re-uses `triage_inbound_request` (Kernel 3) to classify whether an
  inbound message is a disruption signal or a routine request.

**Audience.** All disruption tools default `internal: false` — TMC
agents calling Sendero programmatically need them. The internal
`disruption_dashboard_query` tool (a thin wrapper over
`query_ops_metrics` from Kernel 4) is `internal: true`.

**Prerequisites (file-path checklist).**
1. Confirm `cancellationRecoveryWorkflow` actually exists at
   `packages/workflows/src/cancellation-recovery.ts` (referenced in
   the README — verify before lifting). If it does, refactor it as
   the implementation; if not, treat this as a green-field workflow.
2. Add `propose_rebook_options` to `toolToScope()`.
3. Wire supplier disruption webhooks to a new route
   `apps/app/app/api/webhooks/supplier/disruption/route.ts`.
4. Confirm Kernel 2 has shipped — this kernel hard-depends on
   `request_approval`.

**Kill if:** the design partner says "actually we want the LLM to
rebook autonomously without an approval gate" — at which point this
kernel collapses to a 1-week feature, not a multi-month build, and
the wedge is much smaller than we thought.

**Starter scaffold.**

```ts
// packages/tools/src/propose-rebook-options.ts
//
// Reads the existing PNR + traveler context, fans out a constrained
// search, scores results by (policy fit) × (minutes saved) × (dollar
// delta). Surface only the top 3 — humans pick faster from 3 than from 30.

import { z } from 'zod';
import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  bookingId: z.string(),
  disruptionKind: z.enum(['cancelled', 'schedule_change', 'denied_boarding', 'misconnect']),
  travelerNotes: z.string().optional().describe('Free-text from the traveler if they reached out via channel.'),
  maxOptions: z.number().min(1).max(5).default(3),
});

export const proposeRebookOptions: ToolDef = {
  name: 'propose_rebook_options',
  description: 'Score and propose rebook options for a disrupted booking. Top-N only — designed for fast human decisioning, not exhaustive comparison.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['bookingId', 'disruptionKind'],
    properties: {
      bookingId: { type: 'string' },
      disruptionKind: { type: 'string', enum: ['cancelled', 'schedule_change', 'denied_boarding', 'misconnect'] },
      travelerNotes: { type: 'string' },
      maxOptions: { type: 'number', minimum: 1, maximum: 5 },
    },
  },
  async handler(input: z.infer<typeof inputSchema>, ctx?: ToolContext) {
    // TODO(design-partner): which scoring weights actually predict acceptance?
    // Hypothesis: minutes-of-delay >> policy-fit >> dollar-delta. Validate.
    throw new Error('not implemented — design-partner gate');
  },
};
```

```ts
// packages/workflows/src/recover-from-disruption.ts (sketch)
//
// Triggered by supplier webhook OR by the inbound channel router when
// a traveler message classifies as a disruption signal.

export const recoverFromDisruptionWorkflow = defineWorkflow('sendero.recover_from_disruption', {
  input: z.object({ bookingId: z.string(), trigger: z.enum(['supplier_webhook', 'traveler_inbound']) }),
  async run({ input, tools }) {
    const options = await step('propose', () => tools.propose_rebook_options({
      bookingId: input.bookingId,
      disruptionKind: 'cancelled', // resolved earlier in real impl
    }));

    // If the top option is policy-clean and < $X delta, push as a "we
    // already rebooked you" notification + open a 30s undo window.
    // Otherwise gate on request_approval.
    const topOption = options.results[0];
    if (topOption.policyClean && topOption.dollarDelta < 250_00) {
      await step('notify-and-rebook', () => tools.confirm_booking({ bookingId: input.bookingId, optionId: topOption.id }));
      return { autoRebooked: true, option: topOption };
    }

    const approval = await step('approval', () => tools.request_approval({
      action: `Rebook ${input.bookingId} on ${topOption.summary}`,
      reason: `Outside policy: ${topOption.policyReason} (delta $${topOption.dollarDelta / 100})`,
      channel: 'slack',
      timeoutSeconds: 30 * 60, // 30min — IROPS is time-critical
    }));

    if (approval.decision === 'approve') {
      await step('confirm', () => tools.confirm_booking({ bookingId: input.bookingId, optionId: topOption.id }));
      return { autoRebooked: false, option: topOption, approvedBy: approval.approvedBy };
    }

    // Reject path: hand to a human via the operator queue.
    await step('escalate', () => tools.escalate_to_operator({ bookingId: input.bookingId, options }));
    return { escalated: true };
  },
});
```

---

## Cross-cutting capabilities (smaller, lower-risk)

These are smaller primitives the four templates surface that are
broadly useful across the existing tool catalog. None of them is a
full kernel on its own — they're shared utilities.

| Primitive | Source | Where it lands in Sendero |
|---|---|---|
| **Shared SSRF-safe fetch util** | (prerequisite, blocks Kernels 1, 3, 4) | Extract `assertFetchableUrl` + `fetchDocument` from `packages/tools/src/scan-document.ts` into `@sendero/tools/safe-fetch`. Today they are private to that file; three of the kernels above need them and copy-paste-per-kernel is the wrong move. Land first, then unblock the rest. |
| **Vercel Sandbox for safe agent code exec** | call-summary-agent + knowledge-agent | New `sandbox_run` utility tool (scope: `utilities`). Lets the agent run grep / awk / jq across large transcripts or attached PDFs without raw shell. Same sandbox pool also powers Kernel 4's docs search and Kernel 1's transcript grep — one infra, multiple consumers. |
| **Smart-model routing (cheap classifier → deep model)** | knowledge-agent | Apply at the AI Gateway layer to every priced tool call. Reduces nanopayment burn and customer-side cost on simple queries. Worth landing standalone — benefits every existing tool, not just the new kernels. |
| **Vercel Chat SDK adapter pattern** | knowledge-agent | Already partly mirrored by the one-share-many-channels pattern. The SDK's GitHub / Discord adapters are credible additions to the WhatsApp / Slack / web / email set, especially for community-led travel ops (e.g. group-trip Discords). |
| **Exa.ai web research** | lead-agent | `web_research_*` tools listed under Kernel 3. Also useful as a fallback for `recommend_restaurants` when Google Places returns zero results in long-tail destinations. |
| **`generateObject` schema-pinned triage** | lead-agent | Same discipline already used in `@sendero/ocr`. Apply to inbound message routing, supplier-email parsing, and disruption-recovery decision trees. |
| **`defineHook` / `hook.resume` HITL primitive** | slack-agent-template | Underpins `request_approval` (Kernel 2). Also useful for guest-claim workflows that pause until the guest picks an offer card. |
| **DurableAgent + chatStream pattern** | slack-agent-template | Already partly in `runAgentTurn`. The template's clean separation of "tool = step, hook = pause" is worth back-porting to make the agent loop more obviously durable to contributors. |

---

## What gets us free, automatically

Because Sendero treats `@sendero/tools` as the single source of truth,
adding any of the kernels above also extends:

- **`/api/openapi.json`** — new tools appear as tagged OpenAPI operations
  (per `packages/tools/src/openapi.ts`).
- **Scalar viewer at `/api-viewer`** — interactive try-it-out for free.
- **MCP at `/mcp` and `/api/mcp`** — `tools/list` picks them up.
- **`/llms.txt` across all five surfaces** — `packages/llms/src/catalog.ts`
  builds the manifest from the same registry.
- **x402 metering + scope enforcement** — `toolToScope()` in
  `packages/tools/src/scopes.ts` is the only thing to update; the
  dispatch route filters tools by scope before the LLM ever sees them.
- **Per-page `.md` docs** — every new MDX file in `apps/docs/content/docs`
  ships with a `.md` companion via the catch-all route.

This is the leverage that makes "kernel of an idea" cheap to validate —
once the design partner says yes, the tool surfaces everywhere with no
extra integration work.

---

## Open questions for design-partner discovery

The wrong question shape is "do you want X?" — the partner will say
yes to be polite. The right shape is "walk me through your last
<pain> — what would have saved you 30 minutes?" The questions below
are framed to extract pain, not to confirm hypotheses.

1. **Walk me through your last serious disruption.** What broke first?
   Who got pinged? What was the bottleneck? (Kernel 5 — the answer
   tells us whether disruption-recovery is really the wedge or just
   the most-told story.)
2. **Where do today's approvals actually live?** Show me the last
   approval you granted — what app was it in, what did the message
   say, how long did it take to find the context to decide? (Kernel 2
   default routing falls out of this; never lead with "Slack vs email".)
3. **What happens to a "talk to sales" form submission today?**
   Walk me through the next 5 minutes after a prospect hits submit.
   (Kernel 3 persistence target — surfaces whether there's a CRM
   already in the loop or a black-hole inbox.)
4. **The last time a traveler asked you a visa question, what did
   you do?** Did you Google? Sherpa? Slack a teammate? (Kernel 3
   web-research priority + signals whether the Sherpa integration
   blocks anything.)
5. **The last time something needed code-like investigation —
   reading a transcript, sifting a PDF, joining two CSVs — how was
   that handled?** (Surfaces whether `sandbox_run` is a real workflow
   gap or a developer-fantasy tool nobody asked for.)
6. **The last time someone on your team said "I wish I could just
   ask"... what were they trying to find?** (Kernel 4 docs-chat —
   surfaces whether the demand is for public docs lookup or for
   internal runbook-style answers, which is a much bigger commitment.)

---

## Sequencing — only after validation

Suggested order of build. **Step 0 is a prerequisite, not a kernel:**
extract the SSRF-safe fetch util into `@sendero/tools/safe-fetch`
before any kernel that fetches a URL ships (Kernels 1, 3, 4 all need
it).

Each subsequent kernel is gated on a partner committing to use it:

0. **Cross-cutting prereq — SSRF-safe fetch util** (1-2 days CC effort).
   Unblocks Kernels 1, 3, 4. Land standalone.
1. **Kernel 2 (HITL approvals + `evaluate_travel_policy`)** — smallest
   delta, highest leverage, reuses the existing Slack OAuth +
   signed-state machinery. Hard prereq for Kernel 5. Ship first.
2. **Kernel 5 (disruption-recovery)** — the moat-extending kernel a
   TMC buyer names first. Composes existing booking primitives +
   Kernel 2's HITL into the IROPS loop. Ship second.
3. **Kernel 3 (inbound qualification)** — split: ship the
   **traveler-intake half first** (composes with `prefund_trip` +
   `guest_claim_link`), GTM-form qualification follows as a 2-hour
   copy job. Ship third.
4. **Kernel 4 (docs-grounded chat)** — only the `search_sendero_docs`
   tool + nightly snapshot workflow. Public chat surface
   (help.sendero.travel/chat) waits for design-partner demand. Ship
   fourth — earns its place by also pre-warming the sandbox infra
   for Kernel 1.
5. **Kernel 1 (call intelligence)** — depends on a partner who
   actually runs voice ops at scale. Ship last; the sandbox infra
   is already in place from Kernel 4 by then.

Each kernel is independently shippable. None of them block the others.
None of them require a contract change to existing tools. All of them
extend the same registry, scope taxonomy, and OpenAPI surface.

---

> **Reminder.** This is a kernel document. Every code block above is a
> conversation starter, not a spec. The first design-partner call will
> almost certainly invalidate something here. That's the point — a
> kernel is supposed to be cheap to throw away.

---

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail (autoplan)

Voices: **Codex unavailable** (gpt-5.5 model gate — degraded), **Claude
subagent (independent multi-lens)** ran successfully. Single-voice
review with my own pass as the second voice.

| # | Phase | Decision | Class | Principle | Rationale |
|---|-------|----------|-------|-----------|-----------|
| 1 | CEO  | Add Kernel 5 (disruption-recovery) | Auto | P1 completeness | Subagent flagged this as critical missing wedge; aligns with TMC buyer pain. |
| 2 | CEO  | Re-frame Kernel 3 with "traveler-intake first" posture note | Auto | P5 explicit | Clearer than splitting into 3a/3b but still surfaces the priority. |
| 3 | CEO  | Reword 6 design-partner questions from leading to pain-extracting form | Auto | P5 explicit | Subagent: "questions confirm hypotheses instead of surfacing pain." |
| 4 | Eng  | Drop generics on `ToolDef` in all 5 scaffolds, add `jsonSchema` | Auto | P5 explicit | Verified against `packages/tools/src/scan-document.ts` — subagent claim correct. |
| 5 | Eng  | Add "Convention notes" + "Three integration footguns" callouts | Auto | P1 completeness | Prevents the same eng feedback landing on every kernel. |
| 6 | Eng  | Mark `request_approval` as `PRIVILEGED_TOOLS` + scope `settlement` | Auto | P5 explicit | Workflow-pausing tools that gate money are privileged by definition. |
| 7 | Eng  | Add `evaluate_travel_policy` as Kernel 2 sibling | Auto | P2 boil lakes | Splits cheap deterministic check from expensive HITL pause. |
| 8 | Eng  | Flag `defineWorkflow`/`hookResume`/`@sendero/workflow-runtime` as pseudocode | Auto | P5 explicit | Reader would copy non-compiling code otherwise. |
| 9 | Eng  | Add HMAC-signed envelope to Kernel 2 Slack interactions delta | Auto | P1 completeness | `action.value` is bot-supplied; needs Sendero envelope per existing `slack-oauth-state.ts` pattern. |
| 10 | Eng  | Extract SSRF-safe fetch util as cross-cutting prereq | Auto | P4 DRY | Three kernels need it; copy-paste-per-kernel is wrong. |
| 11 | Eng  | Replace bare `'openai/gpt-4o-mini'` with `resolveGatewayModel(...)` in Kernel 3 | Auto | P5 explicit | Bare strings bypass AI Gateway + nano-discount table. |
| 12 | DX   | Add Audience + Prerequisites + Kill-if subsections per kernel | Auto | P1 completeness | Without these a contributor can't land any kernel without a follow-up call. |
| 13 | DX   | Add Sandbox metering note to Kernel 4 | Auto | P1 completeness | CLAUDE.md billing leg #2 implies every infra dep must be pricable. |
| 14 | Seq  | Insert Step 0 (SSRF prereq) and Kernel 5 between K2 and K3 | Auto | P3 pragmatic | Sequencing follows dependency graph + value-per-week. |

**Taste decisions surfaced** (auto-decided with stated principle, but
reasonable people could pick the other path):

- **K4 sequencing.** Subagent recommended demoting Kernel 4 to last
  (CEO finding #4: "docs chat is GTM not moat"). I kept K4 in slot
  #4 but earlier than Kernel 1. Counter-argument: K4 unblocks the
  sandbox infra reuse Kernel 1 leans on. If you'd rather demote K4
  fully behind K1, the swap is a 2-line edit in the Sequencing
  section.
- **Kernel 3 single vs split.** Subagent recommended splitting Kernel
  3 into 3a (traveler) and 3b (GTM). I kept it single with a posture
  note saying "ship traveler half first." If a partner conversation
  surfaces both halves at once, splitting may be cleaner; for a
  one-sheet roadmap, single keeps the doc shorter.

**User challenge** (both my analysis and the subagent agreed on a
direction beyond your original ask — surfaced for your call):

- **You asked for kernels distilled from the four templates. The
  subagent surfaced "disruption-recovery (IROPS)" as a critical
  missing wedge that no template provides.** I added it as Kernel 5
  because the disclaimer explicitly invites change and the TMC-buyer
  argument is concrete. **Your call** — Kernel 5 stands unless you
  want it dropped to keep the doc strictly template-bounded. If we're
  wrong, the cost is a kernel that doesn't have a Vercel template
  scaffold backing it. If we're right, dropping it leaves the
  roadmap without the moat-extending wedge.

## GSTACK REVIEW REPORT

| Run | Status | Findings |
|-----|--------|----------|
| CEO (Claude subagent) | clean | 4 findings, 1 critical (K5 missing), 3 high — applied. |
| CEO (Codex) | unavailable | gpt-5.5 model gate (CLI 0.93.0 too old). Degraded. |
| Eng (Claude subagent) | clean | 7 findings — all applied. ToolDef shape, scope routing, SSRF util, Slack envelope, sandbox metering. |
| Eng (Codex) | unavailable | Same model gate. Degraded. |
| DX  (Claude subagent) | clean | 4 findings — all applied. Prereqs added, questions rewritten, kill criteria added, gateway model fix applied. |
| DX  (Codex) | unavailable | Same model gate. Degraded. |

Verdict: **APPROVED with 2 taste decisions and 1 user challenge surfaced above.**
