import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { materializeTenantUnifiedUsdToArc } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { z } from 'zod';

/**
 * POST /api/bridge
 * Cross-chain USDC bridge INTO Arc Testnet via App Kit CCTP.
 * Uses the calling org's per-tenant gateway signer EOA for both the
 * source chain (burn) and the Arc destination (mint) — NOT the treasury.
 *
 * Body: { fromChain: 'Ethereum_Sepolia'|'Base_Sepolia'|…, amount: decimal }
 */
const SUPPORTED_GATEWAY_BRIDGE_SOURCES = [
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
] as const;

const BodySchema = z.object({
  fromChain: z.enum(SUPPORTED_GATEWAY_BRIDGE_SOURCES),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

function errorDetail(err: unknown): string {
  const traced = err as {
    cause?: { trace?: { rawError?: { shortMessage?: string; message?: string } } };
  };
  return (
    traced.cause?.trace?.rawError?.shortMessage ||
    traced.cause?.trace?.rawError?.message ||
    (err instanceof Error ? err.message : String(err))
  );
}

export async function POST(req: NextRequest) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  try {
    const body = BodySchema.parse(await req.json());
    const result = await materializeTenantUnifiedUsdToArc({
      tenantId: tenant.id,
      amount: body.amount,
    });
    return NextResponse.json({
      state: 'success',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      steps: [
        {
          name: 'unified_balance_spend',
          state: 'success',
          txHash: result.txHash,
          explorerUrl: result.explorerUrl,
        },
      ],
      amount: body.amount,
      fromChain: result.allocations?.[0]?.chain ?? null,
      allocations: result.allocations,
      requestedFromChain: body.fromChain,
      toChain: 'Arc_Testnet',
      signerAddress: result.signerAddress,
      source: result.source,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const detail = errorDetail(err);
    console.error('[bridge] error:', detail, {
      tenantId: tenant.id,
    });
    return NextResponse.json(
      { error: 'bridge_failed', message: detail },
      { status: detail.includes('Insufficient') && detail.includes('Gateway USDC') ? 409 : 500 }
    );
  }
}
