/**
 * Sendero agent chat — streaming AI with on-chain tool calling.
 *
 * Tools are defined once in `lib/tools/` and adapted to the AI SDK
 * via `buildAiSdkTools`. The MCP server at /api/mcp reads the same
 * registry — no duplication.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, stepCountIs } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';

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

function pickModel(): { model: any; label: string } | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  if (forced === 'openai' && hasOpenAI)
    return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  if (forced === 'anthropic' && hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  if (hasAnthropic)
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  if (hasOpenAI) return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages = body.messages;
  const traveler = body.traveler as
    | { name?: string; email?: string; phone?: string }
    | undefined;

  const runtimeContextJson = body.context
    ? JSON.stringify(body.context, null, 2)
    : null;

  const picked = pickModel();
  if (!picked) {
    return NextResponse.json(
      {
        error: 'ai_not_configured',
        message: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.',
      },
      { status: 503 },
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

  const result = streamText({
    model: picked.model,
    system: systemPrompt,
    messages: converted,
    tools,
    stopWhen: stepCountIs(6),
    maxRetries: 2,
    onError,
  });

  return result.toUIMessageStreamResponse({
    headers: { 'X-AI-Provider': picked.label },
  } as any);
}
