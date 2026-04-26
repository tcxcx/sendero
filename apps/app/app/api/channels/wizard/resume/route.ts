/**
 * POST /api/channels/wizard/resume
 *
 * Wizard-specific resume endpoint. The platform's /api/workflows/resume
 * returns a raw WorkflowRun (used by chat / MCP); the channel setup
 * wizards need the projected `WizardRunSnapshot` shape with step rail
 * + active payload, so they hit this thin wrapper around
 * `resumeWizardSession()`.
 *
 * Tenant-scoped: the sessionId must belong to the caller's active org.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { requireCurrentTenant } from '@/lib/tenant-context';
import { resumeWizardSession } from '@/lib/wizard-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  let body: { sessionId?: string; resolution?: Record<string, unknown> } = {};
  try {
    body = (await req.json()) as { sessionId?: string; resolution?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.sessionId || typeof body.sessionId !== 'string') {
    return NextResponse.json({ error: 'session_id_required' }, { status: 400 });
  }
  const resolution = body.resolution ?? {};
  if (typeof resolution !== 'object' || resolution === null || Array.isArray(resolution)) {
    return NextResponse.json({ error: 'resolution_must_be_object' }, { status: 400 });
  }

  const { tenant, userId } = await requireCurrentTenant();
  try {
    const snapshot = await resumeWizardSession({
      tenantId: tenant.id,
      sessionId: body.sessionId,
      resolution,
      ctx: { traveler: { userId, tenantId: tenant.id } },
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
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
