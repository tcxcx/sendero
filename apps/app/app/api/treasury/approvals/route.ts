/**
 * /api/treasury/approvals — list + create pending multisig ops.
 *
 * GET  — list pending / threshold-met ops for the active tenant.
 * POST — create a new pending op (called from chat tool handlers that would
 *        previously have gone direct to the bundler).
 *
 * Both branches gate on `requireFinance()` (agency-admin | finance). The
 * repository (`apps/app/lib/multisig-ops-repo.ts`) owns persistence.
 *
 * Ported from desk-v1's `/api/multisig/ops` pattern, adapted to Sendero's
 * Tenant model. Cross-chain children (desk-v1 `pending_multisig_op_children`)
 * are deferred to v1 — see the TODO in the Prisma schema.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { AuthError, requireFinance } from '@sendero/auth/tenant';

import {
  createPendingOp,
  listPendingForTenant,
  type SignatureEntry,
} from '@/lib/multisig-ops-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface OpSummary {
  id: string;
  opHash: string;
  walletId: string;
  callData: string;
  threshold: number;
  collectedWeight: number;
  status: string;
  signatures: SignatureEntry[];
  transferMeta: Record<string, unknown>;
  initiatedByClerkUserId: string;
  expiresAt: string;
  createdAt: string;
  submittedAt: string | null;
  confirmedAt: string | null;
  txHash: string | null;
}

function handleAuthError(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    const status = err.code === 'UNAUTHENTICATED' ? 401 : 403;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  return null;
}

// ---------------------------------------------------------------------------
// GET — list pending ops
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const { tenant } = await requireFinance();
    const url = new URL(req.url);
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Math.min(100, Math.max(1, Number(limitParam))) : 50;
    const includeSubmitted = url.searchParams.get('includeSubmitted') === 'true';

    const rows = await listPendingForTenant(tenant.id, { limit, includeSubmitted });

    const ops: OpSummary[] = rows.map(row => ({
      id: row.id,
      opHash: row.opHash,
      walletId: row.walletId,
      callData: row.callData,
      threshold: row.threshold,
      collectedWeight: row.collectedWeight,
      status: row.status,
      signatures: Array.isArray(row.signatures)
        ? (row.signatures as unknown as SignatureEntry[])
        : [],
      transferMeta: (row.transferMeta as Record<string, unknown>) ?? {},
      initiatedByClerkUserId: row.initiatedByClerkUserId,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      txHash: row.txHash ?? null,
    }));

    return NextResponse.json({ ops });
  } catch (err) {
    const authRes = handleAuthError(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : 'list_failed';
    return NextResponse.json({ error: 'list_failed', message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a pending op
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    const { tenant, clerkUserId } = await requireFinance();
    const body = (await req.json()) as {
      walletId?: string;
      opHash?: string;
      userOp?: Record<string, unknown>;
      callData?: string;
      transferMeta?: Record<string, unknown>;
      threshold?: number;
      expiresAt?: string;
    };

    if (!body.walletId || typeof body.walletId !== 'string') {
      return NextResponse.json({ error: 'walletId_required' }, { status: 400 });
    }
    if (!body.opHash || !/^0x[0-9a-fA-F]{64}$/.test(body.opHash)) {
      return NextResponse.json({ error: 'invalid_op_hash' }, { status: 400 });
    }
    if (!body.userOp || typeof body.userOp !== 'object') {
      return NextResponse.json({ error: 'userOp_required' }, { status: 400 });
    }
    if (!body.callData || typeof body.callData !== 'string') {
      return NextResponse.json({ error: 'callData_required' }, { status: 400 });
    }
    if (typeof body.threshold !== 'number' || body.threshold <= 0) {
      return NextResponse.json({ error: 'threshold_required' }, { status: 400 });
    }

    const expiresAt = body.expiresAt
      ? new Date(body.expiresAt)
      : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // default 7d

    if (Number.isNaN(expiresAt.getTime())) {
      return NextResponse.json({ error: 'invalid_expires_at' }, { status: 400 });
    }

    const row = await createPendingOp({
      tenantId: tenant.id,
      walletId: body.walletId,
      opHash: body.opHash,
      userOp: body.userOp as never,
      callData: body.callData,
      transferMeta: (body.transferMeta ?? {}) as never,
      threshold: body.threshold,
      initiatedByClerkUserId: clerkUserId,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json(
      { id: row.id, opHash: row.opHash, status: row.status },
      { status: 201 }
    );
  } catch (err) {
    const authRes = handleAuthError(err);
    if (authRes) return authRes;
    // Duplicate opHash → Prisma P2002 surfaces as a generic error message.
    const message = err instanceof Error ? err.message : 'create_failed';
    const isDuplicate = message.includes('Unique constraint') || message.includes('opHash');
    return NextResponse.json(
      { error: isDuplicate ? 'duplicate_op_hash' : 'create_failed', message },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
