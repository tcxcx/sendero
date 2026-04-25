/**
 * GET /api/workflows/stamps/runs/[runId]
 *
 * Returns the current status of a stamp generation run plus the
 * final result when complete. Polled by the dashboard StampCard
 * after the initial stream connection drops.
 */

import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';

import type { StampWorkflowResult } from '@/workflows/stamps/shared/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!(await run.exists)) {
    return NextResponse.json({ error: 'workflow_run_not_found' }, { status: 404 });
  }

  const status = await run.status;
  if (status === 'completed') {
    const result = (await run.returnValue) as StampWorkflowResult;
    return NextResponse.json({ status, result });
  }

  return NextResponse.json({ status });
}
