/**
 * GET /downloads/sendero.mcpb
 *
 * Stable, branded URL for the one-click Claude Desktop installer.
 * Redirects to the latest GitHub Release artifact so we can ship
 * new bundles without breaking existing share links, marketing
 * collateral, or directory listings.
 *
 * Public route — listed in proxy.ts so unauth visitors (Claude
 * Desktop's install dialog, unfurl bots, browsers downloading the
 * .mcpb directly) can fetch without a sign-in detour.
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-static';
export const revalidate = 300; // 5 min; the latest-download URL rarely changes

const LATEST_MCPB_URL = 'https://github.com/tcxcx/sendero/releases/latest/download/sendero.mcpb';

export async function GET(): Promise<Response> {
  return NextResponse.redirect(LATEST_MCPB_URL, {
    status: 302,
    headers: {
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
