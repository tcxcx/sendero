/**
 * POST /api/gateway/deposit
 *
 * Manually deposit USDC from the tenant's Gateway EOA into Circle Gateway.
 * Used by the operator UI's "Deposit" dialog. The auto-sweep loop runs
 * the same path on every Circle inbound webhook; this route is the
 * support / one-off path.
 *
 * Tenant-scoped: requires Clerk session + matching org. Returns 503 if
 * the tenant has no TenantGatewayConfig (provisioning gap).
 *
 * Body: { chain: chainKey, amount: decimal }
 *
 * Pre-condition: the tenant Gateway EOA must hold `amount` USDC on the
 * source chain. The route does NOT move USDC from anywhere — it signs
 * an EIP-3009 ReceiveWithAuthorization for already-held USDC and
 * submits depositWithAuthorization on-chain (paid by platform sponsor).
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@clerk/nextjs/server';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { depositToGateway } from '@sendero/circle/gateway-deposit';
import { prisma } from '@sendero/database';

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
    const result = await depositToGateway({
      tenantId: tenant.id,
      chainKey: body.chain as keyof typeof GATEWAY_CHAINS,
      amount: body.amount,
      triggeredBy: 'manual',
    });
    return NextResponse.json({
      state: 'success',
      chain: body.chain,
      amount: body.amount,
      depositTxHash: result.depositTxHash,
      depositLogId: result.depositLogId,
      alreadyProcessed: result.alreadyProcessed,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[gateway/deposit] error', { tenantId: tenant.id, chain: body.chain, detail });
    return NextResponse.json({ error: 'gateway_deposit_failed', message: detail }, { status: 500 });
  }
}
