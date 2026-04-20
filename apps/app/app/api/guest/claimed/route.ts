/**
 * POST /api/guest/claimed
 *
 * The /g page calls this after the on-chain claimTrip userOp confirms.
 * We look up any paused Session whose workflow is waiting on this
 * tripId and resume it with { guestWallet, txHash }.
 *
 * The claim is already durable on-chain — this endpoint is a
 * convenience that propagates the event into the workflow runner so
 * the corporate-facing UX advances immediately (no cron lag).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@sendero/database';
import { toolList } from '@sendero/tools';
import { findWorkflow, resumeRun, type ToolRegistry } from '@sendero/workflows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  tripId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  guestWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

interface WorkflowPauseContext {
  runId: string;
  workflowId: string;
  pausedStepId: string;
  pauseReason: 'approval' | 'otp' | '3ds' | 'user_reply' | 'external_event';
  pausePayload?: Record<string, unknown>;
  scratchpad: Record<string, unknown>;
}

function parseCtx(raw: unknown): WorkflowPauseContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<WorkflowPauseContext>;
  if (
    typeof c.runId !== 'string' ||
    typeof c.workflowId !== 'string' ||
    typeof c.pausedStepId !== 'string' ||
    typeof c.pauseReason !== 'string' ||
    typeof c.scratchpad !== 'object'
  ) {
    return null;
  }
  return c as WorkflowPauseContext;
}

function tripIdMatches(scratchpad: Record<string, unknown>, tripId: string): boolean {
  const dive = (obj: unknown): boolean => {
    if (!obj || typeof obj !== 'object') return false;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (k === 'tripId' && typeof v === 'string' && v.toLowerCase() === tripId.toLowerCase()) {
        return true;
      }
      if (typeof v === 'object' && v !== null && dive(v)) return true;
    }
    return false;
  };
  return dive(scratchpad);
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

  const candidates = await prisma.session.findMany({
    where: { OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
    orderBy: { createdAt: 'desc' },
    take: 64,
    select: { id: true, tenantId: true, userId: true, threadContext: true },
  });

  for (const session of candidates) {
    const ctx = parseCtx(session.threadContext);
    if (!ctx) continue;
    if (ctx.pauseReason !== 'external_event') continue;
    if (!tripIdMatches(ctx.scratchpad, body.tripId)) continue;

    const workflow = findWorkflow(ctx.workflowId);
    if (!workflow) continue;

    const tools = buildToolRegistry({
      tenantId: session.tenantId,
      userId: session.userId ?? 'guest',
    });

    const resumed = await resumeRun({
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
      resolution: {
        guestWallet: body.guestWallet,
        txHash: body.txHash,
        claimedAt: new Date().toISOString(),
      },
      tools,
    });

    if (resumed.status !== 'paused') {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    }

    return NextResponse.json({
      resumed: true,
      runId: resumed.runId,
      status: resumed.status,
      nextStepId: resumed.nextStepId,
    });
  }

  return NextResponse.json({ resumed: false, reason: 'no_matching_paused_session' });
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
