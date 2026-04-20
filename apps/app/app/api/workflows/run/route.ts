/**
 * POST /api/workflows/run
 *
 * Kicks off a named workflow against the injected tool registry.
 * Side-effects (meter events, analytics capture, pause persistence)
 * are wired via runner hooks so callers don't have to duplicate
 * book-keeping code.
 *
 * Body: { workflowId, tenantId, userId, input }
 * Returns the WorkflowRun — status=paused rows should be persisted
 * by the caller (Session table) so `/api/workflows/resume` can pick
 * them up.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toolList } from '@sendero/tools';
import { findWorkflow, startRun, type ToolRegistry } from '@sendero/workflows';
import { prisma } from '@sendero/database';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  workflowId: z.string().min(1),
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const workflow = findWorkflow(body.workflowId);
  if (!workflow) {
    return NextResponse.json(
      { error: 'unknown_workflow', availableIds: listAvailableIds() },
      { status: 404 }
    );
  }

  const distinctId = hashDistinctId(body.userId);
  const tools = buildToolRegistry({ tenantId: body.tenantId, userId: body.userId });

  const run = await startRun({
    workflow,
    input: body.input,
    tools,
    hooks: {
      onStep: async entry => {
        if (entry.kind === 'tool' && entry.ok) {
          capture({
            event: 'tool_call_finished',
            distinctId,
            properties: {
              tenantId: body.tenantId,
              tripId: null,
              toolName: entry.label,
              latencyMs: entry.finishedAt.getTime() - entry.startedAt.getTime(),
              ok: true,
              priceMicroUsdc: entry.priceMicroUsdc?.toString() ?? '0',
            },
          });
        }
      },
      onPause: async ({ runId, step, scratchpad }) => {
        await prisma.session.create({
          data: {
            tenantId: body.tenantId,
            userId: body.userId,
            threadContext: {
              runId,
              workflowId: workflow.id,
              pausedStepId: step.id,
              pauseReason: step.reason,
              pausePayload: (step.payload ?? {}) as object,
              scratchpad: scratchpad as object,
            },
            expiresAt: step.timeoutMs ? new Date(Date.now() + step.timeoutMs) : null,
          },
        });
      },
    },
  });

  await flush();

  return NextResponse.json({
    runId: run.runId,
    status: run.status,
    trail: run.trail.map(t => ({
      stepId: t.stepId,
      kind: t.kind,
      label: t.label,
      ok: t.ok,
      latencyMs: t.finishedAt.getTime() - t.startedAt.getTime(),
    })),
    pauseReason: run.pauseReason,
    nextStepId: run.nextStepId,
    error: run.error,
  });
}

function listAvailableIds(): string[] {
  // eslint import loop with the catalog — keep the response helpful.
  return [
    'sendero.book_flight',
    'sendero.group_trip',
    'sendero.refund',
    'sendero.check_in_reminder',
  ];
}

function buildToolRegistry(ctx: { tenantId: string; userId: string }): ToolRegistry {
  const registry: ToolRegistry = {};
  for (const tool of toolList) {
    registry[tool.name] = async args =>
      tool.handler(args as never, {
        traveler: { userId: ctx.userId, tenantId: ctx.tenantId },
      });
  }
  return registry;
}
