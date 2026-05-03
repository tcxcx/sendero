/**
 * `start_workflow` — agent-callable tool.
 *
 * Lets the LLM kick off a canonical multi-step workflow from
 * `@sendero/workflows::WORKFLOW_CATALOG` (book_flight, refund,
 * group_trip, …) instead of chaining individual tools turn-by-turn.
 * The runner executes synchronously up to the first pause OR to
 * completion; on pause we persist a Session row keyed per traveler
 * so the next inbound auto-resumes via `loadPausedAgentWorkflow` in
 * the webhook fan-in.
 *
 * Lives in `apps/app` (not `@sendero/tools`) on purpose: persistence
 * needs Prisma + the channel-bound `agent-workflow-session.ts`
 * helpers, and the tool is dispatch-only — neither the MCP server
 * nor external API keys ever see it. The dispatch route appends this
 * tool to the canonical `toolList` before handing the catalog to
 * `runAgentTurn`.
 */

import { z } from 'zod';

import { WORKFLOW_CATALOG, type WorkflowRun } from '@sendero/workflows';
import type { ToolContext, ToolDef } from '@sendero/tools/types';

import { startAgentWorkflow } from './agent-workflow-session';

const WORKFLOW_IDS = Object.keys(WORKFLOW_CATALOG) as Array<keyof typeof WORKFLOW_CATALOG>;

const startWorkflowInput = z.object({
  workflowId: z
    .enum(WORKFLOW_IDS as [string, ...string[]])
    .describe(
      "Canonical workflow id from Sendero's catalog (e.g. 'sendero.book_flight', 'sendero.refund', 'sendero.group_trip', 'sendero.guest_prefund', 'sendero.cancellation_recovery', 'sendero.trip_delay_replanner'). The runner enforces step ordering — search → policy → hold → confirm → settle — so the LLM can't skip a stage."
    ),
  input: z
    .record(z.unknown())
    .optional()
    .describe(
      'Initial scratchpad input — fields the workflow reads via `$(input.X)` JSONPaths. Pass exactly what the workflow needs (e.g. `{ origin, destination, departureDate, travelerUserId }` for `sendero.book_flight`). Missing required fields will surface as a tool error.'
    ),
});

interface StartWorkflowOutput {
  status: WorkflowRun['status'];
  workflowId: string;
  workflowLabel?: string;
  runId: string;
  /** Pause prompt the agent should relay verbatim to the traveler.
   *  Empty string on completion. */
  pausePrompt: string;
  pauseReason?: WorkflowRun['pauseReason'];
  scratchpad: Record<string, unknown>;
  sessionId?: string;
}

/**
 * Build the tool def. The dispatch route calls this with the
 * channel-bound context (tenantId, channelIdentityId, channel) so
 * the tool can persist a Session row keyed per traveler.
 */
export function buildStartWorkflowTool(args: {
  tenantId: string;
  channelIdentityId: string;
  channel: 'whatsapp' | 'slack' | 'web';
  /** Sendero `User.id` for the traveler — stamped on the persisted
   *  Session row for audit. */
  userId?: string | null;
  /** Optional active trip — when set, every workflow step transition
   *  gets appended to the trip's event ledger so MetaInbox + trip
   *  inbox surface the run's progress alongside the conversation. */
  tripId?: string | null;
  /** Tool context propagated to inner workflow tool calls so they
   *  see the same caller identity / scopes the agent turn ran under. */
  innerToolCtx: ToolContext;
}): ToolDef<z.infer<typeof startWorkflowInput>, StartWorkflowOutput> {
  return {
    name: 'start_workflow',
    internal: true,
    description:
      "Start a canonical multi-step Sendero workflow. Use this whenever the traveler's intent maps cleanly to a known flow (book_flight, group_trip, refund, cancellation_recovery, trip_delay_replanner, guest_prefund, etc.) — the runner enforces step ordering and durably pauses for any step that needs traveler input or operator approval. On pause, relay the `pausePrompt` to the traveler verbatim; the next message they send is automatically routed back to this workflow. On completion, summarize the `scratchpad` in the traveler's voice. Prefer this over chaining individual tools by hand for any flow longer than 1-2 steps.",
    inputSchema: startWorkflowInput,
    jsonSchema: {
      type: 'object',
      required: ['workflowId'],
      properties: {
        workflowId: { type: 'string', enum: WORKFLOW_IDS as string[] },
        input: { type: 'object', additionalProperties: true },
      },
    },
    async handler(input) {
      const snapshot = await startAgentWorkflow({
        tenantId: args.tenantId,
        channel: args.channel,
        channelIdentityId: args.channelIdentityId,
        userId: args.userId ?? null,
        tripId: args.tripId ?? null,
        workflowId: input.workflowId,
        input: input.input ?? {},
        toolCtx: args.innerToolCtx,
      });
      return {
        status: snapshot.status,
        workflowId: snapshot.workflowId,
        ...(snapshot.workflowLabel ? { workflowLabel: snapshot.workflowLabel } : {}),
        runId: snapshot.runId,
        pausePrompt: snapshot.pausePrompt,
        ...(snapshot.pauseReason ? { pauseReason: snapshot.pauseReason } : {}),
        scratchpad: snapshot.scratchpad,
        ...(snapshot.sessionId ? { sessionId: snapshot.sessionId } : {}),
      };
    },
  };
}
