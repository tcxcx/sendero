/**
 * GET /api/workflows/list
 *
 * Returns the canonical workflow catalog. Used by:
 *   - the LLM in /api/agent/dispatch to know what plans it can invoke
 *     by name (instead of calling tools one-at-a-time)
 *   - the admin console to render the "run a workflow" menu
 *   - MCP clients discovering named plans alongside tools
 */

import { NextResponse } from 'next/server';
import { WORKFLOW_CATALOG, listWorkflows } from '@sendero/workflows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    workflows: listWorkflows(),
    count: Object.keys(WORKFLOW_CATALOG).length,
  });
}
