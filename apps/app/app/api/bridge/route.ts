import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { materializeGatewayUsdcToArc } from '@/lib/gateway-treasury';

/**
 * POST /api/bridge
 * Cross-chain USDC bridge INTO Arc Testnet via App Kit CCTP.
 * Uses the calling org's per-tenant gateway signer EOA for both the
 * source chain (burn) and the Arc destination (mint) — NOT the treasury.
 *
 * Body: { fromChain: 'Ethereum_Sepolia'|'Base_Sepolia'|…, amount: decimal }
 */
import { BRIDGE_CHAINS } from '@sendero/arc/bridge-chains';

const BodySchema = z.object({
  fromChain: z.enum(BRIDGE_CHAINS),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

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
    const result = await materializeGatewayUsdcToArc({
      tenantId: tenant.id,
      amount: body.amount,
      preferredSourceChain: body.fromChain,
    });
    return NextResponse.json({
      state: 'success',
      txHash: result.mintHash,
      explorerUrl: result.explorerUrl,
      steps: [
        {
          name: 'gateway_transfer',
          state: 'success',
          txHash: result.mintHash,
          explorerUrl: result.explorerUrl,
        },
      ],
      amount: body.amount,
      fromChain: result.from,
      requestedFromChain: body.fromChain,
      toChain: 'Arc_Testnet',
      signerAddress: result.signer.address,
      source: 'gateway',
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const anyErr = err as any;
    const detail: string =
      anyErr?.cause?.trace?.rawError?.shortMessage ||
      anyErr?.cause?.trace?.rawError?.message ||
      (err instanceof Error ? err.message : String(err));
    console.error('[bridge] error:', detail, {
      tenantId: tenant.id,
    });
    return NextResponse.json({ error: 'bridge_failed', message: detail }, { status: 500 });
  }
}
