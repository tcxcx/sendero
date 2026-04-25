/**
 * POST /api/transfer/spend
 *
 * Wraps `kit.unifiedBalance.spend()` from Circle App Kit's Unified
 * Balance Kit with the Sendero policy chain.  Every attempt — passed,
 * blocked, pending, executed, failed — writes a `TransferAttempt` row
 * so dashboards and budget guards have a single source of truth.
 *
 * Flow:
 *   1. Auth — Clerk session.
 *   2. Resolve tenant + traveler from the session.
 *   3. Parse body (amount, recipient, destinationChain, preApproved?).
 *   4. Run `enforcePolicyChain` with kind='transfer'.  Hard block →
 *      403 + transfer_attempt(status='blocked').  requiresApproval →
 *      202 + transfer_attempt(status='pending').
 *   5. On pass: load the App Kit delegate adapter from env.  Missing
 *      env → 503 with "configure delegate" guidance.
 *   6. Call `kit.unifiedBalance.spend()` with the delegate adapter +
 *      `sourceAccount` set to the traveler so funds come from the
 *      traveler's Unified Balance.  The delegate must already be
 *      authorized via `addDelegate` on the source chain.
 *   7. Persist `TransferAttempt(status='executed', txHash=…)`.
 *   8. Return `{ txHash, explorerUrl, recipientAddress, trace }`.
 *
 * Sandbox / testnet wiring: the env-driven delegate key path is fine
 * for hackathon and testnet dev.  Production should resolve the
 * delegate signer from a KMS or Circle Modular Wallet rather than
 * `SENDERO_UB_DELEGATE_PRIVATE_KEY`.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma, type Prisma } from '@sendero/database';

import { getUnifiedBalanceDelegate } from '@/lib/transfer-policy/app-kit';
import { enforcePolicyChain } from '@/lib/transfer-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  /** Decimal USDC amount, e.g. "5.00". Up to 6 decimals. */
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  /** Destination address. */
  recipient: z.string().min(1),
  /** App Kit chain name, e.g. "Arc_Testnet". */
  destinationChain: z.string().min(1),
  /** When set, ConfirmGuard treats the spend as already approved. */
  preApproved: z.boolean().optional(),
  /** Optional metadata (caller's tag, tripId, etc.) — stored verbatim. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function decimalToMicro(decimal: string): bigint {
  const [whole, frac = ''] = decimal.split('.');
  const padded = `${frac}000000`.slice(0, 6);
  return BigInt(whole || '0') * 1_000_000n + BigInt(padded || '0');
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const traveler = await prisma.user.findFirst({
    where: { clerkUserId: userId, memberships: { some: { tenantId: tenant.id } } },
    select: { id: true },
  });
  if (!traveler) {
    return NextResponse.json({ error: 'traveler_not_found' }, { status: 404 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const amountMicroUsdc = decimalToMicro(body.amount);

  // 1. Run the policy chain. enforcePolicyChain returns the response
  // envelope on hard reject / pending; on pass we keep going.
  const verdict = await enforcePolicyChain({
    tenantId: tenant.id,
    travelerId: traveler.id,
    context: {
      tenantId: tenant.id,
      travelerId: traveler.id,
      amountMicroUsdc,
      recipient: body.recipient,
      kind: 'transfer',
      preApproved: body.preApproved,
    },
  });

  // Persist a row regardless of outcome — operators care about the
  // attempts that *didn't* go through too.
  const baseAttempt: Prisma.TransferAttemptCreateInput = {
    tenant: { connect: { id: tenant.id } },
    traveler: { connect: { id: traveler.id } },
    amountMicroUsdc,
    recipient: body.recipient,
    destinationChain: body.destinationChain,
    metadata: (body.metadata ?? null) as Prisma.InputJsonValue,
    policyTrace: verdict.trace.map(t => ({
      guard: t.guard ?? null,
      allowed: t.allowed,
      reason: t.reason ?? null,
      requiresApproval: t.requiresApproval ?? false,
    })) as Prisma.InputJsonValue,
  };

  if (verdict.kind === 'blocked') {
    await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'blocked', blockReason: extractReason(verdict.trace) },
    });
    return verdict.response;
  }
  if (verdict.kind === 'pending') {
    await prisma.transferAttempt.create({
      data: { ...baseAttempt, status: 'pending', blockReason: extractReason(verdict.trace) },
    });
    return verdict.response;
  }

  // 2. Resolve the Unified Balance delegate. Missing env → 503 (route
  // is wired but the operator hasn't configured the signer yet).
  const handle = getUnifiedBalanceDelegate();
  if (!handle) {
    await prisma.transferAttempt.create({
      data: {
        ...baseAttempt,
        status: 'failed',
        blockReason: 'delegate_not_configured',
      },
    });
    return NextResponse.json(
      {
        error: 'delegate_not_configured',
        message:
          'Set SENDERO_UB_DELEGATE_PRIVATE_KEY (or wire a KMS-backed signer) before calling /api/transfer/spend. Policy enforcement passed; only the on-chain leg is blocked.',
        docs: 'https://developers.circle.com/app-kit/quickstarts/unified-balance-delegate-deposit-and-spend',
      },
      { status: 503 }
    );
  }

  // 3. Persist the "passed" attempt up front so a crash mid-call
  // still leaves a row. We update it on success / failure below.
  const attemptRow = await prisma.transferAttempt.create({
    data: { ...baseAttempt, status: 'passed' },
    select: { id: true },
  });

  // 4. Call kit.spend() with delegate signer + sourceAccount set to
  // the traveler so funds come from THEIR Unified Balance. The
  // delegate must already be authorized on the source chain via
  // `addDelegate` (App Kit delegate quickstart).
  try {
    const spendArgs = {
      amount: body.amount,
      token: 'USDC' as const,
      from: [
        {
          adapter: handle.adapter,
          sourceAccount: traveler.id,
        },
      ],
      to: {
        adapter: handle.adapter,
        chain: body.destinationChain,
        recipientAddress: body.recipient,
      },
    };
    // The kit's spend signature expects a typed `chain` literal. We
    // accept a string from the body to keep the route flexible (Arc
    // Testnet, Base Sepolia, etc.) and let the kit reject unknown
    // chain names with its own error.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await handle.kit.spend(spendArgs as any);
    const txHash = (result as { txHash?: string }).txHash ?? null;

    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'executed', txHash },
    });

    return NextResponse.json({
      ok: true,
      attemptId: attemptRow.id,
      txHash,
      result,
      trace: verdict.trace.map(t => ({
        guard: t.guard,
        allowed: t.allowed,
        reason: t.reason,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/transfer/spend] kit.unifiedBalance.spend failed', { message });
    await prisma.transferAttempt.update({
      where: { id: attemptRow.id },
      data: { status: 'failed', blockReason: message.slice(0, 500) },
    });
    return NextResponse.json(
      { error: 'spend_failed', message, attemptId: attemptRow.id },
      { status: 500 }
    );
  }
}

function extractReason(trace: Array<{ allowed: boolean; reason?: string }>): string {
  const blocker = trace.find(t => !t.allowed);
  if (blocker?.reason) return blocker.reason;
  const approver = trace.find(t => 'requiresApproval' in t);
  return approver?.reason ?? 'unknown';
}
