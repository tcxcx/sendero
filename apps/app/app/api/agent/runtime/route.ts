import { NextResponse } from 'next/server';

import { directProviderModel, gatewayConfigured, MODEL_TIERS, selectModel } from '@sendero/agent';

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
  'check_policy',
  'quote_fx',
  'rate_agent',
  'prefund_trip',
  'guest_claim_link',
  'reserve_booking',
  'commit_booking',
  'log_agent_action',
] as const;

type ActiveModel = {
  provider: string;
  model: string;
  tier: 'smart' | 'fast' | 'cheap';
  routing: 'gateway' | 'direct';
};

/**
 * Mirrors /api/chat + /api/agent/dispatch selection logic so the workflow
 * panel shows the same model that would actually run. Prefers the Vercel
 * AI Gateway when credentials are present, else falls back to whichever
 * direct provider key exists.
 */
function activeModel(): ActiveModel | null {
  // 'fast' is the chat default — what the user sees on the homepage.
  const tier: 'smart' | 'fast' | 'cheap' = 'fast';

  if (gatewayConfigured()) {
    const { model } = selectModel({ tier });
    const [provider, id] = model.split('/');
    return { provider, model: id, tier, routing: 'gateway' };
  }

  const direct = directProviderModel(tier);
  if (!direct) return null;
  const [provider, id] = direct.split('/');
  return { provider, model: id, tier, routing: 'direct' };
}

export async function GET() {
  const picked = activeModel();
  return NextResponse.json({
    provider: picked?.provider ?? null,
    model: picked?.model ?? null,
    tier: picked?.tier ?? null,
    routing: picked?.routing ?? null,
    tiers: Object.fromEntries(
      Object.entries(MODEL_TIERS).map(([k, v]) => [
        k,
        { primary: v.primary, fallbacks: v.fallbacks },
      ])
    ),
    tools: TOOL_NAMES,
    toolCount: TOOL_NAMES.length,
  });
}
