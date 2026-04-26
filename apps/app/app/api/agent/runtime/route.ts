import { NextResponse } from 'next/server';

import { directProviderModel, gatewayConfigured, MODEL_TIERS, selectModel } from '@sendero/agent';
import { toolList } from '@sendero/tools';
import { listWorkflowsTool } from '@sendero/workflows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Derived from the actual chat tool registry — never hand-maintain this
// list. The chat route at /api/chat ships every tool here PLUS the two
// orchestration tools `list_workflows` + `run_workflow`. We include the
// list-side workflow tool name in the count so the UI matches the real
// surface (49 leaves + 2 orchestration = 51 today).
const CHAT_TOOL_NAMES = [
  ...toolList.map(t => t.name),
  listWorkflowsTool.name,
  'run_workflow',
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
    tools: CHAT_TOOL_NAMES,
    toolCount: CHAT_TOOL_NAMES.length,
  });
}
