/**
 * External-API-key bound workflow tools — the runtime counterparts
 * of the static defs in `@sendero/workflows/external-tools`.
 *
 * Static catalog (OpenAPI, MCP `tools/list`, llms.txt) sees the
 * placeholder defs. The dispatch route + MCP route swap in these
 * bound versions at request time, threading the API-key tenant
 * binding + caller scope context through every handler.
 *
 * Security gates (Responsible-AI ship gate, CLAUDE.md):
 *   1. Tenant binding — every handler reads `ctx.traveler.tenantId`
 *      from the API-key resolver. The buyer cannot override the
 *      tenant via input; the tool ignores any `tenantId` field on
 *      input entirely. Cross-tenant impersonation is structurally
 *      impossible.
 *   2. Internal-workflow filter — only workflows missing from
 *      `INTERNAL_WORKFLOWS` get a bound def. Internal ops surfaces
 *      (channel provisioning, artifact packing) stay invisible to
 *      external keys.
 *   3. Scope filter (defense in depth) — runs upstream in
 *      `filterToolsByScopes`. Top-tier workflows require
 *      `settlement`; mid-tier requires `bookings`. `DEFAULT_PROD_SCOPES`
 *      excludes both, so user-minted prod keys see only read-tier
 *      workflow tools by default.
 *   4. HMAC signing — top-tier workflow tools live in
 *      `PRIVILEGED_TOOLS`, so the dispatch route demands an
 *      `x-sendero-sig` header before invoking the handler. Leaked
 *      bearer alone cannot fire a settlement-touching workflow.
 *   5. Plan-tier metering — the handler propagates
 *      `ctx.caller.effectiveKeyType` so the meter writes
 *      `MeterEvent.status = 'sandbox'` for testnet-beta callers; no
 *      production billing for testnet runs.
 */

import { WORKFLOW_CATALOG } from '@sendero/workflows/catalog';
import {
  INTERNAL_WORKFLOWS,
  WORKFLOW_TOOL_PRICING,
  toolNameToWorkflowId,
  workflowIdToToolName,
  type WorkflowToolInput,
  type WorkflowToolOutput,
} from '@sendero/workflows';
import type { ToolContext, ToolDef } from '@sendero/tools/types';
import { z } from 'zod';

import {
  loadPausedAgentWorkflow,
  resumeAgentWorkflow,
  startAgentWorkflow,
} from './agent-workflow-session';

const workflowInputSchema = z.object({
  input: z.record(z.unknown()).optional(),
});

const resumeWorkflowInputSchema = z.object({
  runId: z.string().min(1).describe('Run id returned from the original workflow tool call.'),
  response: z
    .record(z.unknown())
    .optional()
    .describe('Free-form response payload — the workflow paused awaiting this answer.'),
});

type ResumeInput = z.infer<typeof resumeWorkflowInputSchema>;

interface ResumeOutput extends WorkflowToolOutput {
  resumed: true;
}

/** Internal-channel subject key for API-driven workflow sessions. */
function apiChannelKey(args: { tenantId: string; apiKeyId?: string; runId?: string }): string {
  // Prefer apiKeyId (stable across calls for the same key) over runId
  // (fresh every start). Falls back to runId only if the dispatch
  // route can't resolve a key — which shouldn't happen in production,
  // but we don't want to crash a sandbox smoke test.
  return args.apiKeyId ?? args.runId ?? `tenant:${args.tenantId}`;
}

function readTenantOrThrow(ctx: ToolContext): string {
  const tenantId = ctx.traveler?.tenantId;
  if (!tenantId) {
    throw new Error(
      'workflow_tenant_binding_missing: handler requires ctx.traveler.tenantId from the API-key resolver'
    );
  }
  return tenantId;
}

/**
 * Build runtime-bound workflow tools for the canonical toolList.
 * Returns one ToolDef per public workflow + the shared `resume_workflow`.
 *
 * Pass the resolved API-key id when available so a paused workflow
 * keys its Session under the same subject across multiple calls.
 */
export function buildBoundExternalWorkflowTools(args: {
  apiKeyId?: string;
}): ToolDef<unknown, unknown>[] {
  const defs: ToolDef<unknown, unknown>[] = [];

  for (const [workflowId, def] of Object.entries(WORKFLOW_CATALOG)) {
    if (INTERNAL_WORKFLOWS.has(workflowId)) continue;
    const toolName = workflowIdToToolName(workflowId);
    const priceUsdc = WORKFLOW_TOOL_PRICING[toolName];
    if (!priceUsdc) continue;

    defs.push({
      name: toolName,
      description: `${def.label}. ${def.description ?? ''} Priced at ${priceUsdc} USDC — premium because Sendero runs the multi-step plan with durable resume, pause-and-relay, and a single settled artifact. The agent caller buys the outcome, not the steps.`,
      inputSchema: workflowInputSchema,
      jsonSchema: {
        type: 'object',
        properties: {
          input: { type: 'object', additionalProperties: true },
        },
      },
      async handler(rawInput: unknown, ctx?: ToolContext): Promise<WorkflowToolOutput> {
        if (!ctx) throw new Error('workflow_ctx_missing');
        const tenantId = readTenantOrThrow(ctx);
        const parsed = workflowInputSchema.parse(rawInput ?? {}) as WorkflowToolInput;

        const channelKey = apiChannelKey({ tenantId, apiKeyId: args.apiKeyId });
        const snapshot = await startAgentWorkflow({
          tenantId,
          channel: 'api',
          channelIdentityId: channelKey,
          userId: ctx.traveler?.userId ?? null,
          workflowId,
          input: parsed.input ?? {},
          toolCtx: ctx,
        });

        return {
          status: snapshot.status,
          workflowId: snapshot.workflowId,
          ...(snapshot.workflowLabel ? { workflowLabel: snapshot.workflowLabel } : {}),
          runId: snapshot.runId,
          pausePrompt: snapshot.pausePrompt,
          ...(snapshot.pauseReason ? { pauseReason: snapshot.pauseReason } : {}),
          scratchpad: snapshot.scratchpad,
        };
      },
    });
  }

  // ── resume_workflow ──────────────────────────────────────────────
  defs.push({
    name: 'resume_workflow',
    description:
      'Resume an externally-launched workflow that paused awaiting input. Pass the runId returned from the original sendero_* tool and the response payload (the structure the pausePrompt asked for). On completion, returns the final scratchpad; on another pause, returns the next pausePrompt.',
    inputSchema: resumeWorkflowInputSchema,
    jsonSchema: {
      type: 'object',
      required: ['runId'],
      properties: {
        runId: { type: 'string' },
        response: { type: 'object', additionalProperties: true },
      },
    },
    async handler(rawInput: unknown, ctx?: ToolContext): Promise<ResumeOutput> {
      if (!ctx) throw new Error('workflow_ctx_missing');
      const tenantId = readTenantOrThrow(ctx);
      const parsed = resumeWorkflowInputSchema.parse(rawInput ?? {}) as ResumeInput;

      const channelKey = apiChannelKey({ tenantId, apiKeyId: args.apiKeyId, runId: parsed.runId });
      const paused = await loadPausedAgentWorkflow({
        tenantId,
        channel: 'api',
        channelIdentityId: channelKey,
      });
      if (!paused) {
        throw new Error(`workflow_not_paused:${parsed.runId}`);
      }
      const snapshot = await resumeAgentWorkflow({
        tenantId,
        paused,
        channel: 'api',
        channelIdentityId: channelKey,
        // Workflow runner consumes the response as JSON-stringified
        // userInput; structured payloads are recovered via JSON.parse on
        // the workflow side. Keep this serialization stable.
        userInput: JSON.stringify(parsed.response ?? {}),
        toolCtx: ctx,
      });

      return {
        resumed: true,
        status: snapshot.status,
        workflowId: snapshot.workflowId,
        ...(snapshot.workflowLabel ? { workflowLabel: snapshot.workflowLabel } : {}),
        runId: snapshot.runId,
        pausePrompt: snapshot.pausePrompt,
        ...(snapshot.pauseReason ? { pauseReason: snapshot.pauseReason } : {}),
        scratchpad: snapshot.scratchpad,
      };
    },
  });

  return defs;
}

export { toolNameToWorkflowId };
