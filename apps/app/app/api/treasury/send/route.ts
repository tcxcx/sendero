/**
 * POST /api/treasury/send
 *
 * Treasury sends are multisig-gated. This route accepts an operator
 * intent and dispatches to the per-chain proposal builder:
 *
 *   - 'sol' → `proposeSolanaUsdcTransfer` (Squads V4 via @sqds/multisig).
 *     Lives today in `apps/admin/lib/treasury/propose-solana.ts`;
 *     post-hackathon this route reuses the same helper exposed via a
 *     shared package boundary.
 *   - 'arc' → MSCA UserOp via `@sendero/multisig/userop-builder` +
 *     weight-config. Queued pending co-sign when sub-threshold.
 *
 * Hackathon scope: the route validates the intent, persists a stub
 * proposal row (or reuses the admin's proposal table), and returns the
 * proposal id so the dialog can render a "queued for approval" state.
 * Actual execution wiring is intentionally deferred — Treasury sends
 * are low-frequency operator actions and shipping a half-baked signer
 * is worse than shipping an explicit "coming online" surface.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Chain = 'arc' | 'sol';
type Token = 'USDC' | 'EURC';

interface SendBody {
  chain?: Chain;
  token?: Token;
  recipient?: string;
  amount?: string;
  memo?: string;
}

const SOL_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: SendBody;
  try {
    body = (await req.json()) as SendBody;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const chain: Chain | undefined = body.chain === 'arc' || body.chain === 'sol' ? body.chain : undefined;
  const token: Token = body.token === 'EURC' ? 'EURC' : 'USDC';
  const recipient = body.recipient?.trim() ?? '';
  const amount = body.amount?.trim() ?? '';
  const memo = body.memo?.trim() ?? '';

  if (!chain) {
    return NextResponse.json({ error: 'bad_chain' }, { status: 400 });
  }
  const addrRe = chain === 'sol' ? SOL_ADDR_RE : EVM_ADDR_RE;
  if (!addrRe.test(recipient)) {
    return NextResponse.json({ error: 'bad_recipient' }, { status: 400 });
  }
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return NextResponse.json({ error: 'bad_amount' }, { status: 400 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, primaryChain: true, displayName: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'no_tenant' }, { status: 404 });
  }
  if (tenant.primaryChain !== chain) {
    // Cascade invariant — refuse to queue a transfer on a chain the
    // tenant doesn't operate on. Defense-in-depth alongside the UI
    // which derives chain from userAuth.
    return NextResponse.json(
      {
        error: 'chain_mismatch',
        message: `Tenant primaryChain is ${tenant.primaryChain}, request was ${chain}.`,
      },
      { status: 400 }
    );
  }

  // Hackathon-shim: persist intent as a Trip.events-style audit row on
  // the Tenant metadata. Post-deadline, replace with:
  //
  //   if (chain === 'sol') {
  //     return proposeSolanaUsdcTransfer({ ... });
  //   }
  //   return queueArcUserOp({ ... });
  //
  // The shape of the response (`proposalId`) is forward-compatible —
  // both real builders return one.
  const proposalId = `treasury-${chain}-${Date.now().toString(36)}`;
  const intent = {
    proposalId,
    chain,
    token,
    recipient,
    amount,
    memo: memo || null,
    requestedBy: userId,
    requestedAt: new Date().toISOString(),
    status: 'queued',
  };

  // Append to Tenant.metadata.treasuryProposals via jsonb concat. No
  // schema migration — reuses the established Trip.events pattern.
  try {
    await prisma.$executeRaw`
      UPDATE tenants
      SET metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{treasuryProposals}',
        COALESCE(metadata->'treasuryProposals', '[]'::jsonb) || ${JSON.stringify([intent])}::jsonb,
        true
      ),
      "updatedAt" = NOW()
      WHERE id = ${tenant.id}
    `;
  } catch (err) {
    console.error('[treasury/send] persist failed', err);
    return NextResponse.json(
      {
        error: 'persist_failed',
        message: 'Could not record proposal intent. Try again.',
      },
      { status: 500 }
    );
  }

  console.log('[treasury/send] queued', { tenantId: tenant.id, proposalId, chain });

  return NextResponse.json({
    ok: true,
    proposalId,
    chain,
    status: 'queued',
    note:
      chain === 'sol'
        ? 'Squads V4 proposal will be built when signer wiring lands.'
        : 'MSCA UserOp will be queued when co-sign wiring lands.',
  });
}
