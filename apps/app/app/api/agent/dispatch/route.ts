/**
 * Per-trip agent dispatch endpoint.
 *
 * The webhook layer (WhatsApp + Slack) calls POST /api/agent/dispatch
 * after it has resolved the traveler's ChannelIdentity → tenant + user.
 * This endpoint is the single fan-in:
 *
 *   1. Resolve the active Trip (or spawn a new one if the traveler is
 *      starting fresh).
 *   2. Build agent context via @sendero/intelligence (locale slice +
 *      learned preferences + recalled memories + trip state).
 *   3. Run the LLM turn with the @sendero/tools tool catalog.
 *   4. Price + record the meter event via @sendero/billing.
 *   5. Return the reply text + any side-effects (booking id, tx hash).
 *
 * The WA / Slack webhook routes translate this reply back into the
 * channel-appropriate shape (WA free-form text, Slack message).
 */

import { type NextRequest, NextResponse } from 'next/server';
import { generateText, stepCountIs } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { buildAgentContext } from '@sendero/intelligence';
import { getLocaleSlice } from '@sendero/locale';
import { preflight, recordMetered, type MeterStore } from '@sendero/billing/meter';
import type { CapStore } from '@sendero/billing/caps';
import { prisma } from '@sendero/database';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  channel: z.enum(['whatsapp', 'slack', 'web', 'mcp']),
  tripId: z.string().optional(),
  text: z.string().min(1).max(4000),
  locale: z.string().optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const start = Date.now();
  const distinctId = hashDistinctId(body.userId);

  capture({
    event: 'agent_message_received',
    distinctId,
    properties: {
      tenantId: body.tenantId,
      channel: body.channel,
      locale: body.locale,
      tripId: body.tripId ?? null,
      messageType: 'text',
    },
  });

  const segment = await resolveSegment(body.tenantId);
  const pre = await preflight(makeCapStore(), {
    tenantId: body.tenantId,
    action: 'chat_reply',
    segment,
  });
  if (pre.blocked) {
    return NextResponse.json(
      {
        error: 'cap_exceeded',
        message: 'Your tenant has hit its spend cap for this period.',
        periods: pre.cap.periods,
      },
      { status: 402 }
    );
  }

  // Build the context the LLM sees — locale + preferences + memory + trip.
  const localeSlice = getLocaleSlice(body.locale ?? 'en-US');
  const trip = body.tripId
    ? await prisma.trip.findFirst({
        where: { id: body.tripId, tenantId: body.tenantId },
        select: {
          id: true,
          status: true,
          intent: true,
          bookings: { select: { pnr: true, externalId: true }, take: 1 },
        },
      })
    : null;

  const tripSnapshot = trip
    ? {
        tripId: trip.id,
        route: tripIntentToRoute(trip.intent),
        departAt: tripIntentToDepartAt(trip.intent),
        status:
          trip.status === 'booked' || trip.status === 'in_progress'
            ? ('booked' as const)
            : ('planning' as const),
        pnr: trip.bookings[0]?.pnr ?? null,
        bookingRef: trip.bookings[0]?.externalId ?? null,
      }
    : null;

  const systemPrompt = [
    buildAgentContext({
      localeSlice,
      trip: tripSnapshot,
    }),
    SENDERO_PERSONA,
  ].join('\n\n');

  const tools = buildAiSdkTools(toolList, {
    traveler: { userId: body.userId, tenantId: body.tenantId },
  });

  const result = await generateText({
    model: anthropic('claude-opus-4-7'),
    system: systemPrompt,
    prompt: body.text,
    tools,
    stopWhen: stepCountIs(4),
    maxRetries: 2,
  });

  const latencyMs = Date.now() - start;

  // Record meter event + capture analytics.
  await recordMetered({
    meter: makeMeterStore(),
    event: {
      tenantId: body.tenantId,
      userId: body.userId,
      toolName: 'chat_reply',
      priceMicroUsdc: pre.priceMicroUsdc,
      status: 'paid',
      note: `channel=${body.channel}`,
      metadata: { channel: body.channel, locale: body.locale },
    },
  });

  capture({
    event: 'agent_reply_sent',
    distinctId,
    properties: {
      tenantId: body.tenantId,
      channel: body.channel,
      locale: body.locale,
      tripId: body.tripId ?? null,
      latencyMs,
    },
  });

  await flush();

  return NextResponse.json({
    text: result.text,
    toolCalls: result.toolCalls?.length ?? 0,
    latencyMs,
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────

const SENDERO_PERSONA = `
You are Sendero, a concise AI travel agent. Prefer concrete next actions
over long explanations. When you call a tool, say one sentence about why.
Respond in the traveler's locale. Never ask for seed phrases or passwords.
`;

function tripIntentToRoute(intent: unknown): string {
  if (!intent || typeof intent !== 'object') return '—';
  const o = intent as Record<string, unknown>;
  const origin = typeof o.origin === 'string' ? o.origin : '';
  const destination = typeof o.destination === 'string' ? o.destination : '';
  return origin && destination ? `${origin} → ${destination}` : '—';
}

function tripIntentToDepartAt(intent: unknown): string {
  if (!intent || typeof intent !== 'object') return '—';
  const o = intent as Record<string, unknown>;
  return typeof o.departAt === 'string' ? o.departAt : '—';
}

async function resolveSegment(
  tenantId: string
): Promise<'consumer' | 'agency' | 'corporate' | 'ai_agent'> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingTier: true },
  });
  if (!tenant) return 'consumer';
  switch (tenant.billingTier) {
    case 'enterprise':
      return 'corporate';
    case 'business':
      return 'corporate';
    case 'pro':
      return 'agency';
    default:
      return 'consumer';
  }
}

function makeCapStore(): CapStore {
  return {
    listForTenant: async tenantId => {
      const caps = await prisma.tenantSpendCap.findMany({
        where: { tenantId },
        select: {
          tenantId: true,
          period: true,
          amountMicroUsdc: true,
          hardCap: true,
          alertWebhookUrl: true,
        },
      });
      return caps;
    },
    spentInWindow: async ({ tenantId, windowStartedAt }) => {
      const agg = await prisma.meterEvent.aggregate({
        where: { tenantId, status: 'paid', at: { gte: windowStartedAt } },
        _sum: { priceMicroUsdc: true },
      });
      return agg._sum.priceMicroUsdc ?? 0n;
    },
  };
}

function makeMeterStore(): MeterStore {
  return {
    create: async input => {
      const row = await prisma.meterEvent.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          payerAddress: input.payerAddress ?? null,
          toolName: input.toolName,
          priceMicroUsdc: input.priceMicroUsdc,
          status: input.status,
          settlementRef: input.settlementRef ?? null,
          note: input.note ?? null,
          metadata: (input.metadata as object | undefined) ?? undefined,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}
