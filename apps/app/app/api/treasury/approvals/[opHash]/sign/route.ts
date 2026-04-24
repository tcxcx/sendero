/**
 * POST /api/treasury/approvals/:opHash/sign
 *
 * Append a signer's approval to a pending multisig op. If the collected weight
 * reaches threshold the repo auto-transitions the op to `threshold_met`.
 *
 * NOTE (phase 11g): this route collects signatures but does NOT auto-submit to
 * the bundler yet — the bundler integration lands in phase 11h along with the
 * `provisionTenantWallet` plugin install flow. For now clients should poll
 * GET /api/treasury/approvals and call the (future) submit endpoint after the
 * op hits threshold. The response returns `thresholdMet` so the UI can show a
 * pending "ready to submit" state immediately.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { AuthError, requireFinance } from '@sendero/auth/tenant';

import { appendSignature, type SignatureEntry } from '@/lib/multisig-ops-repo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handleAuthError(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    const status = err.code === 'UNAUTHENTICATED' ? 401 : 403;
    return NextResponse.json({ error: err.code, message: err.message }, { status });
  }
  return null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ opHash: string }> }) {
  try {
    await requireFinance();
    const { opHash } = await params;

    if (!/^0x[0-9a-fA-F]{64}$/.test(opHash)) {
      return NextResponse.json({ error: 'invalid_op_hash' }, { status: 400 });
    }

    const body = (await req.json()) as {
      signerAddress?: string;
      signature?: string;
      weight?: number;
      userOpSigType?: string;
    };

    if (!body.signerAddress || !/^0x[0-9a-fA-F]{40}$/.test(body.signerAddress)) {
      return NextResponse.json({ error: 'invalid_signer_address' }, { status: 400 });
    }
    if (!body.signature || typeof body.signature !== 'string') {
      return NextResponse.json({ error: 'signature_required' }, { status: 400 });
    }
    if (typeof body.weight !== 'number' || body.weight <= 0) {
      return NextResponse.json({ error: 'weight_required' }, { status: 400 });
    }

    const entry: SignatureEntry = {
      signerAddress: body.signerAddress,
      signature: body.signature,
      weight: body.weight,
      signedAt: new Date().toISOString(),
      ...(body.userOpSigType ? { userOpSigType: body.userOpSigType } : {}),
    };

    const result = await appendSignature(opHash, entry);

    return NextResponse.json({
      opHash,
      collectedWeight: result.collectedWeight,
      status: result.status,
      thresholdMet: result.status === 'threshold_met',
    });
  } catch (err) {
    const authRes = handleAuthError(err);
    if (authRes) return authRes;
    const message = err instanceof Error ? err.message : 'sign_failed';
    // Surface duplicate-signer + missing-op as 409 / 404 respectively.
    if (message.includes('already approved')) {
      return NextResponse.json({ error: 'already_signed', message }, { status: 409 });
    }
    if (message.includes('No pending op')) {
      return NextResponse.json({ error: 'not_found', message }, { status: 404 });
    }
    return NextResponse.json({ error: 'sign_failed', message }, { status: 500 });
  }
}
