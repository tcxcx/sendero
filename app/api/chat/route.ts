/**
 * Sendero agent chat — streaming AI with on-chain tool calling.
 *
 * 4 tools:
 *   1. search_flights  — Duffel offer request
 *   2. book_flight     — Duffel hold order + pay from Balance (PNR issued)
 *   3. search_hotels   — Duffel Stays
 *   4. check_treasury  — Circle DCW balance lookup
 *
 * On-chain settlement is driven by the user from the Settlement panel
 * (ERC-8183 flow across 3 user-signed userOps + 2 provider-side server txs).
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, stepCountIs, tool } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createHoldOrder,
  payFromBalance,
  searchFlights,
  searchHotels,
} from '@/lib/duffel';
import { getTreasuryBalances } from '@/lib/circle';
import type { BridgeParams, SendParams, SwapParams } from '@circle-fin/app-kit';
import {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  summarizeBridge,
  summarizeSend,
  summarizeSwap,
} from '@/lib/appkit';
import { BRIDGE_CHAINS } from '@/lib/bridge-chains';

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
  • swap_tokens            — USDC ↔ EURC on Arc via Circle App Kit
  • send_tokens            — transfer USDC/EURC to any Arc address
  • bridge_to_arc          — pull USDC into Arc from Ethereum_Sepolia,
                              Base_Sepolia, Polygon_Amoy, Avalanche_Fuji,
                              Arbitrum_Sepolia, or Optimism_Sepolia
  • swap_and_bridge        — composed workflow: CCTP-bridge USDC into Arc
                              AND swap to EURC in one tool call

Rebalance workflow (chain these when treasury liquidity is short):
  1. check_treasury — see what we have
  2. If USD-side is short but USDC total is fine →  swap_tokens
  3. If the Arc side itself is short →  bridge_to_arc from a funded chain
  4. If both are short AND the booking needs EURC →  swap_and_bridge
  5. (Optional) send_tokens to top up the user wallet before they sign the
     on-chain settlement
Use these BEFORE attempting a book_flight whose totalAmount exceeds the
Arc USDC treasury balance. Explain what you're doing in one short sentence
each step.

Keep every response under 2 sentences unless the user asks a question. When
you call a tool, a single clause like "Searching flights…" is enough.

Today's date: ${new Date().toISOString().split('T')[0]}.`;

/**
 * Pick an AI model based on available creds.
 *   1. AI_PROVIDER env var explicitly set to "openai" or "anthropic"
 *   2. Anthropic if ANTHROPIC_API_KEY is set
 *   3. OpenAI if OPENAI_API_KEY is set
 */
function pickModel(): { model: any; label: string } | null {
  const forced = process.env.AI_PROVIDER?.toLowerCase();
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  if (forced === 'openai' && hasOpenAI) {
    return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  }
  if (forced === 'anthropic' && hasAnthropic) {
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  }
  if (hasAnthropic) {
    return {
      model: anthropic('claude-3-5-sonnet-latest'),
      label: 'anthropic:claude-3-5-sonnet',
    };
  }
  if (hasOpenAI) {
    return { model: openai('gpt-4o'), label: 'openai:gpt-4o' };
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages = body.messages;
  const traveler = body.traveler as
    | { name?: string; email?: string; phone?: string }
    | undefined;
  const travelerName = traveler?.name || 'Traveler';
  const travelerEmail = traveler?.email || 'traveler@sendero.demo';
  const travelerPhone = traveler?.phone || '';

  // Live snapshot of UI state sent by the client. Used to augment the system
  // prompt so the agent can see recent errors, current booking state, etc.
  const runtimeContextJson = body.context
    ? JSON.stringify(body.context, null, 2)
    : null;

  const picked = pickModel();
  if (!picked) {
    return NextResponse.json(
      {
        error: 'ai_not_configured',
        message:
          'Set ANTHROPIC_API_KEY or OPENAI_API_KEY in .env.local.',
      },
      { status: 503 },
    );
  }

  const tools = {
    search_flights: tool({
      description:
        'Search flights between two airports. Requires IATA codes and a departure date (YYYY-MM-DD).',
      inputSchema: z.object({
        origin: z.string().length(3),
        destination: z.string().length(3),
        departureDate: z.string(),
        returnDate: z.string().optional(),
        passengers: z.number().int().min(1).max(9).default(1),
        cabinClass: z
          .enum(['economy', 'premium_economy', 'business', 'first'])
          .default('economy'),
      }),
      execute: async (input: any) => {
        const offers = await searchFlights(input);
        return { offers: offers.slice(0, 3) };
      },
    }),

    book_flight: tool({
      description:
        'Book a flight via Duffel for the signed-in user: creates a hold order and pays from the pre-funded Duffel Balance. Returns the PNR (booking reference) and order ID. After this succeeds, the user will settle on-chain themselves from the Settlement panel. Passenger identity is supplied by the server from the signed-in session — do not ask the user for name or email.',
      inputSchema: z.object({
        offerId: z.string(),
      }),
      execute: async ({ offerId }) => {
        const hold = await createHoldOrder({
          offerId,
          passengerName: travelerName,
          passengerEmail: travelerEmail,
          passengerPhone: travelerPhone || undefined,
          idempotencyKey: `sendero-${offerId}-${Date.now()}`,
        });
        const payment = await payFromBalance(hold.orderId);
        return {
          orderId: hold.orderId,
          pnr: hold.bookingReference,
          totalAmount: hold.totalAmount,
          totalCurrency: hold.totalCurrency,
          paymentStatus: payment.status,
        };
      },
    }),

    search_hotels: tool({
      description:
        'Search hotels in a city for given dates. Returns up to 6 accommodations with real photos, star rating, review score, cheapest rate, and cancellation policy. Use when the user asks for lodging.',
      inputSchema: z.object({
        location: z
          .string()
          .describe(
            'City, neighborhood, or airport code. Free-form text works.',
          ),
        checkInDate: z.string().describe('YYYY-MM-DD'),
        checkOutDate: z.string().describe('YYYY-MM-DD'),
        guests: z.number().int().min(1).max(9).default(1),
        rooms: z.number().int().min(1).max(9).default(1),
      }),
      execute: async (input: any) => {
        const hotels = await searchHotels(input);
        return { hotels: hotels.slice(0, 6) };
      },
    }),

    check_treasury: tool({
      description:
        'Check Circle treasury USDC/EURC balance on Arc. Use when the user asks about funds.',
      inputSchema: z.object({}),
      execute: async () => {
        const balances = await getTreasuryBalances();
        return { balances };
      },
    }),

    swap_tokens: tool({
      description:
        'Rebalance the Sendero corporate treasury on Arc Testnet by swapping USDC ↔ EURC via Circle App Kit. Use when the treasury lacks the right token to pay for a booking, or the user explicitly asks to swap. Returns tx hashes.',
      inputSchema: z.object({
        fromToken: z.enum(['USDC', 'EURC']),
        toToken: z.enum(['USDC', 'EURC']),
        amount: z.string().describe('Decimal amount, e.g. "5.00"'),
      }),
      execute: async ({ fromToken, toToken, amount }) => {
        if (fromToken === toToken) {
          return { error: 'fromToken and toToken must differ' };
        }
        const kit = getAppKit();
        const adapter = getTreasuryAdapter();
        const params: SwapParams = {
          from: {
            adapter,
            chain: 'Arc_Testnet',
          },
          tokenIn: fromToken,
          tokenOut: toToken,
          amountIn: amount,
          config: { kitKey: getKitKey() },
        };
        const result = await kit.swap(params);
        const summary = summarizeSwap(result);
        return {
          state: summary.state,
          fromToken,
          toToken,
          amountIn: result.amountIn,
          amountOut: result.amountOut,
          txHash: summary.txHash,
          explorerUrl: summary.explorerUrl,
        };
      },
    }),

    send_tokens: tool({
      description:
        'Transfer USDC or EURC from the Sendero corporate treasury to any Arc Testnet address. Use when rebalancing or topping up the user wallet.',
      inputSchema: z.object({
        to: z
          .string()
          .regex(/^0x[a-fA-F0-9]{40}$/, 'must be a 0x-prefixed address'),
        amount: z.string(),
        token: z.enum(['USDC', 'EURC']).default('USDC'),
      }),
      execute: async ({ to, amount, token }) => {
        const kit = getAppKit();
        const adapter = getTreasuryAdapter();
        const params: SendParams = {
          from: {
            adapter,
            chain: 'Arc_Testnet',
          },
          to,
          amount,
          token,
        };
        const result = await kit.send(params);
        const summary = summarizeSend(result);
        return {
          state: summary.state,
          token,
          amount,
          to,
          txHash: summary.txHash,
          explorerUrl: summary.explorerUrl,
        };
      },
    }),

    bridge_to_arc: tool({
      description:
        'Bridge USDC from any App Kit–supported chain INTO Arc Testnet via Circle CCTP. Use when Arc treasury liquidity is low. Supports EVM chains (Ethereum, Base, Polygon, Avalanche, Arbitrum, Optimism, Unichain, Linea, etc.) plus Solana — mainnet and testnet variants (see BRIDGE_CHAINS for the full list).',
      inputSchema: z.object({
        fromChain: z.enum(BRIDGE_CHAINS),
        amount: z.string(),
      }),
      execute: async ({ fromChain, amount }) => {
        const kit = getAppKit();
        const adapter = getTreasuryAdapter();
        const params: BridgeParams = {
          from: {
            adapter,
            chain: fromChain,
          },
          to: {
            adapter,
            chain: 'Arc_Testnet',
          },
          amount,
        };
        const result = await kit.bridge(params);
        const summary = summarizeBridge(result);
        return {
          state: summary.state,
          fromChain,
          toChain: 'Arc_Testnet',
          amount,
          txHash: summary.txHash,
          explorerUrl: summary.explorerUrl,
          stepCount: summary.steps.length,
        };
      },
    }),

    swap_and_bridge: tool({
      description:
        'Composed workflow: CCTP-bridge USDC from a source chain INTO Arc Testnet, then swap to EURC on Arc. Use when a booking needs EURC but treasury only has USDC on another chain. Returns both step receipts.',
      inputSchema: z.object({
        fromChain: z.enum(BRIDGE_CHAINS),
        amount: z.string().describe('USDC amount to bridge and swap, e.g. "5.00"'),
        targetToken: z.enum(['USDC', 'EURC']).default('EURC'),
      }),
      execute: async ({ fromChain, amount, targetToken }) => {
        const kit = getAppKit();
        const adapter = getTreasuryAdapter();

        const bridgeParams: BridgeParams = {
          from: {
            adapter,
            chain: fromChain,
          },
          to: {
            adapter,
            chain: 'Arc_Testnet',
          },
          amount,
        };
        const bridgeResult = await kit.bridge(bridgeParams);
        const bridgeSummary = summarizeBridge(bridgeResult);

        if (targetToken === 'USDC') {
          return {
            state: bridgeSummary.state,
            fromChain,
            toChain: 'Arc_Testnet',
            amount,
            targetToken,
            bridge: bridgeSummary,
            swap: null,
            txHash: bridgeSummary.txHash,
            explorerUrl: bridgeSummary.explorerUrl,
          };
        }

        const swapParams: SwapParams = {
          from: {
            adapter,
            chain: 'Arc_Testnet',
          },
          tokenIn: 'USDC',
          tokenOut: targetToken,
          amountIn: amount,
          config: { kitKey: getKitKey() },
        };
        const swapResult = await kit.swap(swapParams);
        const swapSummary = summarizeSwap(swapResult);

        return {
          state:
            bridgeSummary.state === 'success' && swapSummary.state === 'success'
              ? 'success'
              : `bridge=${bridgeSummary.state}|swap=${swapSummary.state}`,
          fromChain,
          toChain: 'Arc_Testnet',
          amount,
          targetToken,
          bridge: bridgeSummary,
          swap: swapSummary,
          txHash: swapSummary.txHash || bridgeSummary.txHash,
          explorerUrl: swapSummary.explorerUrl || bridgeSummary.explorerUrl,
          amountOut: swapResult.amountOut,
        };
      },
    }),
  };

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
