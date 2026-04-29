/**
 * GET /api/gateway/balance
 *
 * Returns the current tenant's unified USDC balance across every Gateway
 * domain they have configured, plus optimistic credits (deposits confirmed
 * on-chain but not yet attested by Circle) and ops DCW staging USDC
 * (inbound USDC waiting to be swept).
 *
 * Single user-facing number is `grandTotal`:
 *
 *   grandTotal = available (Gateway API balances)
 *              + pendingCreditTotal (optimistic, finalizing)
 *              + opsStagingTotal (ops DCW USDC mid-sweep)
 *
 * Tenant-scoped: requires a Clerk session with an active org. Returns
 * 503 if the tenant has no `TenantGatewayConfig` (provisioning gap;
 * the backfill cron picks it up on next run).
 */

import { NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const GATEWAY_API = 'https://gateway-api-testnet.circle.com/v1';

interface GatewayBalanceApiResponse {
  balances?: Array<{ domain: number; balance: string }>;
}

export async function GET() {
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
        message:
          'TenantGatewayConfig missing — backfill cron will provision on next run, ' +
          'or POST /api/cron/provision-gateway to force.',
      },
      { status: 503 }
    );
  }

  const config = tenant.gatewayConfig;
  const enabledDomains = config.enabledDomains;

  // Build the Gateway API request — one source per enabled domain,
  // all keyed off the same per-tenant EVM depositor address.
  const sources = enabledDomains.map(domain => ({
    domain,
    depositor: config.evmDepositorAddress,
  }));

  // Query Gateway API. Explicit timeout to keep the UI responsive
  // when Circle's API is slow.
  let gatewayApiBalances: Array<{ domain: number; balance: string }> = [];
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    try {
      const res = await fetch(`${GATEWAY_API}/balances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: 'USDC', sources }),
        signal: controller.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as GatewayBalanceApiResponse;
        gatewayApiBalances = data.balances ?? [];
      } else {
        console.warn('[gateway/balance] Gateway API non-200', {
          tenantId: tenant.id,
          status: res.status,
          body: await res.text().catch(() => 'unreadable'),
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (err) {
    console.warn('[gateway/balance] Gateway API call failed (continuing with empty balances)', {
      tenantId: tenant.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Per-domain breakdown — surfaces 0 for enabled domains that the
  // Gateway API didn't return (e.g. never deposited).
  const domainToChainKey = new Map<number, keyof typeof GATEWAY_CHAINS>();
  for (const [key, def] of Object.entries(GATEWAY_CHAINS)) {
    domainToChainKey.set(def.domain, key as keyof typeof GATEWAY_CHAINS);
  }
  const perDomain = enabledDomains.map(domain => {
    const apiEntry = gatewayApiBalances.find(b => b.domain === domain);
    const chainKey = domainToChainKey.get(domain);
    const def = chainKey ? GATEWAY_CHAINS[chainKey] : null;
    return {
      domain,
      chain: def?.kitName ?? `domain-${domain}`,
      label: def?.label ?? `Domain ${domain}`,
      balance: apiEntry?.balance ?? '0.000000',
    };
  });

  const available = perDomain.reduce((sum, d) => sum + Number(d.balance || 0), 0);

  // Optimistic credits — GatewayDepositLog rows that were confirmed
  // on-chain but may not yet show up in the Gateway API balance (Circle
  // attests + index lag, especially on L2s). 30-min lookback window.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000);
  const pendingCreditRows = await prisma.gatewayDepositLog.findMany({
    where: {
      tenantId: tenant.id,
      status: 'confirmed',
      confirmedAt: { gte: thirtyMinAgo },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const FINALIZATION_ETA_MS: Record<string, number> = {
    Arc_Testnet: 30_000, // ~30s, Arc is fast
    Avalanche_Fuji: 120_000,
    Base_Sepolia: 900_000,
    Optimism_Sepolia: 900_000,
    Arbitrum_Sepolia: 900_000,
    Polygon_Amoy: 300_000,
  };

  const pendingCredits = pendingCreditRows
    .map(row => {
      const confirmedAt = row.confirmedAt?.getTime() ?? Date.now();
      const etaMs = (FINALIZATION_ETA_MS[row.chain] ?? 300_000) + confirmedAt;
      const remainingMs = Math.max(0, etaMs - Date.now());
      return {
        chain: row.chain,
        domain: row.domain,
        amount: row.amountMicroUsdc.toString(),
        depositTxHash: row.depositTxHash,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
        estimatedAvailableAt: new Date(etaMs).toISOString(),
        remainingSeconds: Math.ceil(remainingMs / 1000),
        status: remainingMs > 0 ? 'finalizing' : 'should_be_available',
      } as const;
    })
    // Filter to the still-finalizing window so we don't double-count
    // credits the Gateway API has already incorporated.
    .filter(c => c.remainingSeconds > 0 || c.status === 'should_be_available');

  const pendingCreditMicroTotal = pendingCredits.reduce((sum, c) => sum + BigInt(c.amount), 0n);

  // Ops DCW staging USDC — what's sitting in the per-chain ops wallets
  // mid-sweep. Under steady state ("always-sweep" Phase 1 policy) these
  // hover near zero; non-zero values signal in-flight sweeps or stuck
  // sweeps the Phase 5 reconciler will pick up.
  const opsWallets = await prisma.circleWallet.findMany({
    where: { tenantId: tenant.id, kind: 'operations' },
    select: { address: true, chain: true, usdcBalanceMicro: true, balanceUpdatedAt: true },
  });
  const opsStaging = opsWallets.map(w => ({
    chain: w.chain,
    walletAddress: w.address,
    usdc: w.usdcBalanceMicro?.toString() ?? '0',
    updatedAt: w.balanceUpdatedAt?.toISOString() ?? null,
  }));
  const opsStagingMicroTotal = opsWallets.reduce((sum, w) => sum + (w.usdcBalanceMicro ?? 0n), 0n);

  // grandTotal in micro-USDC for precision, returned as 6-decimal
  // string. Number(available) parses Gateway API's decimal string; we
  // multiply to micro-USDC, add the bigint micro totals, then format.
  const availableMicro = BigInt(Math.round(available * 1_000_000));
  const grandTotalMicro = availableMicro + pendingCreditMicroTotal + opsStagingMicroTotal;
  const grandTotal = (Number(grandTotalMicro) / 1_000_000).toFixed(6);

  return NextResponse.json({
    grandTotal,
    available: available.toFixed(6),
    pendingCreditTotal: (Number(pendingCreditMicroTotal) / 1_000_000).toFixed(6),
    opsStagingTotal: (Number(opsStagingMicroTotal) / 1_000_000).toFixed(6),
    perDomain,
    pendingCredits,
    opsStaging,
    depositor: config.evmDepositorAddress,
    enabledDomains,
  });
}
