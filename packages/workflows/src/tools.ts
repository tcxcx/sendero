/**
 * Chat tools that expose the workflow catalog as first-class agent
 * actions.
 *
 * The chat model already sees the workflow catalog in the system
 * prompt (`renderWorkflowsBlock`), but until now there was no tool
 * call that could *start* a workflow — the model had to chain the
 * underlying tools manually, losing the branch / pause / parallel
 * orchestration that workflow defs encode.
 *
 * Two tools live here, kept inside `@sendero/workflows` to avoid a
 * circular dep with `@sendero/tools` (workflows already depends on
 * tools). The chat route merges them into the master tool list.
 *
 * - `list_workflows` — returns the catalog (id, label, description) so
 *   the model can pick by intent rather than memorizing ids.
 * - `run_workflow` — kicks off a workflow against the live registry
 *   built from `toolList`. The runner returns either:
 *     * `{ status: 'completed', scratchpad }` — full success, every
 *       step ran
 *     * `{ status: 'paused', nextStepId, reason, scratchpad }` — a
 *       pause step suspended the run; the caller (UI / cron / human
 *       approver) is responsible for `resumeRun()` later
 *     * `{ status: 'failed', error, trail }` — a step threw and no
 *       retry budget remained
 *
 * The model gets back a structured summary string so it can narrate
 * progress to the user; the full `WorkflowRun` shape is in the tool
 * output for the UI to render.
 */

import { z, type ZodTypeAny } from 'zod';

import { findWorkflow, listWorkflows } from './catalog';
import { startRun, type ToolRegistry } from './runner';

interface ToolDef<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: ZodTypeAny;
  jsonSchema: {
    type: string;
    properties?: Record<string, Record<string, unknown>>;
    required?: string[];
    [k: string]: unknown;
  };
  handler(input: I, ctx?: unknown): Promise<O>;
}

export const listWorkflowsTool: ToolDef<
  Record<string, never>,
  { workflows: Array<{ id: string; label: string; description?: string }> }
> = {
  name: 'list_workflows',
  description:
    'List the available Sendero workflows. Each workflow is a multi-step plan with branches, pauses, and parallel fan-out — call run_workflow to execute one. Use this when the user asks for something that maps to a known orchestration (e.g. "book a flight with policy approval", "rebook after a cancellation", "agency cohort intake").',
  inputSchema: z.object({}),
  jsonSchema: { type: 'object', properties: {} },
  async handler() {
    return { workflows: listWorkflows() };
  },
};

interface RunWorkflowFactoryArgs {
  /**
   * Build the live tool registry that the workflow runner will use
   * for `tool` steps. The chat route passes a registry that wraps the
   * same `toolList` it gives the LLM, with the same traveler context.
   */
  resolveTools: () => ToolRegistry;
}

/**
 * Build a chat-callable `run_workflow` tool. Factory pattern because
 * the registry must close over the per-request traveler context and
 * tool meter — created freshly on every chat POST.
 */
export function buildRunWorkflowTool(args: RunWorkflowFactoryArgs): ToolDef {
  return {
    name: 'run_workflow',
    description:
      'Execute a Sendero workflow by id. The workflow runs server-side against the live tool registry; pause steps suspend the run and return control with a `nextStepId` the UI can resume against. Returns one of: { status: "completed", scratchpad } | { status: "paused", nextStepId, reason, scratchpad } | { status: "failed", error }. Always summarize the result to the user. Get the workflow id via list_workflows first.',
    inputSchema: z.object({
      workflowId: z
        .string()
        .min(1)
        .describe(
          'Workflow id from list_workflows, e.g. "sendero.book_flight" or "sendero.refund".'
        ),
      input: z
        .record(z.unknown())
        .optional()
        .describe(
          'Initial scratchpad seeded for the workflow, keyed by step `as` paths the workflow expects.'
        ),
    }),
    jsonSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        input: { type: 'object' },
      },
      required: ['workflowId'],
    },
    async handler(raw) {
      const input = raw as { workflowId: string; input?: Record<string, unknown> };
      const def = findWorkflow(input.workflowId);
      if (!def) {
        return {
          status: 'failed' as const,
          error: 'unknown_workflow',
          message: `No workflow registered with id "${input.workflowId}". Call list_workflows for the current catalog.`,
        };
      }
      try {
        const run = await startRun({
          workflow: def,
          input: input.input ?? {},
          tools: args.resolveTools(),
        });
        if (run.status === 'paused') {
          return {
            status: 'paused' as const,
            workflowId: def.id,
            runId: run.runId,
            nextStepId: run.nextStepId,
            pauseReason: run.pauseReason,
            scratchpad: run.scratchpad,
            trail: run.trail,
          };
        }
        if (run.status === 'failed') {
          return {
            status: 'failed' as const,
            workflowId: def.id,
            runId: run.runId,
            error: run.error?.message ?? 'workflow_failed',
            failedStepId: run.error?.stepId,
            trail: run.trail,
          };
        }
        return {
          status: 'completed' as const,
          workflowId: def.id,
          runId: run.runId,
          scratchpad: run.scratchpad,
          trail: run.trail,
        };
      } catch (err) {
        return {
          status: 'failed' as const,
          workflowId: def.id,
          error: 'runner_threw',
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
