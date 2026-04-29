import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { BridgeParams } from '@circle-fin/app-kit';
import { auth } from '@clerk/nextjs/server';
import { getAppKit, createAdapterForSigner, summarizeBridge } from '@sendero/circle/app-kit';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';

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

  const signer = await getOrCreateGatewaySigner(tenant.id);

  try {
    const body = BodySchema.parse(await req.json());
    const kit = getAppKit();
    const adapter = createAdapterForSigner(signer.privateKey);

    const params: BridgeParams = {
      from: {
        adapter,
        chain: body.fromChain,
      },
      to: {
        adapter,
        chain: 'Arc_Testnet',
      },
      amount: body.amount,
    };

    const result = await kit.bridge(params);
    return NextResponse.json({
      ...summarizeBridge(result),
      amount: body.amount,
      fromChain: body.fromChain,
      toChain: 'Arc_Testnet',
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
    console.error('[bridge] error:', detail, { tenantId: tenant.id, signerAddress: signer.address });
    return NextResponse.json({ error: 'bridge_failed', message: detail }, { status: 500 });
  }
}
