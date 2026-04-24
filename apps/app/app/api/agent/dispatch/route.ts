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
 *
 * Auth is intentionally not Clerk session auth. Channel webhooks are already
 * signature-verified before they fan in, then forward a shared internal
 * secret here so unauthenticated travelers can still message from WhatsApp,
 * Slack, email, or MCP without exposing an open LLM billing endpoint.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import {
  type AgentInput,
  type Channel,
  type ConversationState,
  directProviderCascade,
  directProviderModel,
  gatewayConfigured,
  gatewayErrorAllowsDirectRetry,
  geminiDirectModelId,
  googleGenerativeAiKey,
  type ModelTier,
  runAgentTurn,
  type SessionStore,
  selectModel,
  SENDERO_SOUL,
} from '@sendero/agent';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';
import type { CapStore } from '@sendero/billing/caps';
import type { MeterEventInput, MeterStore } from '@sendero/billing/meter';
import type { BillingSegment } from '@sendero/billing/pricing';
import { prisma } from '@sendero/database';
import { detectLocale, LOCALE_COOKIE_NAME } from '@sendero/locale';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DISPATCH_SECRET_HEADER = 'x-sendero-dispatch-secret';

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

const DISPATCH_PERSONA = `${SENDERO_SOUL}

## Routing rules
- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  → sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" → sendero.agency_cohort.
- Individual traveler booking their own flight → sendero.book_flight.
- A group planning together → sendero.group_trip.
- Cancel + refund → sendero.refund.
- Only call tools directly when none of the canonical workflows fits.
`;

export async function POST(req: NextRequest) {
  const authError = authorizeDispatch(req);
  if (authError) return authError;

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
  const locale = body.locale ?? requestLocale(req);
  const tools = buildAiSdkTools(toolList, {
    traveler: { userId: body.userId, tenantId: body.tenantId },
  });

  const agentInput: AgentInput = {
    actor: {
      tenantId: body.tenantId,
      userId: body.userId,
      tripId: body.tripId ?? null,
      locale,
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
      locale,
      tripId: body.tripId ?? null,
      messageType: 'text',
    },
  });

  const tier: ModelTier = 'smart';
  const modelHandle = resolveModel(tier);
  if (!modelHandle) {
    return NextResponse.json(
      {
        error: 'no_llm_configured',
        message:
          'Set AI_GATEWAY_API_KEY (preferred), or GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY, or OPENAI_API_KEY, or ANTHROPIC_API_KEY before running the agent.',
      },
      { status: 503 }
    );
  }

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      input: agentInput,
      model: modelHandle,
      tier,
      tools,
      capStore: makeCapStore(),
      meterStore: makeMeterStore(),
      sessionStore: makeSessionStore(),
      resolveSegment,
      loadTrip,
      persona: DISPATCH_PERSONA,
    });
  } catch (err) {
    const retryModels = gatewayErrorAllowsDirectRetry(err) ? resolveDirectModels(tier) : [];
    let retryError: unknown = null;
    for (const retryModel of retryModels) {
      try {
        console.warn(
          `[agent/dispatch] gateway failed; retrying direct provider ${retryModel.label}.`
        );
        result = await runAgentTurn({
          input: agentInput,
          model: retryModel.model,
          tier,
          tools,
          capStore: makeCapStore(),
          meterStore: makeMeterStore(),
          sessionStore: makeSessionStore(),
          resolveSegment,
          loadTrip,
          persona: DISPATCH_PERSONA,
        });
        retryError = null;
        break;
      } catch (directErr) {
        retryError = directErr;
        console.error(`[agent/dispatch] direct retry failed (${retryModel.label}):`, directErr);
      }
    }

    if (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      return NextResponse.json({ error: 'agent_turn_failed', message }, { status: 500 });
    }

    if (!result) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[agent/dispatch] runAgentTurn failed:', err);
      return NextResponse.json({ error: 'agent_turn_failed', message }, { status: 500 });
    }
  }

  if (!result.blocked) {
    capture({
      event: 'agent_reply_sent',
      distinctId,
      properties: {
        tenantId: body.tenantId,
        channel: body.channel,
        locale,
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

function requestLocale(req: NextRequest): string {
  return detectLocale({
    cookie: req.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: req.headers.get('x-sendero-locale') ?? req.headers.get('accept-language'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
  });
}

function authorizeDispatch(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        error: 'dispatch_secret_missing',
        message: 'Set AGENT_DISPATCH_SECRET or CRON_SECRET before using /api/agent/dispatch.',
      },
      { status: 503 }
    );
  }

  const bearer = req.headers.get('authorization');
  const header = req.headers.get(DISPATCH_SECRET_HEADER);
  if (header === expected || bearer === `Bearer ${expected}`) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

/**
 * Pick the model handle for this turn.
 *
 *   1. If Vercel AI Gateway is configured → pass the gateway string
 *      form (`'anthropic/claude-opus-4.6'`); AI SDK auto-routes and
 *      providerOptions.gateway.order drives fallback.
 *   2. Else fall back to direct SDKs in cascade order **Gemini → OpenAI →
 *      Anthropic** (see `directProviderCascade` in `@sendero/agent`).
 *   3. Else return null and the route 503s with a clear error.
 */
function resolveModel(tier: ModelTier): LanguageModel | string | null {
  if (gatewayConfigured()) {
    return selectModel({ tier }).model;
  }
  return resolveDirectModel(tier);
}

function resolveDirectModel(tier: ModelTier): LanguageModel | null {
  const direct = directProviderModel(tier);
  if (!direct) return null;
  return directModelFromString(direct);
}

function resolveDirectModels(tier: ModelTier): Array<{ label: string; model: LanguageModel }> {
  const seen = new Set<string>();
  const models: Array<{ label: string; model: LanguageModel }> = [];
  for (const candidate of directProviderCascade(tier)) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    const model = directModelFromString(candidate);
    if (model) models.push({ label: candidate, model });
  }
  return models;
}

function directModelFromString(direct: string): LanguageModel | null {
  const [provider, modelId] = direct.split('/') as [string, string];
  if (provider === 'google') {
    const key = googleGenerativeAiKey();
    if (!key) return null;
    const google = createGoogleGenerativeAI({ apiKey: key });
    return google(geminiDirectModelId(direct));
  }
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) return null;
  if (provider === 'openai' && !process.env.OPENAI_API_KEY) return null;
  if (provider === 'anthropic') return anthropic(modelId);
  if (provider === 'openai') return openai(modelId);
  return null;
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
