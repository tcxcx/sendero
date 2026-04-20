/**
 * POST /api/agent/dispatch
 *
 * Single fan-in for every channel (WhatsApp, Slack, Web, MCP). The
 * channel-specific webhook routes translate their native payload into
 * an AgentInput and call this endpoint. runAgentTurn() from
 * @sendero/agent does the rest — cap preflight, session lookup,
 * context build, LLM turn, idempotent meter write, session update.
 *
 * This route is intentionally thin: parse → build stores → runTurn →
 * capture analytics → return AgentOutput. No channel-specific logic.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import {
  runAgentTurn,
  type AgentInput,
  type Channel,
  type ConversationState,
  type SessionStore,
} from '@sendero/agent';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import type { BillingSegment } from '@sendero/billing/pricing';
import type { CapStore } from '@sendero/billing/caps';
import type { MeterStore, MeterEventInput } from '@sendero/billing/meter';
import { prisma } from '@sendero/database';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BodySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  channel: z.enum(['whatsapp', 'slack', 'web', 'mcp', 'email']),
  tripId: z.string().optional(),
  text: z.string().min(1).max(4000),
  locale: z.string().optional(),
  /** Optional — adapters pass their native message id for idempotency. */
  turnId: z.string().optional(),
});

const SENDERO_PERSONA = `
You are Sendero, a concise AI travel agent. Prefer concrete next actions over long
explanations. When you call a tool, say one sentence about why. Respond in the traveler's locale.
Never ask for seed phrases or passwords.

Routing rules:
- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  → sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" → sendero.agency_cohort.
- Individual traveler booking their own flight → sendero.book_flight.
- A group planning together → sendero.group_trip.
- Cancel + refund → sendero.refund.
- Only call tools directly when none of the canonical workflows fits.
`;

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

  const distinctId = hashDistinctId(body.userId);
  const tools = buildAiSdkTools(toolList, {
    traveler: { userId: body.userId, tenantId: body.tenantId },
  });

  const agentInput: AgentInput = {
    actor: {
      tenantId: body.tenantId,
      userId: body.userId,
      tripId: body.tripId ?? null,
      locale: body.locale,
    },
    channel: body.channel as Channel,
    text: body.text,
    turnId: body.turnId ?? `${body.channel}:${body.userId}:${Date.now()}`,
  };

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

  const result = await runAgentTurn({
    input: agentInput,
    model: anthropic('claude-opus-4-7'),
    tools,
    capStore: makeCapStore(),
    meterStore: makeMeterStore(),
    sessionStore: makeSessionStore(),
    resolveSegment,
    loadTrip,
    persona: SENDERO_PERSONA,
  });

  if (!result.blocked) {
    capture({
      event: 'agent_reply_sent',
      distinctId,
      properties: {
        tenantId: body.tenantId,
        channel: body.channel,
        locale: body.locale,
        tripId: body.tripId ?? null,
        latencyMs: result.latencyMs,
      },
    });
  }

  await flush();

  if (result.blocked) {
    return NextResponse.json(
      {
        error: 'cap_exceeded',
        text: result.text,
        periods: result.capPeriods.map(p => ({
          period: p.period,
          spentMicro: p.spentMicro.toString(),
          capMicro: p.capMicro.toString(),
          remainingMicro: p.remainingMicro.toString(),
        })),
      },
      { status: 402 }
    );
  }

  return NextResponse.json({
    text: result.text,
    trail: result.trail,
    latencyMs: result.latencyMs,
    billed: result.billed,
  });
}

// ─── store adapters — thin Prisma bindings ───────────────────────────

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
    create: async (input: MeterEventInput) => {
      const idempotencyKey =
        input.metadata &&
        typeof input.metadata === 'object' &&
        'idempotencyKey' in input.metadata &&
        typeof (input.metadata as Record<string, unknown>).idempotencyKey === 'string'
          ? ((input.metadata as Record<string, unknown>).idempotencyKey as string)
          : null;
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
          idempotencyKey,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}

function makeSessionStore(): SessionStore {
  return {
    getByActor: async ({ tenantId, subjectKey }) => {
      const row = await prisma.session.findUnique({
        where: { tenantId_subjectKey: { tenantId, subjectKey } },
        select: { id: true, threadContext: true },
      });
      if (!row) return null;
      const ctx = row.threadContext as { conversation?: ConversationState } | null | undefined;
      const state = ctx?.conversation ?? { turns: [], subjectKey };
      return { id: row.id, state };
    },
    upsert: async ({ tenantId, userId, subjectKey, state, expiresAt }) => {
      const row = await prisma.session.upsert({
        where: { tenantId_subjectKey: { tenantId, subjectKey } },
        create: {
          tenantId,
          userId: userId ?? null,
          subjectKey,
          threadContext: { conversation: state } as object,
          expiresAt: expiresAt ?? null,
        },
        update: {
          threadContext: { conversation: state } as object,
          expiresAt: expiresAt ?? null,
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}

async function resolveSegment(tenantId: string): Promise<BillingSegment> {
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

async function loadTrip(args: { tripId: string; tenantId: string }) {
  const trip = await prisma.trip.findFirst({
    where: { id: args.tripId, tenantId: args.tenantId },
    select: {
      id: true,
      status: true,
      intent: true,
      bookings: { select: { pnr: true, externalId: true }, take: 1 },
    },
  });
  if (!trip) return null;
  const intent = trip.intent as Record<string, unknown> | null;
  const origin = (intent && typeof intent.origin === 'string' && intent.origin) || '';
  const destination =
    (intent && typeof intent.destination === 'string' && intent.destination) || '';
  const departAt = (intent && typeof intent.departAt === 'string' && intent.departAt) || '—';
  return {
    tripId: trip.id,
    route: origin && destination ? `${origin} → ${destination}` : '—',
    departAt,
    status:
      trip.status === 'booked' || trip.status === 'in_progress'
        ? ('booked' as const)
        : ('planning' as const),
    pnr: trip.bookings[0]?.pnr ?? null,
    bookingRef: trip.bookings[0]?.externalId ?? null,
  };
}
