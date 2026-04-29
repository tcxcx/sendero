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
import { GATEWAY_CHAINS, transferViaGateway } from '@sendero/circle/gateway';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  from: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  to: z.enum(Object.keys(GATEWAY_CHAINS) as [string, ...string[]]),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  recipient: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
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

  // Resolve user's row for audit attribution. Best-effort — auth() may
  // give us a Clerk userId without a matching User row in edge cases
  // (e.g. mid-creation). Don't fail the transfer.
  const initiatedByUser = userId
    ? await prisma.user.findUnique({ where: { clerkUserId: userId }, select: { id: true } })
    : null;

  const signer = await getOrCreateGatewaySigner(tenant.id);

  const fromChain = GATEWAY_CHAINS[body.from as keyof typeof GATEWAY_CHAINS];
  const toChain = GATEWAY_CHAINS[body.to as keyof typeof GATEWAY_CHAINS];

  // Pre-create the transfer log so failures still leave an audit trail.
  // Status starts at 'attesting'; we update to 'confirmed' or 'failed'.
  const amountMicro = BigInt(Math.round(Number(body.amount) * 1_000_000));
  const log = await prisma.gatewayTransferLog.create({
    data: {
      tenantId: tenant.id,
      sourceDomain: fromChain.domain,
      destinationDomain: toChain.domain,
      destinationChain: toChain.kitName,
      amountMicroUsdc: amountMicro,
      recipientAddress: (body.recipient ?? signer.address).toLowerCase(),
      status: 'attesting',
      // Phase 1 = self-mint path (the tenant EOA mints on dest). Phase 4
      // adds Circle forwarding for EVM destinations once Solana lands.
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
      recipient: body.recipient as `0x${string}` | undefined,
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
