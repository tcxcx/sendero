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
  directProviderModel,
  gatewayConfigured,
  type ModelTier,
  selectModel,
} from '@sendero/agent';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { convertToModelMessages, type LanguageModel, stepCountIs, streamText } from 'ai';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Sendero, a B2B2C AI travel agent running on Circle's Arc L2.

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

Rebalance workflow (chain these when treasury liquidity is short):
  1. check_treasury / gateway_balance — see what we have
  2. If Arc is short but other chains have USDC →  gateway_transfer
  3. If USD-side is short but USDC total is fine →  swap_tokens
  4. If both are short AND the booking needs EURC →  swap_and_bridge
  5. (Optional) send_tokens to top up the user wallet before they sign the
     on-chain settlement
Use these BEFORE attempting a book_flight whose totalAmount exceeds the
Arc USDC treasury balance. Explain what you're doing in one short sentence
each step.

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

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages = body.messages;
  const traveler = body.traveler as { name?: string; email?: string; phone?: string } | undefined;

  const runtimeContextJson = body.context ? JSON.stringify(body.context, null, 2) : null;

  // Chat tier defaults to 'fast' (sonnet-class) for responsive replies.
  // A trailing body.tier override lets power users force a smart/cheap turn.
  const requestedTier = (body.tier as ModelTier | undefined) ?? 'fast';
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

  const systemPrompt = runtimeContextJson
    ? `${SYSTEM_PROMPT}

— Live runtime context (auto-injected every turn; reflect on it before
  responding; if it contains a recent error, address it directly and
  offer a concrete next step) —
\`\`\`json
${runtimeContextJson}
\`\`\``
    : SYSTEM_PROMPT;

  const onError = ({ error }: { error: unknown }) => {
    const msg = error instanceof Error ? error.message : String(error);
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
