import { type NextRequest, NextResponse } from 'next/server';

import type { SendParams } from '@circle-fin/app-kit';
import { auth } from '@clerk/nextjs/server';
import { getArcClient } from '@sendero/arc/chain';
import { createAdapterForSigner, getAppKit, summarizeSend } from '@sendero/circle/app-kit';
import { GATEWAY_CHAINS } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { spendTenantUnifiedUsd } from '@sendero/circle/unified-balance';
import { prisma } from '@sendero/database';
import { getAddress, type Hex, parseAbiItem, zeroAddress } from 'viem';
import { z } from 'zod';

import { notifyTenantGatewayPool } from '@/lib/gateway-pool-notify';

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

const ARC_USDC = '0x3600000000000000000000000000000000000000' as const;
const ARC_DOMAIN = GATEWAY_CHAINS.Arc_Testnet.domain;
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
  for (const log of transferLogs) {
    if (log.transactionHash.toLowerCase() !== args.txHash.toLowerCase()) continue;
    const { from, value } = log.args;
    if (from && getAddress(from) === zeroAddress && value === args.amountMicro) {
      return;
    }
  }
  throw new Error(
    `Arc mint transaction ${args.txHash} did not include the expected ${(
      Number(args.amountMicro) / 1_000_000
    ).toFixed(6)} USDC mint to ${recipient}`
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
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const signer = await getOrCreateGatewaySigner(tenant.id);
  let gatewayTransferLogId: string | null = null;

  try {
    const body = BodySchema.parse(await req.json());
    if (body.token === 'USDC') {
      const amountMicro = decimalToMicro(body.amount);
      const initiatedByUser = userId
        ? await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
        : null;
      const log = await prisma.gatewayTransferLog.create({
        data: {
          tenantId: tenant.id,
          sourceDomain: null,
          destinationDomain: ARC_DOMAIN,
          destinationChain: GATEWAY_CHAINS.Arc_Testnet.kitName,
          amountMicroUsdc: amountMicro,
          recipientAddress: body.to.toLowerCase(),
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
        destinationChain: 'Arc_Testnet',
        gatewayTransferLogId: log.id,
        journalContextRef: log.id,
        journalContextKind: 'spend',
      });
      await assertArcUsdcMintedToRecipient({
        txHash: result.txHash,
        recipient: body.to,
        amountMicro,
      });
      await prisma.gatewayTransferLog.update({
        where: { id: log.id },
        data: {
          sourceDomain: domainForAllocationChain(result.allocations?.[0]?.chain as string),
          mintTxHash: result.txHash,
          status: 'confirmed',
          confirmedAt: new Date(),
        },
      });
      // Phase 4.5 — pulse the gateway-pool SSE channel so the dashboard
      // reflects the post-spend pool balance without waiting on the
      // 30s unified-balance poll. Sol-source spends drain the
      // self-custody pool; EVM-only spends drain the EVM signer's
      // Gateway pool — either way the unified balance shrank.
      void notifyTenantGatewayPool({ tenantId: tenant.id, reason: 'spend' });
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
