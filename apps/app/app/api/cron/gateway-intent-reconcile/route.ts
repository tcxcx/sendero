/**
 * GET /api/cron/gateway-intent-reconcile
 *
 * Gateway v5 Step 2 shadow reconciler. This is report-only for now:
 * it finds GatewayTransferIntent rows stuck in non-terminal states and
 * pages support Slack. Step 2 does not yet drive retries from this
 * table; that cutover waits for clean shadow data.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { notifyGatewayIntentStuck } from '@/lib/platform-wallet-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STUCK_MINUTES = 5;
const BATCH_SIZE = 25;

const IN_FLIGHT_STATES = ['prepared', 'burn_signed', 'burn_attested', 'mint_submitted'] as const;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - STUCK_MINUTES * 60_000);
  const stuck = await prisma.gatewayTransferIntent.findMany({
    where: {
      state: { in: [...IN_FLIGHT_STATES] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: 'asc' },
    take: BATCH_SIZE,
    select: {
      id: true,
      tenantId: true,
      state: true,
      destinationChain: true,
      amountMicroUsdc: true,
      updatedAt: true,
    },
  });

  const intents = stuck.map(intent => ({
    id: intent.id,
    tenantId: intent.tenantId,
    state: intent.state,
    destinationChain: intent.destinationChain,
    amountMicroUsdc: intent.amountMicroUsdc.toString(),
    ageMinutes: Math.floor((Date.now() - intent.updatedAt.getTime()) / 60_000),
  }));

  if (intents.length > 0) {
    await notifyGatewayIntentStuck({ intents });
  }

  return NextResponse.json({
    ok: intents.length === 0,
    scanned: stuck.length,
    stuck: intents,
  });
}
