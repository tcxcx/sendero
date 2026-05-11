import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { z } from 'zod';

/**
 * POST /api/bridge
 *
 * Move USDC between chains within the tenant's unified Gateway balance.
 * Source is implicit — App Kit auto-allocates from any chain the
 * tenant holds funds on. The user only picks where the funds should
 * LAND.
 *
 * Recipient strategy: mint to the destination chain's ops DCW. That's
 * a Circle developer-controlled wallet provisioned per chain on tenant
 * onboarding. Circle's webhook fires `transactions.inbound` when USDC
 * lands there, which triggers our existing sweep machinery
 * (`apps/app/app/api/webhooks/circle/transactions/route.ts` →
 * `sweepChain`). The sweep calls `depositFor` to push the funds INTO
 * the destination Gateway pool, credited to the canonical depositor
 * (EVM signer EOA on EVM, Sol self-custody pubkey on Sol).
 *
 * Why DCW and not the signer EOA: the signer EOA has no native gas on
 * non-Arc chains. Circle DCWs are wired through Circle Gas Station for
 * EVM — gas is sponsored, sweep just works. On Sol the JIT-drip
 * (`ensureSolanaGas`) keeps the DCW funded.
 *
 * Body: { destinationChain: 'Arc_Testnet'|'Sol_Devnet'|…, amount }
 */
const SUPPORTED_DESTINATIONS = [
  'Arc_Testnet',
  'Sol_Devnet',
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
] as const;

const CHAIN_KEY_TO_DCW_CHAIN: Record<(typeof SUPPORTED_DESTINATIONS)[number], string> = {
  Arc_Testnet: 'ARC-TESTNET',
  Sol_Devnet: 'SOL-DEVNET',
  Ethereum_Sepolia: 'ETH-SEPOLIA',
  Base_Sepolia: 'BASE-SEPOLIA',
  Polygon_Amoy_Testnet: 'MATIC-AMOY',
  Avalanche_Fuji: 'AVAX-FUJI',
  Arbitrum_Sepolia: 'ARB-SEPOLIA',
  Optimism_Sepolia: 'OP-SEPOLIA',
};

const BodySchema = z.object({
  destinationChain: z.enum(SUPPORTED_DESTINATIONS),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  /** Optional override; defaults to the destination chain's ops DCW. */
  recipient: z.string().min(1).optional(),
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
    select: { id: true, primaryChain: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  try {
    const body = BodySchema.parse(await req.json());
    const destinationKey = body.destinationChain;

    // Default recipient = destination chain's ops DCW. The DCW receives
    // the cross-chain mint; Circle's webhook then fires our sweep,
    // which deposits into Gateway pool credited to the canonical
    // depositor. This is the same path normal deposits take, so the
    // unified balance UI picks it up via the existing flow.
    let recipient: string;
    if (body.recipient) {
      recipient = body.recipient;
    } else {
      const dcwChain = CHAIN_KEY_TO_DCW_CHAIN[destinationKey];
      const opsDcw = await prisma.circleWallet.findFirst({
        where: { tenantId: tenant.id, kind: 'operations', chain: dcwChain },
        select: { address: true },
      });
      if (!opsDcw) {
        return NextResponse.json(
          {
            error: 'destination_dcw_not_provisioned',
            message: `Tenant has no ops DCW on ${destinationKey} (chain key ${dcwChain}). Provision it via the onboarding flow or pass an explicit recipient.`,
          },
          { status: 409 }
        );
      }
      recipient = opsDcw.address;
    }

    const spendResult = await spendTenantUnifiedUsd({
      tenantId: tenant.id,
      amount: body.amount,
      destinationChain: destinationKey,
      recipient,
    });

    return NextResponse.json({
      state: 'success',
      txHash: spendResult.txHash,
      explorerUrl: spendResult.explorerUrl,
      steps: [
        {
          name: 'unified_balance_spend',
          state: 'success',
          txHash: spendResult.txHash,
          explorerUrl: spendResult.explorerUrl,
        },
        {
          name: 'awaiting_sweep_into_pool',
          state: 'pending',
          note: 'Funds minted to ops DCW. Circle webhook will fire shortly; the existing sweep will deposit them into the destination Gateway pool. Refresh the wallet balance in 10-30s.',
        },
      ],
      amount: body.amount,
      fromChain: spendResult.allocations?.[0]?.chain ?? null,
      allocations: spendResult.allocations,
      destinationChain: destinationKey,
      destinationChainLabel: spendResult.destinationChainName,
      recipient,
      signerAddress: spendResult.signerAddress,
      source: spendResult.source,
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
