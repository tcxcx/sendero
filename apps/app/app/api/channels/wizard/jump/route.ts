/**
 * POST /api/channels/wizard/jump
 *
 * Rewinds an active channel setup wizard to a completed pause step.
 * Used by the step rail so operators can return to a failed/partial
 * connection step, restart, and replay downstream work with corrected
 * inputs.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { requireCurrentTenant } from '@/lib/tenant-context';
import { jumpWizardSession } from '@/lib/wizard-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; stepId?: string } = {};
  try {
    body = (await req.json()) as { sessionId?: string; stepId?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return NextResponse.json({ error: 'session_id_required' }, { status: 400 });
  }
  if (!body.stepId || typeof body.stepId !== 'string') {
    return NextResponse.json({ error: 'step_id_required' }, { status: 400 });
  }

  const { tenant } = await requireCurrentTenant();
  try {
    const snapshot = await jumpWizardSession({
      tenantId: tenant.id,
      sessionId: body.sessionId,
      stepId: body.stepId,
    });
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === 'wizard_session_not_found'
        ? 404
        : message === 'wizard_session_tenant_mismatch'
          ? 403
          : message === 'wizard_session_invalid_context'
            ? 409
            : message === 'wizard_step_not_found'
              ? 404
              : message === 'wizard_step_not_reachable'
                ? 409
                : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
