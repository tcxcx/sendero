/**
 * GET /api/channels/slack/channels?installId=…
 *
 * Lists workspace channels via Slack Web API. Tenant-scoped: the
 * installId must belong to the caller's tenant.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@sendero/database';
import { tools } from '@sendero/tools';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { tenant } = await requireCurrentTenant();
  const installId = req.nextUrl.searchParams.get('installId');
  if (!installId) {
    return NextResponse.json({ error: 'install_id_required' }, { status: 400 });
  }
  const install = await prisma.slackInstall.findUnique({
    where: { id: installId },
    select: { tenantId: true },
  });
  if (!install || install.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'install_not_found' }, { status: 404 });
  }
  const tool = tools.slack_list_workspace_channels;
  if (!tool) return NextResponse.json({ error: 'tool_unavailable' }, { status: 500 });
  const result = (await tool.handler({ installId })) as {
    channels: Array<{ id: string; name: string; isPrivate: boolean }>;
    nextCursor: string | null;
  };
  return NextResponse.json(result);
}
