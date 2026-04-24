/**
 * DELETE /api/treasury/approvals/:opHash
 *
 * Cancel a pending (or threshold-met-but-not-submitted) multisig op.
 * Only tenant members with finance / agency-admin role can cancel.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { AuthError, requireFinance } from '@sendero/auth/tenant';

import { cancelPendingOp } from '@/lib/multisig-ops-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handleAuthError(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    const status = err.code === 'UNAUTHENTICATED' ? 401 : 403;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  return null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ opHash: string }> }
) {
  try {
    const { tenant } = await requireFinance();
    const { opHash } = await params;

    if (!/^0x[0-9a-fA-F]{64}$/.test(opHash)) {
      return NextResponse.json({ error: 'invalid_op_hash' }, { status: 400 });
    }

    const row = await cancelPendingOp(opHash, tenant.id);
    return NextResponse.json({ id: row.id, opHash: row.opHash, status: row.status });
  } catch (err) {
    const authRes = handleAuthError(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : 'cancel_failed';
    if (message.includes('No cancellable op')) {
      return NextResponse.json({ error: 'not_found', message }, { status: 404 });
    }
    return NextResponse.json({ error: 'cancel_failed', message }, { status: 500 });
  }
}
