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

import crypto from 'node:crypto';

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
import { DEFAULT_PRICING, type BillingSegment, type PricedAction } from '@sendero/billing/pricing';
import { planPriceFor, resolvePlan, type PlanTier } from '@sendero/billing/plans';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';
import { filterToolsByScopes } from '@/lib/dispatch-scopes';
import { enforceRequestSignature, scopesRequireSignature } from '@/lib/dispatch-signing';
import { buildResponseHeaders } from '@sendero/auth/dispatch-auth';
import { prisma } from '@sendero/database';
import { detectLocale, LOCALE_COOKIE_NAME } from '@sendero/locale';
import { filterPublicTools, toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import type { LanguageModel } from 'ai';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const DISPATCH_SECRET_HEADER = 'x-sendero-dispatch-secret';

/** Universal upload cap — mirrors @sendero/whatsapp MAX_MEDIA_BYTES. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 4;

const MediaAttachmentSchema = z
  .object({
    kind: z.enum(['image', 'document']),
    mediaType: z.string().min(1),
    url: z.string().url().optional(),
    data: z.string().optional(),
    filename: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
  })
  .superRefine((a, ctx) => {
    if (!a.url && !a.data) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Attachment must carry either url or base64 data.',
      });
    }
    if (a.size && a.size > MAX_ATTACHMENT_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Attachment exceeds ${MAX_ATTACHMENT_BYTES} byte cap.`,
      });
    }
  });

const BodySchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  channel: z.enum(['whatsapp', 'slack', 'web', 'mcp', 'email']),
  tripId: z.string().optional(),
  // Text may be empty when the traveler only shared an attachment (e.g. a
  // WhatsApp image with no caption). We require at least one of
  // (text, attachments) further down.
  text: z.string().max(4000).default(''),
  locale: z.string().optional(),
  /** Optional — adapters pass their native message id for idempotency. */
  turnId: z.string().optional(),
  attachments: z.array(MediaAttachmentSchema).max(MAX_ATTACHMENTS).optional(),
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
  // Two valid auth modes:
  //   1. Shared-secret (legacy) — internal webhooks, cron, etc. Set via
  //      AGENT_DISPATCH_SECRET/CRON_SECRET; tenant + user ids come from body.
  //   2. User-minted Clerk API key — external agents / MCP / x402. Tenant
  //      is derived from the key; body.tenantId must match if provided.
  const apiKey = await resolveTenantFromApiKey(req);
  if (!apiKey) {
    const authError = authorizeDispatch(req);
    if (authError) return authError;
  }

  // Read the body as text FIRST so we can hash the exact bytes for
  // request signature verification + response envelope signing. Don't
  // call req.json() ahead of this — it consumes the stream.
  const rawBody = await req.text();
  const bearer = extractBearerForSigning(req);

  // Scoped signing policy: keys with settlement / treasury / '*' scope
  // must HMAC-sign the request. Read-mostly scopes stay bearer-only so
  // the hot path keeps its sub-second latency.
  if (apiKey && bearer && scopesRequireSignature(apiKey.scopes)) {
    const verdict = await enforceRequestSignature({
      req,
      bearer,
      body: rawBody,
      toolName: 'dispatch_turn',
    });
    if (verdict.ok !== true) {
      return NextResponse.json(
        {
          error: 'signature_required',
          reason: verdict.reason,
          message: verdict.message,
          docs: 'https://docs.sendero.travel/docs/api-reference#request-signing',
        },
        { status: 401 }
      );
    }
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(JSON.parse(rawBody));
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  // When an API key authed the request, it pins the tenant. Reject any
  // attempt to bill against a different tenant via the body.
  if (apiKey && body.tenantId && body.tenantId !== apiKey.tenantId) {
    return NextResponse.json(
      {
        error: 'tenant_mismatch',
        message:
          'API key does not belong to the tenant in the request body. Drop body.tenantId or use a key for the target tenant.',
      },
      { status: 403 }
    );
  }
  if (apiKey) {
    // B2B service-account semantics. Clerk Organization API keys are not
    // per-user — they represent a workspace. Synthesize a deterministic
    // service-account userId from the key id so analytics + session keys
    // are stable and cross-user impersonation via body.userId is blocked.
    // Any tool that needs a specific traveler must take them as explicit
    // input; ctx.traveler from a `svc:` caller is a service account, not
    // a human.
    body = {
      ...body,
      tenantId: apiKey.tenantId,
      userId: `svc:${apiKey.keyId}`,
    };
  }

  const hasText = body.text.trim().length > 0;
  const hasAttachments = (body.attachments?.length ?? 0) > 0;
  if (!hasText && !hasAttachments) {
    return NextResponse.json(
      { error: 'empty_turn', message: 'Supply `text` or at least one attachment.' },
      { status: 400 }
    );
  }

  const distinctId = hashDistinctId(body.userId);
  const locale = body.locale ?? requestLocale(req);
  // Filter the tool registry BEFORE the LLM sees it.  Two filters:
  //   1. Audience — strip operator-only tools (kapso/slack channel
  //      provisioning, etc.).  Dispatch is the channel + external-API-
  //      key surface; only customer-facing tools belong here. The
  //      operator agent at /api/chat skips this step.
  //   2. Scope — drop tools the caller's API key isn't authorized for.
  // Both filters happen pre-prompt, so prompt injection can't sneak
  // the model into calling something it shouldn't see.
  const grantedScopes = apiKey?.scopes ?? (['*'] as const);
  const publicTools = filterPublicTools(toolList);
  const scopedTools = filterToolsByScopes(publicTools, grantedScopes);
  const tools = buildAiSdkTools(scopedTools, {
    traveler: { userId: body.userId, tenantId: body.tenantId },
  });

  // Narrow the zod-inferred shape to the AgentMediaAttachment contract —
  // the superRefine above already guarantees every entry has kind + mediaType
  // and at least one of (url, data). Casting keeps the compiler honest at
  // the call site without a second round of explicit if/else pruning.
  const normalizedAttachments = (body.attachments ?? []).map(a => ({
    kind: a.kind as 'image' | 'document',
    mediaType: a.mediaType as string,
    ...(a.url ? { url: a.url } : {}),
    ...(a.data ? { data: a.data } : {}),
    ...(typeof a.size === 'number' ? { size: a.size } : {}),
    ...(a.filename ? { filename: a.filename } : {}),
  }));

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
    // Payload bytes are NEVER logged. Analytics capture is already below
    // and only touches non-sensitive dimensions.
    ...(normalizedAttachments.length ? { attachments: normalizedAttachments } : {}),
  };

  capture({
    event: 'agent_message_received',
    distinctId,
    properties: {
      tenantId: body.tenantId,
      channel: body.channel,
      locale,
      tripId: body.tripId ?? null,
      messageType: hasAttachments ? 'multimodal' : 'text',
      attachmentCount: body.attachments?.length ?? 0,
      // Log only shape metadata — never the bytes.
      attachmentMimeTypes: body.attachments?.map(a => a.mediaType).join(',') ?? null,
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

  const planTier = await resolveTenantPlan(body.tenantId);
  const pricingOverrides = buildPlanOverrides(planTier);
  // If the caller authed with an API key whose effective type is
  // sandbox (either it's a sandbox key, or it's a production key
  // downgraded during testnet-beta), write MeterEvents as 'sandbox'
  // so NanopayBatch skips them.
  const meterStoreOpts =
    apiKey?.effectiveKeyType === 'sandbox' ? ({ forceStatus: 'sandbox' } as const) : undefined;

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      input: agentInput,
      model: modelHandle,
      tier,
      tools,
      capStore: makeCapStore(),
      meterStore: makeMeterStore(meterStoreOpts),
      sessionStore: makeSessionStore(),
      resolveSegment,
      pricingOverrides,
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
          meterStore: makeMeterStore(meterStoreOpts),
          sessionStore: makeSessionStore(),
          resolveSegment,
          pricingOverrides,
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
    const blockedBody = JSON.stringify({
      error: 'cap_exceeded',
      text: result.text,
      periods: result.capPeriods.map(p => ({
        period: p.period,
        spentMicro: p.spentMicro.toString(),
        capMicro: p.capMicro.toString(),
        remainingMicro: p.remainingMicro.toString(),
      })),
    });
    return new NextResponse(blockedBody, {
      status: 402,
      headers: {
        'content-type': 'application/json',
        ...buildResponseHeaders({ bearer, meterId: 'blocked', body: blockedBody }),
      },
    });
  }

  const successBody = JSON.stringify({
    text: result.text,
    trail: result.trail,
    latencyMs: result.latencyMs,
    billed: result.billed,
  });
  return new NextResponse(successBody, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      ...buildResponseHeaders({
        bearer,
        meterId: result.billed ? (result.trail[0]?.toolName ?? 'chat_reply') : 'free',
        body: successBody,
      }),
    },
  });
}

/**
 * Extract the bearer exactly as the request carries it.  Mirrors the
 * extraction in `api-key-auth.ts` but without the `ak_` format guard —
 * internal callers using AGENT_DISPATCH_SECRET don't have a bearer,
 * so we return null and skip signing.
 */
function extractBearerForSigning(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)/i.exec(auth);
    if (match && match[1].startsWith('ak_')) return match[1];
  }
  const custom = req.headers.get('x-sendero-api-key') ?? req.headers.get('X-Sendero-Api-Key');
  if (custom && custom.trim().startsWith('ak_')) return custom.trim();
  return null;
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

  // Constant-time compare. Plain `===` leaks secret bytes through
  // character-by-character timing — a remote attacker can recover the
  // secret with enough measurements. timingSafeEqual short-circuits
  // on length mismatch only, never on content.
  //
  // The body-tenantId trust below is intentional: this path is used
  // by internal channel webhooks (WhatsApp, Slack, cron) that have
  // already signature-verified their upstream call and need to
  // dispatch on behalf of a specific tenant. Leaking the secret
  // means impersonation of any tenant — rotate quarterly.
  const bearer = req.headers.get('authorization') ?? '';
  const header = req.headers.get(DISPATCH_SECRET_HEADER) ?? '';
  const bearerExpected = `Bearer ${expected}`;

  if (safeEqual(header, expected) || safeEqual(bearer, bearerExpected)) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

function makeMeterStore(opts?: { forceStatus?: 'sandbox' }): MeterStore {
  return {
    create: async (input: MeterEventInput) => {
      const idempotencyKey =
        input.metadata &&
        typeof input.metadata === 'object' &&
        'idempotencyKey' in input.metadata &&
        typeof (input.metadata as Record<string, unknown>).idempotencyKey === 'string'
          ? ((input.metadata as Record<string, unknown>).idempotencyKey as string)
          : null;
      // Sandbox keys (or production-downgraded-in-testnet) still record
      // meter events for analytics, but NanopayBatch ignores them so no
      // real USDC moves. Overriding status here is the single chokepoint.
      const status = opts?.forceStatus ?? input.status;
      const row = await prisma.meterEvent.create({
        data: {
          tenantId: input.tenantId,
          userId: input.userId ?? null,
          payerAddress: input.payerAddress ?? null,
          toolName: input.toolName,
          priceMicroUsdc: input.priceMicroUsdc,
          status,
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

/**
 * Resolve the Clerk-billed plan tier for a tenant.
 *
 * The tenant's `planTier` column is the source of truth once wired up
 * via Clerk webhooks (`organization.updated`). Until then we read the
 * legacy `billingTier` as a best-effort proxy so paying orgs don't
 * pay list price during rollout.
 */
async function resolveTenantPlan(tenantId: string): Promise<PlanTier> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingTier: true },
  });
  if (!tenant) return 'free';
  const legacy = tenant.billingTier?.toLowerCase();
  if (legacy === 'enterprise') return 'enterprise';
  if (legacy === 'pro') return 'pro';
  if (legacy === 'business' || legacy === 'basic') return 'basic';
  return 'free';
}

/**
 * Materialize pricing overrides for a plan. Applies the plan's
 * nanopayment + booking take-rate discounts to every action × segment
 * cell. The result feeds `runAgentTurn` → `preflight` → MeterEvent,
 * so paid plans bill at the discounted rate without the agent code
 * having to know about plans.
 */
function buildPlanOverrides(tier: PlanTier) {
  const plan = resolvePlan(tier);
  if (plan.nanopaymentDiscountBps === 0 && plan.bookingTakeRateDiscountBps === 0) {
    return undefined;
  }
  const segments: BillingSegment[] = ['consumer', 'agency', 'corporate', 'ai_agent'];
  const overrides: Partial<
    Record<PricedAction, Partial<Record<BillingSegment, ReturnType<typeof planPriceFor>>>>
  > = {};
  for (const action of Object.keys(DEFAULT_PRICING) as PricedAction[]) {
    const cells: Partial<Record<BillingSegment, ReturnType<typeof planPriceFor>>> = {};
    for (const segment of segments) {
      cells[segment] = planPriceFor({ action, segment, plan });
    }
    overrides[action] = cells;
  }
  return overrides;
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
