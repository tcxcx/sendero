/**
 * GET /api/gateway/deposit-info
 *
 * Returns per-chain deposit addresses for USDC (via Gateway unified
 * balance) and EURC (direct on-chain, per-chain).
 *
 * Fast: DB-only, no Circle API calls. Used by DepositDialog to render
 * the copy-to-clipboard chain rows.
 *
 * USDC chains  — Arc, Avalanche, Arbitrum, Solana. EVM chains use
 *                per-chain Circle DCW operations wallets; Solana uses a
 *                separate Solana pubkey (Phase 4).
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
      circleWallets: {
        where: { kind: 'operations' },
        select: { chain: true, address: true },
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

  const { solanaDepositorAddress } = tenant.gatewayConfig;
  const opsAddressByChain = new Map(tenant.circleWallets.map(w => [w.chain, w.address]));
  const arcAddress = opsAddressByChain.get('ARC-TESTNET') ?? opsAddressByChain.get('ARC') ?? null;
  const avaxAddress = opsAddressByChain.get('AVAX-FUJI') ?? opsAddressByChain.get('AVAX') ?? null;
  const arbAddress = opsAddressByChain.get('ARB-SEPOLIA') ?? opsAddressByChain.get('ARB') ?? null;
  const solAddress =
    opsAddressByChain.get('SOL-DEVNET') ??
    opsAddressByChain.get('SOL') ??
    solanaDepositorAddress ??
    null;

  const usdc: DepositChain[] = [
    {
      chain: 'Arc_Testnet',
      label: 'Arc Testnet',
      kind: 'evm',
      address: arcAddress,
    },
    {
      chain: 'Avalanche_Fuji',
      label: 'Avalanche Fuji',
      kind: 'evm',
      address: avaxAddress,
    },
    {
      chain: 'Arbitrum_Sepolia',
      label: 'Arbitrum Sepolia',
      kind: 'evm',
      address: arbAddress,
    },
    {
      chain: 'Sol_Devnet',
      label: 'Solana Devnet',
      kind: 'solana',
      address: solAddress,
    },
  ];

  // EURC is chain-native (not via Gateway), EVM only for now.
  const eurc: DepositChain[] = [
    {
      chain: 'Arc_Testnet',
      label: 'Arc Testnet',
      kind: 'evm',
      address: arcAddress,
    },
    {
      chain: 'Avalanche_Fuji',
      label: 'Avalanche Fuji',
      kind: 'evm',
      address: avaxAddress,
    },
  ];

  const body: DepositInfoResponse = { usdc, eurc };
  return NextResponse.json(body);
}
