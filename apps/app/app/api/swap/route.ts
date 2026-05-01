import { type NextRequest, NextResponse } from 'next/server';

import type { SwapParams } from '@circle-fin/app-kit';
import { auth } from '@clerk/nextjs/server';
import { createAdapterForSigner, getAppKit, getKitKey } from '@sendero/circle/app-kit';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { materializeTenantUnifiedUsdToArc } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { z } from 'zod';

/**
 * POST /api/swap
 * USDC ↔ EURC swap on Arc Testnet via Circle App Kit.
 * Uses the calling org's per-tenant gateway signer EOA — NOT the treasury.
 *
 * Body: { from: 'USDC'|'EURC', to: 'USDC'|'EURC', amount: decimal string }
 */
const BodySchema = z.object({
  from: z.enum(['USDC', 'EURC']),
  to: z.enum(['USDC', 'EURC']),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Invalid amount'),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  // Provision on first use — getOrCreate is idempotent + race-safe.
  const signer = await getOrCreateGatewaySigner(tenant.id);

  try {
    const body = BodySchema.parse(await req.json());
    if (body.from === body.to) {
      return NextResponse.json(
        { error: 'invalid_input', message: 'from and to must differ.' },
        { status: 400 }
      );
    }

    const kit = getAppKit();
    const adapter = createAdapterForSigner(signer.privateKey);
    const gatewayFunding =
      body.from === 'USDC'
        ? await materializeTenantUnifiedUsdToArc({
            tenantId: tenant.id,
            amount: body.amount,
            recipient: signer.address,
          })
        : null;

    const params: SwapParams = {
      from: {
        adapter,
        chain: 'Arc_Testnet',
      },
      tokenIn: body.from,
      tokenOut: body.to,
      amountIn: body.amount,
      config: { kitKey: getKitKey() },
    };

    const result = await kit.swap(params);
    return NextResponse.json({
      txHash: result.txHash ?? null,
      explorerUrl: result.explorerUrl ?? null,
      amountOut: result.amountOut ?? null,
      tokenIn: result.tokenIn,
      tokenOut: result.tokenOut,
      amountIn: result.amountIn,
      fees: result.fees ?? [],
      signerAddress: signer.address,
      gatewayFunding,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const detail = errorDetail(err);
    console.error('[swap] error:', detail, { tenantId: tenant.id, signerAddress: signer.address });
    return NextResponse.json(
      { error: 'swap_failed', message: detail },
      { status: detail.includes('Insufficient') && detail.includes('Gateway USDC') ? 409 : 500 }
    );
  }
}
