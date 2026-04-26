/**
 * GET /api/channels/slack/installs
 *
 * Lists every SlackInstall row for the active tenant. Used by the
 * Slack wizard to detect when the OAuth callback has landed and to
 * render the workspace picker.
 */

import { NextResponse } from 'next/server';

import { tools } from '@sendero/tools';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const tool = tools.slack_check_install;
  if (!tool) return NextResponse.json({ error: 'tool_unavailable' }, { status: 500 });
  const result = (await tool.handler({ tenantId: tenant.id })) as {
    installed: boolean;
    installs: Array<Record<string, unknown>>;
  };
  return NextResponse.json(result);
}
