/**
 * GET /api/gateway/deposit-info
 *
 * Returns per-chain deposit addresses for USDC (via Gateway unified
 * balance) and EURC (direct on-chain, per-chain).
 *
 * Fast: DB-only, no Circle API calls. Used by DepositDialog to render
 * the copy-to-clipboard chain rows.
 *
 * USDC chains  — Arc, Avalanche, Solana. Same evmDepositorAddress on all
 *                EVM chains; Solana uses a separate Solana pubkey (Phase 4).
 * EURC chains  — Arc and Avalanche only. EURC isn't in the Gateway pool;
 *                each chain balance is independent. Solana EURC excluded
 *                (not deployed on SOL-DEVNET).
 */

import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export interface DepositChain {
  chain: string;
  label: string;
  kind: 'evm' | 'solana';
  /** Null when not yet provisioned (e.g. Solana before Phase 4). */
  address: string | null;
}

export interface DepositInfoResponse {
  /** USDC deposits: funds pool into unified Gateway balance. */
  usdc: DepositChain[];
  /** EURC deposits: direct on-chain, per-chain balance, no pooling. */
  eurc: DepositChain[];
}

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: {
      id: true,
      gatewayConfig: {
        select: {
          evmDepositorAddress: true,
          solanaDepositorAddress: true,
          enabledDomains: true,
        },
      },
    },
  });

  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  if (!tenant.gatewayConfig) {
    return NextResponse.json(
      {
        error: 'gateway_not_configured',
        message:
          'Gateway not provisioned yet — come back in a moment, or POST ' +
          '/api/cron/provision-gateway to force.',
      },
      { status: 503 }
    );
  }

  const { evmDepositorAddress, solanaDepositorAddress } = tenant.gatewayConfig;

  const usdc: DepositChain[] = [
    {
      chain: 'Arc_Testnet',
      label: 'Arc Testnet',
      kind: 'evm',
      address: evmDepositorAddress,
    },
    {
      chain: 'Avalanche_Fuji',
      label: 'Avalanche Fuji',
      kind: 'evm',
      address: evmDepositorAddress,
    },
    {
      chain: 'Sol_Devnet',
      label: 'Solana Devnet',
      kind: 'solana',
      address: solanaDepositorAddress ?? null,
    },
  ];

  // EURC is chain-native (not via Gateway), EVM only for now.
  const eurc: DepositChain[] = [
    {
      chain: 'Arc_Testnet',
      label: 'Arc Testnet',
      kind: 'evm',
      address: evmDepositorAddress,
    },
    {
      chain: 'Avalanche_Fuji',
      label: 'Avalanche Fuji',
      kind: 'evm',
      address: evmDepositorAddress,
    },
  ];

  const body: DepositInfoResponse = { usdc, eurc };
  return NextResponse.json(body);
}
