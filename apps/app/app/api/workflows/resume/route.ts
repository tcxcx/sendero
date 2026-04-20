/**
 * POST /api/workflows/resume
 *
 * Picks up a previously paused workflow run. Reads the Session.threadContext
 * persisted by /api/workflows/run's onPause hook, reconstructs the run, and
 * calls runner.resumeRun with the resolution payload the pause was waiting
 * for (slack approval decision, WA guest claim tx, OTP reply, etc.).
 *
 * Caller passes { sessionId, resolution }. sessionId is the Session row id
 * that was written when the pause fired. resolution merges into the
 * scratchpad under the paused step's id, so downstream steps can reference
 * `$step_id.whatever` via JSONPath.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { toolList } from '@sendero/tools';
import { findWorkflow, resumeRun, type ToolRegistry, type WorkflowRun } from '@sendero/workflows';
import { prisma } from '@sendero/database';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  sessionId: z.string().min(1),
  resolution: z.record(z.string(), z.unknown()),
});

interface PersistedThreadContext {
  runId: string;
  workflowId: string;
  pausedStepId: string;
  pauseReason: 'approval' | 'otp' | '3ds' | 'user_reply' | 'external_event';
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
}

function parseThreadContext(raw: unknown): PersistedThreadContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const ctx = raw as Partial<PersistedThreadContext>;
  if (
    typeof ctx.runId !== 'string' ||
    typeof ctx.workflowId !== 'string' ||
    typeof ctx.pausedStepId !== 'string' ||
    typeof ctx.pauseReason !== 'string' ||
    typeof ctx.scratchpad !== 'object'
  ) {
    return null;
  }
  return ctx as PersistedThreadContext;
}

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

  const session = await prisma.session.findUnique({
    where: { id: body.sessionId },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      threadContext: true,
      expiresAt: true,
    },
  });
  if (!session) return NextResponse.json({ error: 'unknown_session' }, { status: 404 });
  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'session_expired' }, { status: 410 });
  }

  const ctx = parseThreadContext(session.threadContext);
  if (!ctx) return NextResponse.json({ error: 'invalid_thread_context' }, { status: 409 });

  const workflow = findWorkflow(ctx.workflowId);
  if (!workflow) return NextResponse.json({ error: 'unknown_workflow' }, { status: 404 });

  const tools = buildToolRegistry({
    tenantId: session.tenantId,
    userId: session.userId ?? 'guest',
  });

  const resumed: WorkflowRun = await resumeRun({
    workflow,
    run: {
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      status: 'paused',
      startedAt: new Date(),
      pausedAt: new Date(),
      pauseReason: ctx.pauseReason,
      pausePayload: ctx.pausePayload,
      scratchpad: ctx.scratchpad,
      trail: [],
      nextStepId: ctx.pausedStepId,
    },
    resolution: body.resolution,
    tools,
    hooks: {
      onStep: async entry => {
        if (entry.kind === 'tool' && entry.ok) {
          capture({
            event: 'tool_call_finished',
            distinctId: hashDistinctId(session.userId ?? session.tenantId),
            properties: {
              tenantId: session.tenantId,
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
        // The run paused AGAIN mid-resume (e.g. chained approvals). Persist
        // a new Session row so the next resume can pick it up.
        await prisma.session.create({
          data: {
            tenantId: session.tenantId,
            userId: session.userId,
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

  if (resumed.status !== 'paused') {
    // Terminal — clean up the originating Session.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  }

  await flush();

  return NextResponse.json({
    runId: resumed.runId,
    status: resumed.status,
    trail: resumed.trail.map(t => ({
      stepId: t.stepId,
      kind: t.kind,
      label: t.label,
      ok: t.ok,
      latencyMs: t.finishedAt.getTime() - t.startedAt.getTime(),
    })),
    pauseReason: resumed.pauseReason,
    nextStepId: resumed.nextStepId,
    error: resumed.error,
  });
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
