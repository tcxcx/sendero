/**
 * GET /api/workflows/stamps/runs/[runId]/stream
 *
 * Re-attach to an in-flight stamp workflow's progress stream. Used
 * by the dashboard StampCard when the user navigates away and back
 * before the run completes — `?startIndex=` resumes from a known
 * tail so the client doesn't re-process events it already saw.
 */

import { NextResponse } from 'next/server';
import { getRun } from 'workflow/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!(await run.exists)) {
    return NextResponse.json({ error: 'workflow_run_not_found' }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const startIndexParam = searchParams.get('startIndex');
  const parsed = startIndexParam === null ? undefined : Number.parseInt(startIndexParam, 10);
  const startIndex = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;

  const stream = run.getReadable<string>({ startIndex });
  const tailIndex = await stream.getTailIndex();

  return new Response(stream, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'x-workflow-stream-tail-index': String(tailIndex),
    },
  });
}
