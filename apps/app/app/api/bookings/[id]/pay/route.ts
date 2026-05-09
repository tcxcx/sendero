import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { materializeTenantUnifiedUsdToArc } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { getOrder, payFromBalance } from '@sendero/duffel';
import { env } from '@sendero/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!env.duffelApiToken()) {
    return NextResponse.json(
      {
        error: 'duffel_not_configured',
        message: 'Set DUFFEL_API_TOKEN in .env.local.',
      },
      { status: 503 }
    );
  }

  try {
    const { id } = await params;
    const tenant = await prisma.tenant.findUnique({
      where: { clerkOrgId: orgId },
      select: { id: true },
    });
    if (!tenant) {
      return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
    }

    const order = await getOrder(id);
    const amount = String(order.total_amount);
    const currency = String(order.total_currency);
    if (!['USD', 'USDC'].includes(currency.toUpperCase())) {
      return NextResponse.json(
        {
          error: 'unsupported_gateway_currency',
          message: `Org Gateway booking payment currently supports USD/USDC holds; Duffel returned ${currency}.`,
        },
        { status: 422 }
      );
    }

    const gatewayFunding = await materializeTenantUnifiedUsdToArc({
      tenantId: tenant.id,
      amount,
    });
    const result = await payFromBalance(id);
    return NextResponse.json({
      ...result,
      gatewayFunding: {
        source: gatewayFunding.source,
        signerAddress: gatewayFunding.signerAddress,
        destinationChain: gatewayFunding.destinationChain,
        recipient: gatewayFunding.recipient,
        txHash: gatewayFunding.txHash,
        explorerUrl: gatewayFunding.explorerUrl,
        allocations: gatewayFunding.allocations,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'payment_failed', message },
      { status: /insufficient/i.test(message) ? 409 : 500 }
    );
  }
}
