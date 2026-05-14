/**
 * GET /api/cron/journal-reconcile
 *
 * Gateway v5 Step 1 shadow guard. Compares journaled Gateway asset
 * balances against the existing Gateway balance-derived view for each
 * tenant/chain and pages support Slack on any mismatch.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { getTenantUnifiedBalances } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';

import { notifyJournalReconcileBreak } from '@/lib/platform-wallet-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Break = {
  tenantId: string;
  chain: string;
  journalMicroUsdc: string;
  balanceMicroUsdc: string;
  deltaMicroUsdc: string;
};

const chainNameToKey = new Map<string, keyof typeof GATEWAY_CHAINS>();
for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
  chainNameToKey.set(key, key as keyof typeof GATEWAY_CHAINS);
  chainNameToKey.set(chain.kitName, key as keyof typeof GATEWAY_CHAINS);
  chainNameToKey.set(chain.circleId, key as keyof typeof GATEWAY_CHAINS);
}
chainNameToKey.set('Solana_Devnet', 'Sol_Devnet');
chainNameToKey.set('Solana', 'Sol');

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany({
    where: { gatewayConfig: { isNot: null } },
    select: { id: true },
    take: 100,
  });

  const breaks: Break[] = [];
  const errors: Array<{ tenantId: string; error: string }> = [];

  for (const tenant of tenants) {
    try {
      const [journalRows, balanceView] = await Promise.all([
        prisma.journalEntry.groupBy({
          by: ['account', 'direction'],
          where: {
            tenantId: tenant.id,
            asset: 'USDC',
            account: { startsWith: 'asset:gateway:' },
          },
          _sum: { amountMicroUsdc: true },
        }),
        getTenantUnifiedBalances({ tenantId: tenant.id, includePending: true }),
      ]);

      const journalByChain = new Map<string, bigint>();
      for (const row of journalRows) {
        const chain = row.account.replace('asset:gateway:', '');
        const current = journalByChain.get(chain) ?? 0n;
        const amount = BigInt(row._sum.amountMicroUsdc?.toString() ?? '0');
        journalByChain.set(chain, row.direction === 'debit' ? current + amount : current - amount);
      }

      const balanceByChain = gatewayBalancesByChain(balanceView);
      const chains = new Set([...journalByChain.keys(), ...balanceByChain.keys()]);
      for (const chain of chains) {
        const journal = journalByChain.get(chain) ?? 0n;
        const balance = balanceByChain.get(chain) ?? 0n;
        const delta = journal - balance;
        if (delta !== 0n) {
          breaks.push({
            tenantId: tenant.id,
            chain,
            journalMicroUsdc: journal.toString(),
            balanceMicroUsdc: balance.toString(),
            deltaMicroUsdc: delta.toString(),
          });
        }
      }
    } catch (err) {
      errors.push({
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (breaks.length > 0) {
    await notifyJournalReconcileBreak({ breaks });
  }

  const status = breaks.length > 0 || errors.length > 0 ? 500 : 200;
  return NextResponse.json(
    {
      ok: breaks.length === 0 && errors.length === 0,
      scanned: tenants.length,
      breaks,
      errors,
    },
    { status }
  );
}

function gatewayBalancesByChain(balanceView: Awaited<ReturnType<typeof getTenantUnifiedBalances>>) {
  const byChain = new Map<string, bigint>();
  for (const account of balanceView.breakdown ?? []) {
    for (const row of account.breakdown ?? []) {
      const rawChain = String(row.chain);
      const chainKey = chainNameToKey.get(rawChain) ?? rawChain;
      const current = byChain.get(chainKey) ?? 0n;
      byChain.set(chainKey, current + decimalToMicro(String(row.confirmedBalance ?? '0')));
    }
  }
  return byChain;
}

function decimalToMicro(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}
