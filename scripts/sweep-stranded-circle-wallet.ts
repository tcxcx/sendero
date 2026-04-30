#!/usr/bin/env bun

/**
 * Manual Gateway sweep for a stranded Circle wallet balance.
 *
 * Dry-run by default:
 *   bun --env-file=.env.local scripts/sweep-stranded-circle-wallet.ts \
 *     --wallet-id <circle-wallet-id> --amount 110
 *
 * Execute only after confirming the wallet, tenant, chain, token, and amount:
 *   bun --env-file=.env.local scripts/sweep-stranded-circle-wallet.ts \
 *     --wallet-id <circle-wallet-id> --amount 110 --execute
 */

import { GATEWAY_CHAINS } from '../packages/circle/src/gateway';
import { sweepChain } from '../packages/circle/src/gateway-sweep';
import { prisma } from '../packages/database/src';

type Args = {
  walletId?: string;
  amount?: string;
  execute: boolean;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { execute: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--execute') {
      args.execute = true;
      continue;
    }
    if (arg === '--wallet-id' || arg === '--circle-wallet-id') {
      args.walletId = argv[++i];
      continue;
    }
    if (arg === '--amount') {
      args.amount = argv[++i];
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function chainKeyForCircleId(circleId: string): keyof typeof GATEWAY_CHAINS | null {
  const normalized = circleId.toUpperCase();
  for (const [key, chain] of Object.entries(GATEWAY_CHAINS)) {
    if (chain.circleId.toUpperCase() === normalized) {
      return key as keyof typeof GATEWAY_CHAINS;
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.walletId || !args.amount) {
    throw new Error('usage: --wallet-id <circle-wallet-id> --amount <usdc> [--execute]');
  }

  const wallet = await prisma.circleWallet.findFirst({
    where: { circleWalletId: args.walletId },
    select: {
      tenantId: true,
      circleWalletId: true,
      address: true,
      kind: true,
      chain: true,
      usdcBalanceMicro: true,
      tenant: {
        select: {
          metadata: true,
          gatewayConfig: {
            select: {
              evmDepositorAddress: true,
              solanaDepositorAddress: true,
              enabledDomains: true,
            },
          },
        },
      },
    },
  });
  if (!wallet) {
    throw new Error(`CircleWallet not found for wallet id ${args.walletId}`);
  }

  const chainKey = chainKeyForCircleId(wallet.chain);
  if (!chainKey) {
    throw new Error(`wallet chain ${wallet.chain} is not mapped in GATEWAY_CHAINS`);
  }

  const config = wallet.tenant.gatewayConfig;
  if (!config) {
    throw new Error(`tenant ${wallet.tenantId} has no TenantGatewayConfig`);
  }

  const metadata = (wallet.tenant.metadata ?? {}) as Record<string, unknown>;
  const dryRun = {
    execute: args.execute,
    tenantId: wallet.tenantId,
    walletKind: wallet.kind,
    circleWalletId: wallet.circleWalletId,
    sourceAddress: wallet.address,
    chain: wallet.chain,
    chainKey,
    amountUsdc: args.amount,
    cachedUsdcBalance: Number(wallet.usdcBalanceMicro) / 1_000_000,
    gatewaySweepEnabled: metadata.gatewayEnabled !== false,
    gatewayMetadataFlag: metadata.gatewayEnabled ?? null,
    evmDepositorAddress: config.evmDepositorAddress,
    solanaDepositorAddress: config.solanaDepositorAddress,
    enabledDomains: config.enabledDomains,
  };

  console.log(JSON.stringify(dryRun, null, 2));
  if (!args.execute) {
    console.log('\nDry run only. Re-run with --execute after confirming the transfer details.');
    return;
  }

  const result = await sweepChain({
    tenantId: wallet.tenantId,
    opsDcwWalletId: wallet.circleWalletId ?? args.walletId,
    opsDcwAddress: wallet.address,
    chainKey,
    amount: args.amount,
    triggeredBy: 'manual',
  });
  console.log(JSON.stringify(result, null, 2));
}

void main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
