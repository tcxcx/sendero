import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TOOL_NAMES = [
  'search_flights',
  'book_flight',
  'search_hotels',
  'check_treasury',
  'swap_tokens',
  'send_tokens',
  'bridge_to_arc',
  'swap_and_bridge',
  'gateway_balance',
  'gateway_transfer',
  'settle_split',
] as const;

/**
 * Mirrors app/api/chat/route.ts `pickModel()` so the workflow panel can
 * render the active provider/model without a round-trip through /api/chat.
 */
function activeModel(): { provider: string; model: string } | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (forced === 'openai' && hasOpenAI) {
    return { provider: 'openai', model: 'gpt-4o' };
  }
  if (forced === 'anthropic' && hasAnthropic) {
    return { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' };
  }
  if (hasAnthropic) {
    return { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' };
  }
  if (hasOpenAI) {
    return { provider: 'openai', model: 'gpt-4o' };
  }
  return null;
}

export async function GET() {
  const picked = activeModel();
  return NextResponse.json({
    provider: picked?.provider ?? null,
    model: picked?.model ?? null,
    tools: TOOL_NAMES,
    toolCount: TOOL_NAMES.length,
  });
}
