/**
 * Per-workflow ToolDef generator — turns each non-internal workflow in
 * `WORKFLOW_CATALOG` into a marketplace-callable priced tool.
 *
 * Two flavors:
 *   - Static defs (this module) — used by OpenAPI, llms.txt, MCP catalog
 *     discovery. Handlers throw `WORKFLOW_BIND_REQUIRED` because the
 *     real execution needs Prisma + agent-workflow-session, which live
 *     in apps/app (above this package in the dep graph).
 *   - Bound defs (apps/app/lib/external-workflow-tools.ts) — what
 *     dispatch + MCP routes actually invoke at runtime. They have the
 *     same shape (name, schema, description) so OpenAPI/MCP catalog
 *     entries match what gets executed.
 *
 * Tool name maps workflowId `sendero.book_flight` → `sendero_book_flight`
 * because MCP tool names must match `^[a-zA-Z0-9_-]{1,128}$`.
 *
 * Pricing is sourced from `WORKFLOW_PRICING`. The same prices flow into
 * `TOOL_PRICING` in `@sendero/tools/pricing` so the edge x402 middleware
 * and the dispatch meter both see the same number.
 */

import { z } from 'zod';

import type { ToolContext, ToolDef } from '@sendero/tools/types';

import { WORKFLOW_CATALOG } from './catalog';
import { INTERNAL_WORKFLOWS, WORKFLOW_PRICING } from './pricing';

/** Convert `sendero.book_flight` → `sendero_book_flight`. */
export function workflowIdToToolName(workflowId: string): string {
  return workflowId.replaceAll('.', '_');
}

/** Reverse of `workflowIdToToolName`. */
export function toolNameToWorkflowId(toolName: string): string {
  // Only flip the first `_` after the `sendero` prefix so e.g.
  // `sendero_book_flight` → `sendero.book_flight`, but
  // `sendero_book_with_ancillaries` → `sendero.book_with_ancillaries`.
  if (!toolName.startsWith('sendero_')) return toolName;
  return `sendero.${toolName.slice('sendero_'.length)}`;
}

/**
 * Pre-computed map of tool-name → priced USDC string for every public
 * workflow. Spread into `TOOL_PRICING` so the canonical pricer sees one
 * unified table.
 */
export const WORKFLOW_TOOL_PRICING: Record<string, string> = Object.fromEntries(
  Object.entries(WORKFLOW_PRICING)
    .filter(([id]) => !INTERNAL_WORKFLOWS.has(id))
    .map(([id, price]) => [workflowIdToToolName(id), price])
);

/** Tool names of all public workflow surfaces, for scope/privilege wiring. */
export const PUBLIC_WORKFLOW_TOOL_NAMES = new Set(Object.keys(WORKFLOW_TOOL_PRICING));

/**
 * Tier classification — derived from price tier. Top tier ($0.25) =
 * settlement-touching; mid ($0.15) = read+plan-only; read ($0.10) =
 * pure read. Used by `toolToScope()` so the scope vocabulary doesn't
 * have to enumerate every workflow name.
 */
export function workflowToolTier(toolName: string): 'top' | 'mid' | 'read' | null {
  const price = WORKFLOW_TOOL_PRICING[toolName];
  if (!price) return null;
  if (price === '0.25') return 'top';
  if (price === '0.15') return 'mid';
  if (price === '0.10') return 'read';
  return null;
}

/**
 * Input schema is intentionally loose: each workflow has its own
 * implicit input shape (workflow.steps reference `$(input.X)` paths)
 * that isn't declared as a Zod schema. The runner errors helpfully on
 * missing required fields, which is the right place to surface that to
 * the caller. Passing through as `Record<string, unknown>` preserves
 * every field without per-workflow boilerplate.
 */
const workflowInputSchema = z.object({
  input: z
    .record(z.unknown())
    .optional()
    .describe(
      'Initial scratchpad input. Each workflow has its own expected shape — see the workflow description for required fields. The runner errors helpfully on missing required fields.'
    ),
});

export type WorkflowToolInput = z.infer<typeof workflowInputSchema>;

export interface WorkflowToolOutput {
  status: string;
  workflowId: string;
  workflowLabel?: string;
  runId: string;
  pausePrompt: string;
  pauseReason?: string;
  scratchpad: Record<string, unknown>;
}

/** Marker error thrown by the static handlers. apps/app routes swap in bound handlers. */
export const WORKFLOW_BIND_REQUIRED = 'workflow_bind_required';

/**
 * Build the static catalog of per-workflow ToolDefs. The static handler
 * throws — actual execution requires the apps/app-side bound version.
 * For catalog discovery (OpenAPI, MCP `tools/list`, llms.txt) the static
 * shape is sufficient.
 */
export function buildStaticWorkflowToolDefs(): ToolDef<WorkflowToolInput, WorkflowToolOutput>[] {
  return Object.entries(WORKFLOW_CATALOG)
    .filter(([id]) => !INTERNAL_WORKFLOWS.has(id))
    .map(([id, def]) => {
      const toolName = workflowIdToToolName(id);
      return {
        name: toolName,
        description: `${def.label}. ${def.description ?? ''} Priced at ${WORKFLOW_TOOL_PRICING[toolName]} USDC — premium because Sendero runs the multi-step plan with durable resume, pause-and-relay, and a single settled artifact (trip + invoice + ledger). The agent caller buys the outcome, not the steps.`,
        inputSchema: workflowInputSchema,
        jsonSchema: {
          type: 'object',
          properties: {
            input: { type: 'object', additionalProperties: true },
          },
        },
        async handler(_input: WorkflowToolInput, _ctx?: ToolContext): Promise<WorkflowToolOutput> {
          throw new Error(
            `${WORKFLOW_BIND_REQUIRED}:${id}: workflow tool requires the apps/app dispatch-bound handler; do not import this static def at runtime`
          );
        },
      };
    });
}
