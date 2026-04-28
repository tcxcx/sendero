/**
 * GET /downloads/sendero-claude-code-plugin.zip
 *
 * Stable, branded URL for the Claude Code plugin bundle. Redirects to
 * the latest GitHub Release artifact (built by the plugin's pack
 * script and published alongside the .mcpb release) so we can ship
 * new versions without breaking existing share links, marketing
 * collateral, or directory listings.
 *
 * Sister route to /downloads/sendero.mcpb — same redirect pattern,
 * same caching, same public-route allowance.
 */

import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-static';
export const revalidate = 300; // 5 min; the latest-download URL rarely changes

const LATEST_PLUGIN_URL =
  'https://github.com/tcxcx/sendero/releases/latest/download/sendero-claude-code-plugin.zip';

export async function GET(): Promise<Response> {
  return NextResponse.redirect(LATEST_PLUGIN_URL, {
    status: 302,
    headers: {
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
