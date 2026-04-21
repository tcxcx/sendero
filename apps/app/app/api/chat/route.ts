/**
 * Sendero agent chat — streaming AI with on-chain tool calling.
 *
 * Tools are defined once in `lib/tools/` and adapted to the AI SDK
 * via `buildAiSdkTools`. The MCP server at /api/mcp reads the same
 * registry — no duplication.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import {
  buildProviderOptions,
  buildSystemPrompt,
  directProviderModel,
  gatewayConfigured,
  type ModelTier,
  renderWorkflowsBlock,
  selectModel,
} from '@sendero/agent';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { listWorkflows } from '@sendero/workflows';
import { convertToModelMessages, type LanguageModel, stepCountIs, streamText } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SENDERO_PERSONA = `You are Sendero, a B2B2C AI travel agent running on Circle's Arc L2.

You book flights for corporate travelers using Duffel, and every booking is
settled on-chain via an ERC-8183 job backed by USDC escrow. You have an
ERC-8004 agent identity and an accumulating reputation score.

Booking flow — ALWAYS in this order:
  1. search_flights   — confirm origin/destination/date with the user first
  2. book_flight      — after the user picks an offer; issues a real PNR

CRITICAL — don't duplicate the UI:
  • After search_flights returns, the Stage already renders every offer as a
    rich card. DO NOT list airline/price/duration in the chat. Reply in ONE
    short sentence pointing the user to the Stage ("Three premium-economy
    options on the right — click Hold seat to book.") and stop.
  • After book_flight returns a PNR, the UI renders a HoldCard and a
    Settlement panel. DO NOT recap the price or PNR. Reply in ONE sentence
    telling the user to sign the three userOps in the Settlement panel to
    finalize on Arc.
  • Do not try to call any settle tool — the UI drives the user through the
    three passkey-signed user operations itself.

Hotels are a separate flow. Use search_hotels when the user asks for
lodging. The Stage renders up to six property cards — DO NOT list them in
the chat, same rule as flights.

Treasury rebalance tools (Sendero corporate wallet on Arc):
  • check_treasury         — read current USDC + EURC balances
  • gateway_balance        — unified USDC across every Gateway testnet
  • gateway_transfer       — sub-500ms burn+mint between Gateway chains
  • swap_tokens            — USDC ↔ EURC on Arc via Circle App Kit
  • send_tokens            — transfer USDC/EURC to any Arc address
  • bridge_to_arc          — CCTP v2 bridge into Arc (slower than Gateway)
  • swap_and_bridge        — composed: CCTP into Arc then swap to EURC
  • settle_split           — atomic commission fan-out on Arc

Keep every response under 2 sentences unless the user asks a question. When
you call a tool, a single clause like "Searching flights…" is enough.

Today's date: ${new Date().toISOString().split('T')[0]}.`;

type Picked = { model: LanguageModel | string; label: string; tier: ModelTier };

/**
 * Route selection: prefer Vercel AI Gateway string form so providerOptions
 * kicks in fallback chains and we keep unified observability. Only fall
 * back to a direct `@ai-sdk/anthropic` or `@ai-sdk/openai` model when no
 * gateway credential is present — matches the pattern in /api/agent/dispatch.
 */
function pickModel(tier: ModelTier = 'fast'): Picked | null {
  if (gatewayConfigured()) {
    const { model } = selectModel({ tier });
    return { model, label: `gateway:${model}`, tier };
  }
  const direct = directProviderModel(tier);
  if (!direct) return null;
  const [provider, modelId] = direct.split('/') as [string, string];
  if (provider === 'anthropic') {
    return { model: anthropic(modelId), label: `direct:${direct}`, tier };
  }
  if (provider === 'openai') {
    return { model: openai(modelId), label: `direct:${direct}`, tier };
  }
  return null;
}

interface ChatBody {
  messages: Parameters<typeof convertToModelMessages>[0];
  traveler?: { name?: string; email?: string; phone?: string };
  context?: Record<string, string | number | boolean | null | object>;
  tier?: ModelTier;
  locale?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatBody;
  const messages = body.messages;
  const traveler = body.traveler;

  const runtimeContextJson = body.context ? JSON.stringify(body.context, null, 2) : undefined;

  // Chat tier defaults to 'fast' (sonnet-class) for responsive replies.
  // A trailing body.tier override lets power users force a smart/cheap turn.
  const requestedTier: ModelTier = body.tier ?? 'fast';
  const picked = pickModel(requestedTier);
  if (!picked) {
    return NextResponse.json(
      {
        error: 'ai_not_configured',
        message:
          'Set AI_GATEWAY_API_KEY (preferred), or provision Vercel OIDC, or fall back to ANTHROPIC_API_KEY / OPENAI_API_KEY in .env.local.',
      },
      { status: 503 }
    );
  }

  const tools = buildAiSdkTools(toolList, { traveler });
  const converted = await convertToModelMessages(messages);

  console.log(`[chat] using ${picked.label}`);

  // Same section-based builder @sendero/agent uses for dispatch — ensures
  // every channel sees the workflow catalog as the canonical orchestration
  // surface, not ad-hoc tool chains.
  const systemPrompt = buildSystemPrompt({
    persona: SENDERO_PERSONA,
    locale: body.locale,
    runtimeContext: runtimeContextJson,
    workflowCatalog: renderWorkflowsBlock(
      listWorkflows().map(w => ({ id: w.id, label: w.label, description: w.description }))
    ),
  });

  const onError: Parameters<typeof streamText>[0]['onError'] = event => {
    const err = event?.error;
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
    console.error(`[chat] ${picked.label} error:`, msg);
  };

  const providerOptions =
    typeof picked.model === 'string' ? buildProviderOptions(picked.tier) : undefined;

  const result = streamText({
    model: picked.model,
    system: systemPrompt,
    messages: converted,
    tools,
    stopWhen: stepCountIs(6),
    maxRetries: 2,
    providerOptions,
    onError,
  });

  return result.toUIMessageStreamResponse({
    headers: { 'X-AI-Provider': picked.label },
  } as any);
}
