import { type NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { getArcClient } from '@sendero/arc/chain';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import {
  resolveUnifiedBalanceChain,
  spendTenantUnifiedUsd,
} from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { getAddress, type Hex, parseAbiItem, zeroAddress } from 'viem';
import { z } from 'zod';

/**
 * POST /api/send
 * USDC transfer from the tenant's unified Gateway balance to any
 * Gateway-enabled chain (Arc, Sol, every EVM bridge chain). App Kit
 * auto-allocates sources across the tenant pool; the destination chain
 * is user-selected.
 *
 * Body: { to: address, amount: decimal, destinationChain?: kitName, token?: 'USDC' }
 *
 * - EVM destinations expect a 0x-prefixed 40-char hex recipient.
 * - Sol destinations expect a base58 Solana pubkey (32–44 chars).
 */
const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const SUPPORTED_DESTINATIONS = [
  'Arc_Testnet',
  'Sol_Devnet',
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Avalanche_Fuji',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Polygon_Amoy_Testnet',
] as const;

const BodySchema = z
  .object({
    to: z.string().min(1),
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
    token: z.literal('USDC').default('USDC'),
    destinationChain: z.enum(SUPPORTED_DESTINATIONS).default('Arc_Testnet'),
  })
  .refine(
    body => {
      const family = body.destinationChain === 'Sol_Devnet' ? 'sol' : 'evm';
      return family === 'sol' ? SOL_ADDRESS_RE.test(body.to) : EVM_ADDRESS_RE.test(body.to);
    },
    { path: ['to'], message: 'recipient does not match destination chain address format' }
  );

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const USDC_TRANSFER_EVENT = parseAbiItem(
  'event Transfer(address indexed from,address indexed to,uint256 value)'
);

function decimalToMicro(decimal: string): bigint {
  const [whole = '0', frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

function domainForAllocationChain(chainName: string | undefined): number | null {
  if (!chainName) return null;
  const normalized =
    chainName === 'Solana_Devnet' ? 'Sol_Devnet' : chainName === 'Solana' ? 'Sol' : chainName;
  const chain = Object.values(GATEWAY_CHAINS).find(c => c.kitName === normalized);
  return chain?.domain ?? null;
}

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

/**
 * Multi-source spend emits ONE Transfer event per allocation (one per
 * source chain that contributed). Sum the mint events (from = zero
 * address) to the recipient and verify total == expected.
 *
 * A single-source spend produces one Transfer; a multi-source spend
 * (e.g. Arc + Sol contributing to one destination) produces N. Both
 * are valid — the contract still credits the recipient the full
 * amount, just via multiple events.
 */
async function assertArcUsdcMintedToRecipient(args: {
  txHash: string;
  recipient: string;
  amountMicro: bigint;
}) {
  const client = getArcClient();
  const receipt = await client.getTransactionReceipt({ hash: args.txHash as Hex });
  if (receipt.status !== 'success') {
    throw new Error(`Arc mint transaction ${args.txHash} reverted`);
  }
  const recipient = getAddress(args.recipient);
  const transferLogs = await client.getLogs({
    address: ARC_USDC,
    event: USDC_TRANSFER_EVENT,
    args: { to: recipient },
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  let mintedToRecipient = 0n;
  for (const log of transferLogs) {
    if (log.transactionHash.toLowerCase() !== args.txHash.toLowerCase()) continue;
    const { from, value } = log.args;
    if (from && getAddress(from) === zeroAddress && typeof value === 'bigint') {
      mintedToRecipient += value;
    }
  }
  if (mintedToRecipient === args.amountMicro) return;
  throw new Error(
    `Arc mint transaction ${args.txHash} minted ${(
      Number(mintedToRecipient) / 1_000_000
    ).toFixed(6)} USDC to ${recipient}; expected ${(
      Number(args.amountMicro) / 1_000_000
    ).toFixed(6)} USDC`
  );
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const { orgId, userId } = await auth();
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

  const signer = await getOrCreateGatewaySigner(tenant.id);
  let gatewayTransferLogId: string | null = null;

  try {
    const body = BodySchema.parse(await req.json());
    const destinationChainKey = resolveUnifiedBalanceChain(body.destinationChain);
    const destinationChain = GATEWAY_CHAINS[destinationChainKey];
    const isArcDestination = destinationChainKey === 'Arc_Testnet';

    const amountMicro = decimalToMicro(body.amount);
    // EVM addresses get checksum-normalised; Sol base58 is case-sensitive
    // and must NOT be lowercased.
    const recipientForLog = body.destinationChain === 'Sol_Devnet' ? body.to : body.to.toLowerCase();

    const initiatedByUser = userId
      ? await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
      : null;
    const log = await prisma.gatewayTransferLog.create({
      data: {
        tenantId: tenant.id,
        sourceDomain: null,
        destinationDomain: destinationChain.domain,
        destinationChain: destinationChain.kitName,
        amountMicroUsdc: amountMicro,
        recipientAddress: recipientForLog,
        status: 'attesting',
        forwardingEnabled: false,
        triggeredBy: 'manual',
        initiatedByUserId: initiatedByUser?.id ?? null,
      },
    });
    gatewayTransferLogId = log.id;
    const result = await spendTenantUnifiedUsd({
      tenantId: tenant.id,
      amount: body.amount,
      recipient: body.to,
      destinationChain: destinationChainKey,
    });

    // Arc-only on-chain mint receipt assertion. Other chains (Sol +
    // EVM bridge chains) trust the SDK txHash today — App Kit only
    // returns when the destination mint is finalised, so a missing
    // receipt would already throw upstream. Add per-chain asserts as
    // each destination earns a verified end-to-end path.
    if (isArcDestination) {
      await assertArcUsdcMintedToRecipient({
        txHash: result.txHash,
        recipient: body.to,
        amountMicro,
      });
    }

    await prisma.gatewayTransferLog.update({
      where: { id: log.id },
      data: {
        sourceDomain: domainForAllocationChain(result.allocations?.[0]?.chain as string),
        mintTxHash: result.txHash,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });
    return NextResponse.json({
      state: 'success',
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      amount: body.amount,
      token: body.token,
      to: body.to,
      signerAddress: result.signerAddress,
      source: result.source,
      allocations: result.allocations,
      destinationChain: result.destinationChainName,
      transferLogId: log.id,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    const detail = errorDetail(err);
    if (gatewayTransferLogId) {
      await prisma.gatewayTransferLog
        .update({
          where: { id: gatewayTransferLogId },
          data: { status: 'failed', errorMessage: detail },
        })
        .catch(updateErr => {
          console.error('[send] failed to update gateway transfer log', {
            transferLogId: gatewayTransferLogId,
            updateErr,
          });
        });
    }
    console.error('[send] error:', detail, { tenantId: tenant.id, signerAddress: signer.address });
    return NextResponse.json(
      { error: 'send_failed', message: detail },
      { status: detail.startsWith('Insufficient spendable EVM Gateway USDC.') ? 409 : 500 }
    );
  }
}
