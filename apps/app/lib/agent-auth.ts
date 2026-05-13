/**
 * Shared auth + cap + meter wiring used by every channel-fanin agent
 * route (`/api/agent/dispatch` request-response, `/api/agent/chat`
 * streaming). Extracted so both surfaces enforce identical billing,
 * tenant-pinning, and provider-cascade behavior.
 *
 * What lives here:
 *   - `authorizeDispatch` + `safeEqual`: shared-secret auth used when
 *     no API key is present (internal channel webhooks, cron).
 *   - `extractBearerForSigning`: pulls the raw `ak_…` bearer for
 *     request-signing HMAC derivation.
 *   - `makeCapStore` / `makeMeterStore` / `makeSessionStore`: thin
 *     Prisma adapters for `runAgentTurn`. The streaming route bypasses
 *     `runAgentTurn` and calls `preflight` + `MeterStore.create`
 *     directly, but reuses the same store factories.
 *   - `resolveSegment` / `resolveTenantPlan` / `buildPlanOverrides`:
 *     plan-tier discount materialization, identical across both routes.
 *   - `resolveModel` / `resolveDirectModels` / `directModelFromString`:
 *     gateway-first cascade with direct-provider fallback.
 *   - `loadTrip` + `requestLocale`: small request-shape helpers.
 *
 * What does NOT live here: scope filtering (`dispatch-scopes`),
 * request signing (`dispatch-signing`), reputation gates, transfer
 * policy. Those modules already exist; the routes call them directly.
 */

import crypto from 'node:crypto';

import { type NextRequest, NextResponse } from 'next/server';

import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import {
  type ConversationState,
  directProviderCascade,
  directProviderModel,
  gatewayConfigured,
  geminiDirectModelId,
  googleGenerativeAiKey,
  type ModelTier,
  type SessionStore,
  selectModel,
} from '@sendero/agent';
import type { CapStore } from '@sendero/billing/caps';
import type { MeterEventInput, MeterStore } from '@sendero/billing/meter';
import { DEFAULT_PRICING, type BillingSegment, type PricedAction } from '@sendero/billing/pricing';
import { planPriceFor, resolvePlan, type PlanTier } from '@sendero/billing/plans';
import { prisma } from '@sendero/database';
import { detectLocale, LOCALE_COOKIE_NAME } from '@sendero/locale';
import type { LanguageModel } from 'ai';

import {
  createLobsterTrapModel,
  lobsterTrapConfigured,
  type LobsterTrapContext,
} from '@/lib/lobstertrap';

const DISPATCH_SECRET_HEADER = 'x-sendero-dispatch-secret';

/**
 * Two valid auth modes for channel-fanin routes:
 *   1. Shared-secret (legacy) via AGENT_DISPATCH_SECRET / CRON_SECRET.
 *   2. User-minted Clerk API key. Caller resolves it via
 *      `resolveTenantFromApiKey` first; only call `authorizeDispatch`
 *      when that returns null.
 *
 * Returns NextResponse on failure, null on success.
 */
export function authorizeDispatch(req: NextRequest): NextResponse | null {
  const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        error: 'dispatch_secret_missing',
        message: 'Set AGENT_DISPATCH_SECRET or CRON_SECRET before using channel-fanin routes.',
      },
      { status: 503 }
    );
  }

  // Constant-time compare. Plain `===` leaks secret bytes through
  // character-by-character timing; a remote attacker can recover the
  // secret with enough measurements.
  const bearer = req.headers.get('authorization') ?? '';
  const header = req.headers.get(DISPATCH_SECRET_HEADER) ?? '';
  const bearerExpected = `Bearer ${expected}`;

  if (safeEqual(header, expected) || safeEqual(bearer, bearerExpected)) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Extract the bearer exactly as the request carries it. Mirrors the
 * extraction in `api-key-auth.ts` but without the `ak_` format guard,
 * because internal callers using AGENT_DISPATCH_SECRET don't have a
 * bearer; we return null and skip signing.
 */
export function extractBearerForSigning(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)/i.exec(auth);
    if (match && match[1].startsWith('ak_')) return match[1];
  }
  const custom = req.headers.get('x-sendero-api-key') ?? req.headers.get('X-Sendero-Api-Key');
  if (custom && custom.trim().startsWith('ak_')) return custom.trim();
  return null;
}

export function requestLocale(req: NextRequest): string {
  return detectLocale({
    cookie: req.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: req.headers.get('x-sendero-locale') ?? req.headers.get('accept-language'),
    country: req.headers.get('x-vercel-ip-country') ?? req.headers.get('cf-ipcountry'),
  });
}

// ─── store adapters — thin Prisma bindings ───────────────────────────

export function makeCapStore(): CapStore {
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

export function makeMeterStore(opts?: { forceStatus?: 'sandbox' }): MeterStore {
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
          // Payer attribution — passed by tools that resolved via
          // resolvePayer; left NULL for legacy/unattributed callers.
          ...(input.payerType ? { payerType: input.payerType } : {}),
          ...(input.payerWalletId ? { payerWalletId: input.payerWalletId } : {}),
          ...(input.payerUserId ? { payerUserId: input.payerUserId } : {}),
        },
        select: { id: true },
      });
      return { id: row.id };
    },
  };
}

export function makeSessionStore(): SessionStore {
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

// ─── billing segment + plan tier ────────────────────────────────────

export async function resolveSegment(tenantId: string): Promise<BillingSegment> {
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
 * Resolve the Clerk-billed plan tier for a tenant. The tenant's
 * `planTier` column will be the source of truth once Clerk webhooks
 * (`organization.updated`) wire it up; until then we read the legacy
 * `billingTier` so paying orgs don't pay list price during rollout.
 */
export async function resolveTenantPlan(tenantId: string): Promise<PlanTier> {
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
 * cell, so paid plans bill at the discounted rate without the agent
 * code having to know about plans.
 */
export function buildPlanOverrides(tier: PlanTier) {
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

// ─── model cascade ──────────────────────────────────────────────────

/**
 * Pick the model handle for this turn:
 *   1. If Vercel AI Gateway is configured, return the gateway string
 *      form (`'anthropic/claude-opus-4.6'`); AI SDK auto-routes and
 *      `providerOptions.gateway.order` drives fallback.
 *   2. Else fall back to direct SDKs in cascade order Gemini, OpenAI,
 *      Anthropic via `directProviderCascade` in `@sendero/agent`.
 *   3. Else return null and the route 503s with a clear error.
 */
export function resolveModel(
  tier: ModelTier,
  lobsterTrapContext?: LobsterTrapContext
): LanguageModel | string | null {
  if (lobsterTrapConfigured() && lobsterTrapContext) {
    return createLobsterTrapModel({
      modelId: selectModel({ tier }).model,
      context: lobsterTrapContext,
    });
  }
  if (gatewayConfigured()) {
    return selectModel({ tier }).model;
  }
  return resolveDirectModel(tier);
}

export function resolveDirectModel(tier: ModelTier): LanguageModel | null {
  const direct = directProviderModel(tier);
  if (!direct) return null;
  return directModelFromString(direct);
}

export function resolveDirectModels(
  tier: ModelTier
): Array<{ label: string; model: LanguageModel }> {
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

export function directModelFromString(direct: string): LanguageModel | null {
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

// ─── trip lookup ────────────────────────────────────────────────────

export async function loadTrip(args: { tripId: string; tenantId: string }) {
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
