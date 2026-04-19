/**
 * POST /api/settle/finalize
 *
 * Called by the frontend AFTER the final userOp (complete + giveFeedback)
 * lands on-chain. Invalidates the server-side reputation cache so the
 * AgentCard reflects the new feedback on the next read.
 *
 * No on-chain work. Pure cache-bust.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invalidateReputationCache } from '@/lib/arc-identity';

const BodySchema = z.object({
  agentId: z
    .string()
    .regex(/^\d+$/, 'agentId must be a decimal string')
    .optional(),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const raw = await req.json().catch(() => ({}));
    const body = BodySchema.parse(raw ?? {});
    const agentIdStr = body.agentId ?? process.env.PASILLO_AGENT_ID;
    if (!agentIdStr) {
      return NextResponse.json(
        {
          error: 'agent_not_configured',
          message:
            'Provide agentId in the request body or set PASILLO_AGENT_ID in .env.local.',
        },
        { status: 503 },
      );
    }
    invalidateReputationCache(BigInt(agentIdStr));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'invalid_input', issues: err.issues },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'finalize_failed', message },
      { status: 500 },
    );
  }
}
