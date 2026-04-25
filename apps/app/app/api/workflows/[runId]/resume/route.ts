/**
 * POST /api/workflows/:runId/resume
 *
 * Resumes a paused WorkflowRun with the operator's resolution payload
 * (the form values from the wizard's right pane). Returns the
 * post-resume snapshot so the wizard can re-render the next step.
 *
 * Tenant-scoped — the runId must belong to the caller's active org.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { resumePersistedRun } from '@/lib/workflow-run';
import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  let body: { resolution?: Record<string, unknown> } = {};
  try {
    body = (await req.json()) as { resolution?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const resolution = body.resolution ?? {};
  if (typeof resolution !== 'object' || resolution === null || Array.isArray(resolution)) {
    return NextResponse.json({ error: 'resolution_must_be_object' }, { status: 400 });
  }

  const { tenant, userId } = await requireCurrentTenant();
  try {
    const snapshot = await resumePersistedRun({
      tenantId: tenant.id,
      runId,
      resolution,
      ctx: { traveler: { userId, tenantId: tenant.id } },
    });
    return NextResponse.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      message === 'workflow_run_not_found'
        ? 404
        : message === 'workflow_run_tenant_mismatch'
          ? 403
          : message.startsWith('workflow_run_not_paused')
            ? 409
            : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
