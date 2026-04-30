/**
 * POST /api/gateway/deposit
 *
 * Manually sweep USDC from the tenant's per-chain operations wallet into Circle Gateway.
 * Used by the operator UI's "Deposit" dialog. The auto-sweep loop runs
 * the same path on every Circle inbound webhook; this route is the
 * support / one-off path.
 *
 * Tenant-scoped: requires Clerk session + matching org. Returns 503 if
 * the tenant has no TenantGatewayConfig (provisioning gap).
 *
 * Body: { chain: chainKey, amount: decimal }
 *
 * Pre-condition: the tenant operations DCW must hold `amount` USDC on the
 * source chain. The route mirrors the webhook sweep path.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { sweepChain } from '@sendero/circle/gateway-sweep';
import { prisma } from '@sendero/database';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  chain: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export async function POST(req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, gatewayConfig: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }
  if (!tenant.gatewayConfig) {
    return NextResponse.json(
      {
        error: 'gateway_not_configured',
        message: 'TenantGatewayConfig missing — provision via /api/cron/provision-gateway.',
      },
      { status: 503 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    throw err;
  }

  try {
    const chainKey = body.chain as keyof typeof GATEWAY_CHAINS;
    const chain = GATEWAY_CHAINS[chainKey];
    const opsWallet = await prisma.circleWallet.findFirst({
      where: { tenantId: tenant.id, kind: 'operations', chain: chain.circleId },
      select: { address: true, circleWalletId: true },
    });
    if (!opsWallet?.circleWalletId) {
      return NextResponse.json(
        {
          error: 'operations_wallet_missing',
          message:
            `${chain.label} operations wallet is not provisioned yet. ` +
            'Run /api/cron/provision-gateway or wait for the login backfill.',
        },
        { status: 503 }
      );
    }

    const result = await sweepChain({
      tenantId: tenant.id,
      opsDcwWalletId: opsWallet.circleWalletId,
      opsDcwAddress: opsWallet.address,
      chainKey,
      amount: body.amount,
      triggeredBy: 'manual',
    });
    if (result.status !== 'confirmed' && result.status !== 'already-processed') {
      return NextResponse.json(
        {
          error: 'gateway_deposit_failed',
          message: result.status === 'failed' ? result.error : result.reason,
        },
        { status: 500 }
      );
    }
    return NextResponse.json({
      state: 'success',
      chain: body.chain,
      amount: body.amount,
      depositTxHash: result.depositTxHash,
      depositLogId: result.depositLogId,
      alreadyProcessed: result.status === 'already-processed',
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[gateway/deposit] error', { tenantId: tenant.id, chain: body.chain, detail });
    return NextResponse.json({ error: 'gateway_deposit_failed', message: detail }, { status: 500 });
  }
}
