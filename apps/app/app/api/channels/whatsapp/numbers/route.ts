/**
 * GET /api/channels/whatsapp/numbers?country=US
 *
 * Thin wrapper around the operator-only `kapso_list_numbers` tool so the
 * wizard's number picker pane can fetch from the client without leaking
 * the tool to MCP / external API keys.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { tools } from '@sendero/tools';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  await requireCurrentTenant();
  const country = req.nextUrl.searchParams.get('country');
  if (!country || country.length !== 2) {
    return NextResponse.json({ error: 'invalid_country' }, { status: 400 });
  }
  const tool = tools.kapso_list_numbers;
  if (!tool) {
    return NextResponse.json({ error: 'tool_unavailable' }, { status: 500 });
  }
  const result = (await tool.handler({ countryIso: country })) as {
    numbers: Array<{ id: string; e164: string; label?: string }>;
    source: 'kapso' | 'pool';
  };
  return NextResponse.json(result);
}
