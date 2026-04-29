/**
 * POST /api/gateway/transfer
 *
 * Transfer USDC from the tenant's Gateway unified balance to any address
 * on any enabled Gateway chain. Tenant Gateway EOA signs the burn intent;
 * Circle attests; the same EOA submits gatewayMint on the destination.
 *
 * Tenant-scoped: requires Clerk session. Returns 503 if Gateway not
 * configured.
 *
 * Body: { from: chainKey, to: chainKey, amount: decimal, recipient?: 0x… }
 *
 * Records every transfer (success or failure) to GatewayTransferLog for
 * audit + reconciliation. Unique on circleTransferId so duplicate
 * submissions collapse cleanly.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { auth } from '@clerk/nextjs/server';
import { GATEWAY_CHAINS, isSolanaChain, transferViaGateway } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  from: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  to: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  /**
   * Recipient address — accepts both EVM (0x… 20-byte hex) and Solana
   * (base58, 32-44 chars). Per-destination-chain validation happens
   * after parse: EVM destinations require 0x..., Solana destinations
   * require base58. Per-format-validation done in route body so the
   * error message can name the destination chain.
   */
  recipient: z
    .string()
    .regex(/^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/)
    .optional(),
});

export async function POST(req: NextRequest) {
  const { orgId, userId } = await auth();
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
        message: 'TenantGatewayConfig missing — provision via /api/cron/provision-gateway.',
      },
      { status: 503 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'invalid_input', issues: err.issues }, { status: 400 });
    }
    throw err;
  }

  if (body.from === body.to) {
    return NextResponse.json(
      { error: 'invalid_input', message: 'from and to must differ' },
      { status: 400 }
    );
  }

  const fromChain = GATEWAY_CHAINS[body.from as keyof typeof GATEWAY_CHAINS];
  const toChain = GATEWAY_CHAINS[body.to as keyof typeof GATEWAY_CHAINS];

  // Per-destination recipient format validation. The Zod schema accepts
  // either format; here we enforce the right one for the dest chain.
  // Solana destinations REQUIRE an explicit recipient because the
  // tenant signer is an EVM EOA — its address can't default-route to a
  // Solana account. EVM destinations default to the signer when omitted.
  if (isSolanaChain(toChain)) {
    if (!body.recipient) {
      return NextResponse.json(
        {
          error: 'invalid_input',
          message: 'Solana destinations require an explicit base58 recipient address',
        },
        { status: 400 }
      );
    }
    if (body.recipient.startsWith('0x')) {
      return NextResponse.json(
        {
          error: 'invalid_input',
          message: `Recipient is an EVM address (0x...) but destination ${toChain.label} is a Solana chain`,
        },
        { status: 400 }
      );
    }
  } else if (body.recipient && !body.recipient.startsWith('0x')) {
    return NextResponse.json(
      {
        error: 'invalid_input',
        message: `Recipient is a Solana address but destination ${toChain.label} is an EVM chain`,
      },
      { status: 400 }
    );
  }

  // Resolve user's row for audit attribution. Best-effort — auth() may
  // give us a Clerk userId without a matching User row in edge cases
  // (e.g. mid-creation). Don't fail the transfer.
  const initiatedByUser = userId
    ? await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    : null;

  const signer = await getOrCreateGatewaySigner(tenant.id);

  // Pre-create the transfer log so failures still leave an audit trail.
  // Status starts at 'attesting'; we update to 'confirmed' or 'failed'.
  // Recipient is stored case-preserved for Solana (base58 is case-sensitive)
  // and lowercased for EVM (canonical equality).
  const amountMicro = BigInt(Math.round(Number(body.amount) * 1_000_000));
  const recipientForLog = body.recipient
    ? isSolanaChain(toChain)
      ? body.recipient
      : body.recipient.toLowerCase()
    : signer.address;
  const log = await prisma.gatewayTransferLog.create({
    data: {
      tenantId: tenant.id,
      sourceDomain: fromChain.domain,
      destinationDomain: toChain.domain,
      destinationChain: toChain.kitName,
      amountMicroUsdc: amountMicro,
      recipientAddress: recipientForLog,
      status: 'attesting',
      // Phase 1-4 = self-mint path. EVM destinations: tenant EOA mints
      // via writeContract. Solana destinations: Sendero relayer mints
      // via @sendero/circle/gateway-solana-mint. Phase 5+ may add Circle
      // forwarding for EVM destinations to remove the gas dependency.
      forwardingEnabled: false,
      triggeredBy: 'manual',
      initiatedByUserId: initiatedByUser?.id ?? null,
    },
  });

  try {
    const result = await transferViaGateway({
      from: body.from as keyof typeof GATEWAY_CHAINS,
      to: body.to as keyof typeof GATEWAY_CHAINS,
      amountUsdc: body.amount,
      recipient: body.recipient,
      signer: signer.account,
    });

    await prisma.gatewayTransferLog.update({
      where: { id: log.id },
      data: {
        burnSignature: result.burnSignature,
        attestation: result.attestation,
        mintTxHash: result.mintHash,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });

    return NextResponse.json({
      state: 'success',
      from: body.from,
      to: body.to,
      amount: body.amount,
      recipient: body.recipient ?? null,
      mintHash: result.mintHash,
      explorerUrl: result.explorerUrl,
      burnSignature: result.burnSignature,
      transferLogId: log.id,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await prisma.gatewayTransferLog
      .update({
        where: { id: log.id },
        data: { status: 'failed', errorMessage: detail },
      })
      .catch(updateErr => {
        // Don't let a log-update failure mask the original error.
        console.error('[gateway/transfer] failed to update log row', {
          logId: log.id,
          updateErr,
        });
      });

    console.error('[gateway/transfer] error', { tenantId: tenant.id, detail });
    return NextResponse.json(
      { error: 'gateway_transfer_failed', message: detail, transferLogId: log.id },
      { status: 500 }
    );
  }
}
