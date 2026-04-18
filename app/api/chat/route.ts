/**
 * Pasillo agent chat — streaming AI with on-chain tool calling.
 *
 * 4 tools, in order of use during a booking:
 *   1. search_flights  — Duffel offer request
 *   2. book_flight     — Duffel hold order + pay from Balance (PNR issued)
 *   3. settle_on_arc   — 7-tx ERC-8183 + ERC-8004 flow on Arc Testnet
 *   4. check_treasury  — Circle DCW balance lookup
 *
 * maxDuration = 300 required for settle_on_arc (7 sequential Circle DCW txs).
 * Requires Vercel Pro for deployed URL; unlimited in local dev.
 *
 * Falls back to canned responses when credentials are missing.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, stepCountIs, tool } from 'ai';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import {
  createHoldOrder,
  payFromBalance,
  searchFlights,
  searchHotels,
} from '@/lib/duffel';
import { getTreasuryBalances } from '@/lib/circle';
import {
  AGENTIC_COMMERCE_ADDRESS,
  approveUsdc,
  completeJob,
  createJob,
  fundJob,
  hashDeliverable,
  setBudget,
  submitDeliverable,
  toUsdcUnits,
} from '@/lib/arc-jobs';
import { giveFeedback, invalidateReputationCache } from '@/lib/arc-identity';

export const runtime = 'nodejs';
export const maxDuration = 300;

const SYSTEM_PROMPT = `You are Pasillo, a B2B2C AI travel agent running on Circle's Arc L2.

You book flights for corporate travelers using Duffel, and you settle every
booking on-chain via ERC-8183 jobs backed by USDC escrow. You have an
ERC-8004 agent identity and an accumulating reputation score.

Booking flow — ALWAYS in this order:
  1. search_flights   — confirm origin/destination/date with the user first
  2. book_flight      — after the user picks an offer; issues a real PNR
  3. settle_on_arc    — IMMEDIATELY after book_flight returns a PNR
                        (the settlement is an on-chain attestation of the
                         completed booking; 7 txs land on Arc Testnet)

Hotels are a separate flow. Use search_hotels when the user asks for
lodging (stay, hotel, place to sleep). Show up to 3 properties with name,
price, stars, and cancellation policy. Hotel booking via chain-escrow is
roadmap, so for now just surface results.

The user does not need to confirm settle_on_arc separately — it chains
automatically after a successful book_flight.

Keep responses tight. When you call a tool, briefly tell the user what you're
doing. After all tools complete, show them the 7 tx hashes with a link to
Arcscan.

Today's date: ${new Date().toISOString().split('T')[0]}.`;

/**
 * Pick an AI model based on available creds.
 *
 * Precedence:
 *   1. AI_PROVIDER env var explicitly set to "openai" or "anthropic"
 *   2. Anthropic if ANTHROPIC_API_KEY is set
 *   3. OpenAI if OPENAI_API_KEY is set
 *   4. null → fallback mode
 *
 * Returns the model instance + a label for logging.
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

/** OpenAI fallback model, used when Anthropic errors mid-stream. */
function openaiFallback(): { model: any; label: string } | null {
  if (!process.env.OPENAI_API_KEY) return null;
  return { model: openai('gpt-4o'), label: 'openai:gpt-4o (fallback)' };
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const messages = body.messages;

  const picked = pickModel();
  if (!picked) {
    return streamFallback(messages);
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
        if (!env.duffelApiToken()) {
          return { offers: demoFlightOffers(input), demo: true };
        }
        const offers = await searchFlights(input);
        return { offers: offers.slice(0, 3) };
      },
    }),

    book_flight: tool({
      description:
        'Book a flight via Duffel: creates a hold order and pays from the pre-funded Duffel Balance. Returns the PNR (booking reference) and order ID. Call settle_on_arc immediately after this succeeds.',
      inputSchema: z.object({
        offerId: z.string(),
        passengerName: z.string(),
        passengerEmail: z.string().email(),
      }),
      execute: async ({ offerId, passengerName, passengerEmail }) => {
        if (!env.duffelApiToken()) {
          // Deterministic demo values so settle_on_arc has valid inputs
          return {
            orderId: `demo_ord_${Date.now()}`,
            pnr: 'RG7F2K',
            totalAmount: '1842.00',
            totalCurrency: 'USD',
            demo: true,
          };
        }
        const hold = await createHoldOrder({
          offerId,
          passengerName,
          passengerEmail,
          idempotencyKey: `pasillo-${offerId}-${Date.now()}`,
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

    settle_on_arc: tool({
      description:
        'Settle a completed Duffel booking on-chain via ERC-8183 job escrow + ERC-8004 reputation. Executes 7 transactions on Arc Testnet: createJob, setBudget, approve USDC, fund, submitDeliverable, complete, giveFeedback. Takes ~45-60 seconds.',
      inputSchema: z.object({
        orderId: z.string(),
        pnr: z.string(),
        totalAmountUsdc: z.string().describe('USDC amount as decimal string, e.g. "1842.00"'),
      }),
      execute: async ({ orderId, pnr, totalAmountUsdc }) => {
        const providerWalletId = process.env.PASILLO_PROVIDER_WALLET_ID;
        const providerAddress = process.env.PASILLO_PROVIDER_ADDRESS;
        const clientWalletId = process.env.DEMO_CLIENT_WALLET_ID;
        const clientAddress = process.env.DEMO_CLIENT_ADDRESS;
        const agentIdStr = process.env.PASILLO_AGENT_ID;

        if (!providerWalletId || !providerAddress || !clientWalletId || !clientAddress || !agentIdStr) {
          return {
            demo: true,
            message: 'Bootstrap not run — returning demo settlement',
            jobId: '42',
            txHashes: Array.from({ length: 7 }).map(
              (_, i) =>
                `0x${Date.now().toString(16).padStart(8, '0')}${i.toString().padStart(56, '0')}`,
            ),
            pnr,
            orderId,
            totalAmountUsdc,
          };
        }

        const amountUnits = toUsdcUnits(totalAmountUsdc);
        const expiredAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const agentId = BigInt(agentIdStr);

        // TX #1: createJob (client signs)
        const { jobId, txHash: createTx } = await createJob({
          clientWalletAddress: clientAddress,
          providerAddress: providerAddress as any,
          evaluatorAddress: clientAddress as any, // client IS evaluator per plan
          expiredAt,
          description: `PNR ${pnr}`,
        });

        // TX #2: setBudget (provider signs)
        const budgetTx = await setBudget({
          providerWalletAddress: providerAddress,
          jobId,
          amount: amountUnits,
        });

        // TX #3: approve USDC (client signs)
        const approveTx = await approveUsdc({
          clientWalletAddress: clientAddress,
          amount: amountUnits,
        });

        // TX #4: fund — escrow locked (client signs)
        const fundTx = await fundJob({
          clientWalletAddress: clientAddress,
          jobId,
        });

        // TX #5: submitDeliverable with PNR hash (provider signs)
        const deliverableHash = hashDeliverable(pnr);
        const submitTx = await submitDeliverable({
          providerWalletAddress: providerAddress,
          jobId,
          deliverableHash,
        });

        // TX #6: complete — escrow released (client = evaluator signs)
        const reasonHash = hashDeliverable('ticket_issued');
        const completeTx = await completeJob({
          evaluatorWalletAddress: clientAddress,
          jobId,
          reasonHash,
        });

        // TX #7: giveFeedback — reputation +1 (client signs as validator)
        const feedbackTx = await giveFeedback({
          validatorWalletAddress: clientAddress,
          agentId,
          score: 95,
          tag: 'ticket_delivered',
        });
        invalidateReputationCache(agentId);

        const txHashes = [
          createTx,
          budgetTx.txHash,
          approveTx.txHash,
          fundTx.txHash,
          submitTx.txHash,
          completeTx.txHash,
          feedbackTx.txHash,
        ];

        return {
          jobId: jobId.toString(),
          pnr,
          deliverableHash,
          txHashes,
          explorerBase: env.arcExplorerUrl(),
          demo: false,
        };
      },
    }),

    search_hotels: tool({
      description:
        'Search hotels in a city for given dates. Returns up to 6 accommodations with real photos, star rating, review score, cheapest rate, and cancellation policy. Use when the user asks for lodging.',
      inputSchema: z.object({
        location: z
          .string()
          .describe('City, neighborhood, or airport code. Free-form text works.'),
        checkInDate: z.string().describe('YYYY-MM-DD'),
        checkOutDate: z.string().describe('YYYY-MM-DD'),
        guests: z.number().int().min(1).max(9).default(1),
        rooms: z.number().int().min(1).max(9).default(1),
      }),
      execute: async (input: any) => {
        if (!env.duffelApiToken()) {
          return { hotels: demoHotels(input), demo: true };
        }
        const hotels = await searchHotels(input);
        return { hotels: hotels.slice(0, 6) };
      },
    }),

    check_treasury: tool({
      description:
        'Check Circle treasury USDC/EURC balance on Arc. Use when the user asks about funds.',
      inputSchema: z.object({}),
      execute: async () => {
        if (!env.circleApiKey() || !env.circleTreasuryWalletId()) {
          return {
            balances: [
              { symbol: 'USDC', amount: '412904.00', chain: 'ARC' },
              { symbol: 'EURC', amount: '88162.00', chain: 'ARC' },
            ],
            demo: true,
          };
        }
        const balances = await getTreasuryBalances();
        return { balances };
      },
    }),
  };

  const converted = await convertToModelMessages(messages);
  console.log(`[chat] using ${picked.label}`);

  // onError: if Anthropic 402s (credit empty) or similar, fall back to OpenAI
  // on the NEXT request. We can't hot-swap mid-stream, but we can surface the
  // failure cleanly.
  const onError = ({ error }: { error: unknown }) => {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[chat] ${picked.label} error:`, msg);
    if (picked.label.startsWith('anthropic') && openaiFallback()) {
      console.error(
        `[chat] hint: set AI_PROVIDER=openai in .env.local to use OpenAI instead.`,
      );
    }
  };

  const result = streamText({
    model: picked.model,
    system: SYSTEM_PROMPT,
    messages: converted,
    tools,
    // CRITICAL: lets the agent chain book_flight → settle_on_arc automatically.
    // Without this, the agent stops after the first tool call.
    stopWhen: stepCountIs(6),
    maxRetries: 2,
    onError,
  });

  return result.toUIMessageStreamResponse({
    headers: { 'X-AI-Provider': picked.label },
  } as any);
}

function demoHotels(input: {
  location: string;
  checkInDate: string;
  checkOutDate: string;
}) {
  const nights = Math.max(
    1,
    Math.round(
      (new Date(input.checkOutDate).getTime() -
        new Date(input.checkInDate).getTime()) /
        (1000 * 60 * 60 * 24),
    ),
  );
  return [
    {
      id: 'demo_hotel_1',
      name: 'The Hoxton, Shoreditch',
      city: input.location,
      country: 'GB',
      stars: 4,
      reviewScore: 8.6,
      photos: [],
      price: (214 * nights).toFixed(2),
      currency: 'GBP',
      cancellation: 'free',
      distanceMeters: 1200,
      amenities: ['wifi', 'breakfast', 'gym'],
    },
    {
      id: 'demo_hotel_2',
      name: 'citizenM Tower of London',
      city: input.location,
      country: 'GB',
      stars: 4,
      reviewScore: 8.9,
      photos: [],
      price: (199 * nights).toFixed(2),
      currency: 'GBP',
      cancellation: 'partial',
      distanceMeters: 800,
      amenities: ['wifi', 'self_checkin'],
    },
  ];
}

function demoFlightOffers(input: {
  origin: string;
  destination: string;
  departureDate: string;
  cabinClass?: string;
}) {
  const depTs = new Date(input.departureDate);
  return [
    { airline: 'British Airways', price: '1842.00', currency: 'USD', stops: 0 },
    { airline: 'United', price: '1968.00', currency: 'USD', stops: 0 },
    { airline: 'Delta', price: '1724.00', currency: 'USD', stops: 1 },
  ].map((b, i) => ({
    id: `demo_off_${i}`,
    ...b,
    departure: new Date(depTs.getTime() + i * 3_600_000).toISOString(),
    duration: 'PT10H25M',
    cabinClass: input.cabinClass ?? 'economy',
    expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
  }));
}

async function streamFallback(messages: any[]) {
  const last = messages?.[messages.length - 1];
  const userText =
    typeof last?.content === 'string'
      ? last.content
      : last?.parts?.map((p: any) => p.text).filter(Boolean).join(' ') ||
        '(no message)';

  const reply =
    'Demo mode — ANTHROPIC_API_KEY not set. In live mode I would search Duffel for "' +
    userText.slice(0, 60) +
    '", book the best option, then settle the booking on Arc Testnet with 7 on-chain transactions (ERC-8183 escrow + ERC-8004 reputation). Add keys to .env.local to go live.';

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const chunk of reply.match(/.{1,20}/g) || []) {
        controller.enqueue(encoder.encode(`0:${JSON.stringify(chunk)}\n`));
        await new Promise((r) => setTimeout(r, 40));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Demo-Mode': 'true',
    },
  });
}
