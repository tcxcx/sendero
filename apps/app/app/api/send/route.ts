import type { SendParams } from '@circle-fin/app-kit';
import { auth } from '@clerk/nextjs/server';
import { getAppKit, createAdapterForSigner, summarizeSend } from '@sendero/circle/app-kit';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { materializeGatewayUsdcToArc } from '@/lib/gateway-treasury';

/**
 * POST /api/send
 * Same-chain USDC/EURC transfer on Arc Testnet via App Kit (viem adapter).
 * Uses the calling org's per-tenant gateway signer EOA — NOT the treasury.
 *
 * Body: { to: 0xAddress, amount: decimal, token?: 'USDC'|'EURC' }
 */
const BodySchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  token: z.enum(['USDC', 'EURC']).default('USDC'),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  const signer = await getOrCreateGatewaySigner(tenant.id);

  try {
    const body = BodySchema.parse(await req.json());
    if (body.token === 'USDC') {
      const result = await materializeGatewayUsdcToArc({
        tenantId: tenant.id,
        amount: body.amount,
        recipient: body.to,
      });
      return NextResponse.json({
        state: 'success',
        txHash: result.mintHash,
        explorerUrl: result.explorerUrl,
        amount: body.amount,
        token: body.token,
        to: body.to,
        signerAddress: result.signer.address,
        source: 'gateway',
        sourceChain: result.from,
      });
    }

    const kit = getAppKit();
    const adapter = createAdapterForSigner(signer.privateKey);

    const params: SendParams = {
      from: {
        adapter,
        chain: 'Arc_Testnet',
      },
      to: body.to,
      amount: body.amount,
      token: body.token,
    };

    const result = await kit.send(params);
    return NextResponse.json({
      ...summarizeSend(result),
      amount: body.amount,
      token: body.token,
      to: body.to,
      signerAddress: signer.address,
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
    console.error('[send] error:', detail, { tenantId: tenant.id, signerAddress: signer.address });
    return NextResponse.json({ error: 'send_failed', message: detail }, { status: 500 });
  }
}
