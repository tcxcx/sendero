/**
 * POST /api/agent/chat
 *
 * Streaming sibling of `/api/agent/dispatch`. Same auth + tenant
 * pinning + cap preflight + scope/public-tool filtering, but emits
 * the AI SDK v6 UI-message stream protocol so AI Elements' `useChat`
 * consumes tokens, tool calls, and tool results natively.
 *
 * Why not call `runAgentTurn`? It internally calls `generateText`
 * (non-streaming) and writes the meter on its way out. Streaming
 * needs `streamText` with an `onFinish` hook that fires after the
 * last chunk lands. We replicate `runAgentTurn`'s pre-flight + post-
 * flight invariants here so this surface bills exactly once per turn,
 * idempotent on `turnId`, just like the dispatch surface.
 *
 * Cap + meter behavior MUST match dispatch:
 *   1. `preflight()` from `@sendero/billing/meter` runs before the
 *      LLM is touched. Cap-blocked turns short-circuit with a 402.
 *   2. After streaming completes, `onFinish` writes one MeterEvent
 *      with `idempotencyKey = buildIdempotencyKey({turnId, …})`. A
 *      duplicate write is treated as success (P2002).
 *   3. Sandbox-key callers (or production-downgraded-in-testnet) get
 *      `forceStatus: 'sandbox'` so NanopayBatch ignores the row.
 *   4. Plan-tier overrides flow through `pricingOverrides` exactly as
 *      dispatch passes them to `runAgentTurn`.
 */

import { auth } from '@clerk/nextjs/server';
import { createVertex } from '@ai-sdk/google-vertex';
import { type NextRequest, NextResponse, after } from 'next/server';

import {
  agentSessionId,
  aiTelemetryConfig,
  evaluateTrace,
  flushLangfuse,
  getActiveTraceId,
  scoreCost,
  scoreLatency,
  scoreToolSuccess,
} from '@sendero/langfuse';

import { prisma } from '@sendero/database';

import {
  buildSystemPrompt,
  buildIdempotencyKey,
  type Channel,
  type ConversationState,
  isDuplicateKeyError,
  type ModelTier,
  renderWorkflowsBlock,
} from '@sendero/agent';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';
import { preflight } from '@sendero/billing/meter';
import { resolvePlan } from '@sendero/billing/plans';
import type { MeterStatus } from '@sendero/database';
import { getLocaleSlice } from '@sendero/locale';
import { filterPublicTools, toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { listWorkflows } from '@sendero/workflows';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { z } from 'zod';

import {
  authorizeDispatch,
  buildPlanOverrides,
  extractBearerForSigning,
  loadTrip,
  makeCapStore,
  makeSessionStore,
  requestLocale,
  resolveDirectModel,
  resolveModel,
  resolveSegment,
  resolveTenantPlan,
} from '@/lib/agent-auth';
import { resolveChatModel } from '@/lib/agent-models';
import { makeCreditAwareMeterStore } from '@/lib/credit-store';
import { resolvePayer, PayerResolutionError } from '@sendero/tools/lib/resolve-payer';
import type { MeterPayerType } from '@sendero/database';
import { detectAttachmentsHint } from '@/lib/agent-attachments-hint';
import {
  chatPricingBreakdown,
  chatTurnPriceMicroUsdc,
  inferModelId,
  type ChatUsage,
} from '@/lib/chat-pricing';
import { resolveTenantFromApiKey } from '@/lib/api-key-auth';
import { filterToolsByScopes } from '@/lib/dispatch-scopes';
import { enforceRequestSignature, scopesRequireSignature } from '@/lib/dispatch-signing';
import { gateDeclineMessage, reputationGate } from '@/lib/reputation-gate';
import { enforcePolicyChain } from '@/lib/transfer-policy';
import { provisionClerkUserId } from '@/lib/user-provisioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Persona resolution moved to apps/app/lib/agent-persona.ts so the same
// Langfuse-managed `sendero-soul` + per-surface routing rules feed every
// surface. The fallback strings inside that helper mirror the original
// CHAT_PERSONA verbatim — Langfuse Prompt Management is opt-in via
// LANGFUSE_PROMPT_MANAGEMENT=true.
import { buildAgentPersona } from '@/lib/agent-persona';

const BodySchema = z.object({
  // useChat sends the running history under `messages`. tenantId +
  // channel + tripId + locale + turnId are passed via the transport's
  // `body` option from the client.
  messages: z.array(z.unknown()).min(1),
  tenantId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  channel: z.enum(['whatsapp', 'slack', 'web', 'mcp', 'email']).default('web'),
  tripId: z.string().optional(),
  locale: z.string().optional(),
  turnId: z.string().optional(),
  /**
   * Operator-selected gateway model id (e.g. `google/gemini-2.5-flash`).
   * When set + gateway is configured, the conversational LLM uses this
   * exact model. Falls back to the standard cascade on miss. Tool-
   * internal models (OCR, embeddings) ignore this field.
   */
  model: z.string().optional(),
  /**
   * Public sandbox playground mode. Forces every meter event from this
   * turn to status='sandbox' regardless of plan tier or env, and
   * activates per-user + per-IP rate limiting. Only honored on
   * Clerk-session-authed callers (the public /playground UI); API key
   * callers can already get sandbox routing via their key type.
   */
  playground: z.boolean().default(false),
});

export async function POST(req: NextRequest) {
  // Three auth modes — API key, shared secret, or Clerk session. The
  // first two mirror /api/agent/dispatch; the Clerk path exists so the
  // operator's own browser (e.g. /dashboard/agent-chat) can call this
  // streaming endpoint with just session cookies. Clerk-resolved tenant
  // pins tenantId server-side, ignoring any body.tenantId.
  const apiKey = await resolveTenantFromApiKey(req);
  let clerkSession: { userId: string; orgId: string; tenantId: string } | null = null;
  if (!apiKey) {
    const authError = authorizeDispatch(req);
    if (authError) {
      // Try Clerk session as a third auth path before rejecting.
      const a = await auth();
      if (!a.userId || !a.orgId) {
        return authError;
      }
      const tenant = await prisma.tenant.findUnique({
        where: { clerkOrgId: a.orgId },
        select: { id: true },
      });
      if (!tenant) {
        return NextResponse.json(
          { error: 'tenant_not_found', message: 'Clerk org has no Sendero tenant.' },
          { status: 404 }
        );
      }
      // Auto-provision the User row inline if the Clerk webhook hasn't
      // landed yet. Without this, brand-new sign-ups blow up on first
      // turn with P2003 (MeterEvent.userId FK) because the old fallback
      // smuggled a Clerk-format id into a column FK'd to User.id.
      const userId = await provisionClerkUserId(a.userId);
      if (!userId) {
        return NextResponse.json(
          {
            error: 'user_not_provisioned',
            message:
              'Your account is still finishing setup. Try again in a moment — this should clear within seconds.',
          },
          { status: 401 }
        );
      }
      clerkSession = {
        userId,
        orgId: a.orgId,
        tenantId: tenant.id,
      };
    }
  }

  // Read body as text first so request-signature HMAC can hash the
  // exact bytes. Don't consume req.json() upstream of this.
  const rawBody = await req.text();
  const bearer = extractBearerForSigning(req);

  if (apiKey && bearer && scopesRequireSignature(apiKey.scopes)) {
    const verdict = await enforceRequestSignature({
      req,
      bearer,
      body: rawBody,
      toolName: 'chat_turn',
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

  // Tenant + user resolution. API-key auth pins both; Clerk session
  // pins tenant via the active org and user via the Clerk user; shared-
  // secret path trusts body.tenantId + body.userId (internal webhooks).
  let tenantId: string;
  let userId: string;
  if (apiKey) {
    if (body.tenantId && body.tenantId !== apiKey.tenantId) {
      return NextResponse.json(
        {
          error: 'tenant_mismatch',
          message:
            'API key does not belong to the tenant in the request body. Drop body.tenantId or use a key for the target tenant.',
        },
        { status: 403 }
      );
    }
    tenantId = apiKey.tenantId;
    userId = `svc:${apiKey.keyId}`;
  } else if (clerkSession) {
    tenantId = clerkSession.tenantId;
    userId = clerkSession.userId;
  } else {
    if (!body.tenantId || !body.userId) {
      return NextResponse.json(
        {
          error: 'invalid_input',
          message: 'tenantId and userId are required when authing with the dispatch shared secret.',
        },
        { status: 400 }
      );
    }
    tenantId = body.tenantId;
    userId = body.userId;
  }

  // Public-sandbox-playground rate limit. Only honored on Clerk-session
  // callers — API-key callers and the dispatch shared-secret path are
  // not subject to playground caps. Per-user (30 turns / 10 min) and
  // per-IP (60 turns / 10 min) so multi-account abuse from one machine
  // still hits the wall. Rate limit fails open on Redis outages.
  const playgroundMode = body.playground === true && Boolean(clerkSession);
  if (playgroundMode) {
    const { checkRateLimit, clientIp } = await import('@/lib/rate-limit');
    const ip = clientIp(req.headers);
    const [userLimit, ipLimit] = await Promise.all([
      checkRateLimit({
        bucket: 'playground-chat-user',
        key: userId,
        windowS: 600,
        limit: 30,
      }),
      checkRateLimit({
        bucket: 'playground-chat-ip',
        key: ip,
        windowS: 600,
        limit: 60,
      }),
    ]);
    const blocked = !userLimit.ok || !ipLimit.ok;
    if (blocked) {
      const retryAfter = Math.max(userLimit.retryAfterS, ipLimit.retryAfterS);
      return NextResponse.json(
        {
          error: 'rate_limited',
          message:
            'Playground rate limit reached. The cap is 30 turns / 10 min per account, or 60 turns / 10 min per network. Wait or sign in with a paid workspace to drop the limit.',
          scope: !userLimit.ok ? 'user' : 'ip',
          retryAfterS: retryAfter,
        },
        { status: 429, headers: { 'retry-after': String(retryAfter) } }
      );
    }
  }

  const isServiceAccount = Boolean(apiKey);

  // Transfer-policy preflight (mirrors dispatch). Hard windows over
  // cap reject before the LLM runs.
  const policy = await enforcePolicyChain({
    tenantId,
    travelerId: isServiceAccount ? undefined : userId,
    context: {
      tenantId,
      travelerId: isServiceAccount ? undefined : userId,
      amountMicroUsdc: 0n,
      kind: 'x402',
    },
  });
  if (policy.kind !== 'pass') {
    return policy.response;
  }

  // Reputation gate (mirrors dispatch). Service-account callers skip.
  if (!isServiceAccount) {
    const gate = await reputationGate({
      tenantId,
      counterpartyKind: 'user',
      counterpartyUserId: userId,
    });
    if (gate.ok === false && gate.enforcement === 'block') {
      return NextResponse.json(
        {
          error: 'reputation_policy_blocked',
          message: gateDeclineMessage(gate),
          violations: gate.violations,
        },
        { status: 403 }
      );
    }
    if (gate.ok === 'unknown' && gate.enforcement === 'block' && gate.reason !== 'no_policy') {
      return NextResponse.json(
        {
          error: 'reputation_policy_blocked',
          message: gateDeclineMessage(gate),
          reason: gate.reason,
        },
        { status: 403 }
      );
    }
  }

  // Cap preflight: identical to runAgentTurn's first step. Blocks
  // here mean the tenant has hit its spend cap; surface 402.
  const segment = await resolveSegment(tenantId);
  const planTier = await resolveTenantPlan(tenantId);
  const pricingOverrides = buildPlanOverrides(planTier);
  const capStore = makeCapStore();
  const pre = await preflight(capStore, {
    tenantId,
    action: 'chat_reply',
    segment,
    overrides: pricingOverrides,
  });
  if (pre.blocked) {
    return NextResponse.json(
      {
        error: 'cap_exceeded',
        text:
          pre.cap.warnings[0] ??
          'Your tenant has hit its spend cap for this period. Contact your admin.',
        periods: pre.cap.periods.map(p => ({
          period: p.period,
          spentMicro: p.spentMicro.toString(),
          capMicro: p.capMicro.toString(),
          remainingMicro: p.remainingMicro.toString(),
        })),
      },
      { status: 402 }
    );
  }

  const channel = body.channel as Channel;
  const distinctId = hashDistinctId(userId);
  const locale = body.locale ?? requestLocale(req);
  const turnId = body.turnId ?? `${channel}:${userId}:${Date.now()}`;
  const subjectKey = `${channel}:${userId}`;

  // Tool registry — apply the same two filters dispatch uses:
  //   1. Audience: strip operator-only tools.
  //   2. Scope: drop tools the caller's API key isn't authorized for.
  const grantedScopes = apiKey?.scopes ?? (['*'] as const);
  const publicTools = filterPublicTools(toolList);
  const scopedTools = filterToolsByScopes(publicTools, grantedScopes);

  // Resolve the per-turn payer once. Same shape as dispatch — fail-soft
  // when no traveler context is bound (operator agent-chat turns hit this
  // path for testing and don't carry trip context).
  let turnPayer: MeterPayerType | undefined;
  let turnPayerUserId: string | undefined;
  try {
    const resolved = await resolvePayer({
      tenantId,
      tripId: body.tripId ?? undefined,
      travelerUserId: userId,
    });
    turnPayer = resolved.type;
    turnPayerUserId = resolved.travelerUserId ?? undefined;
  } catch (err) {
    if (
      err instanceof PayerResolutionError &&
      (err.code === 'traveler_required' || err.code === 'split_unsupported')
    ) {
      turnPayer = undefined;
    } else {
      throw err;
    }
  }

  const tools = buildAiSdkTools(scopedTools, {
    ...(body.tripId ? { tripId: body.tripId } : {}),
    surface: 'agent_chat_stream',
    traveler: { userId, tenantId },
    ...(apiKey
      ? {
          caller: {
            scopes: apiKey.scopes,
            keyType: apiKey.keyType,
            effectiveKeyType: apiKey.effectiveKeyType,
          },
        }
      : {}),
    ...(turnPayer
      ? {
          payer: {
            type: turnPayer,
            ...(turnPayerUserId ? { travelerUserId: turnPayerUserId } : {}),
          },
        }
      : {}),
  });

  // Resolve model. This route doesn't carry the dispatch route's
  // direct-provider retry-on-gateway-error loop because streaming
  // failures surface mid-stream rather than as a single throw; the
  // gateway's own provider-fallback (via providerOptions.gateway.order)
  // handles most of that. If the gateway is fully unavailable we
  // could swap in a /api/chat-style cascade probe, but that's
  // strictly a robustness upgrade, not a billing concern.
  const tier: ModelTier = 'smart';
  // Streaming routes can't catch in-band gateway errors (the "Free
  // credits" abuse-protection message arrives as a data event mid-
  // stream, not as a thrown error — gatewayErrorAllowsDirectRetry only
  // helps non-streaming dispatch). When GOOGLE_CLOUD_PROJECT is set,
  // construct Vertex Gemini directly here — bypass the resolver chain
  // entirely so module-cache staleness in dev doesn't reroute through
  // the gateway. Falls back to the resolver cascade when Vertex isn't
  // configured.
  const vertexProjectEnv = process.env.GOOGLE_CLOUD_PROJECT;
  const vertexLocationEnv = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
  let modelHandle: ReturnType<typeof resolveModel> = null;
  // Operator-picked model wins only after the same plan gate used by
  // /api/chat. The picker is a UX affordance; this server check is the
  // enforcement point for direct POSTs and channel-driven sessions.
  if (body.model) {
    const resolved = resolveChatModel(body.model, resolvePlan(planTier), {
      source:
        channel === 'web' || channel === 'slack' || channel === 'whatsapp' ? channel : 'api',
    });
    if ('locked' in resolved) {
      return NextResponse.json(resolved.locked, { status: 403 });
    }
    modelHandle = resolved.model;
  }
  if (!modelHandle && vertexProjectEnv) {
    let googleAuthOptions: Parameters<typeof createVertex>[0]['googleAuthOptions'];
    const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    if (saJson) {
      try {
        googleAuthOptions = { credentials: JSON.parse(saJson) };
      } catch {
        // bad JSON — fall through to resolver
      }
    }
    try {
      const vertex = createVertex({
        project: vertexProjectEnv,
        location: vertexLocationEnv,
        googleAuthOptions,
      });
      modelHandle = vertex('gemini-2.5-flash');
    } catch {
      // createVertex constructor failure — fall through to resolver
    }
  }
  if (!modelHandle) {
    modelHandle = resolveDirectModel(tier) ?? resolveModel(tier);
  }
  if (!modelHandle) {
    return NextResponse.json(
      {
        error: 'no_llm_configured',
        message:
          'Set GOOGLE_CLOUD_PROJECT (Vertex), GOOGLE_GENERATIVE_AI_API_KEY (AI Studio), AI_GATEWAY_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY before running the agent.',
      },
      { status: 503 }
    );
  }

  // Build the same workflow-aware system prompt runAgentTurn uses.
  // Conversation history flows through `messages` from useChat, so
  // we don't inject `recentTurns` from the SessionStore here; the
  // client carries it on every turn.
  const localeSlice = getLocaleSlice(locale);
  const trip = body.tripId ? await loadTrip({ tripId: body.tripId, tenantId }) : null;
  const persona = await buildAgentPersona('chat', locale);
  const systemPrompt = buildSystemPrompt({
    persona,
    locale,
    localeSlice,
    channelHint:
      'Web operator console. The right side of the screen renders tool outputs as cards; reply concisely and do not duplicate visible UI.',
    tripContext: trip
      ? [
          `- Trip: \`${trip.tripId}\` (${trip.status})`,
          `- Route: ${trip.route}`,
          `- Departs: ${trip.departAt}`,
          trip.pnr ? `- PNR: \`${trip.pnr}\`` : '',
          trip.bookingRef ? `- Booking: \`${trip.bookingRef}\`` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : '',
    workflowCatalog: renderWorkflowsBlock(
      listWorkflows().map(w => ({ id: w.id, label: w.label, description: w.description }))
    ),
    attachmentsHint: detectAttachmentsHint(body.messages),
  });

  capture({
    event: 'agent_message_received',
    distinctId,
    properties: {
      tenantId,
      channel,
      locale,
      tripId: body.tripId ?? null,
      messageType: 'text',
    },
  });

  // Credit-aware meter store — routes every metered action through
  // `deductAndRecord()` so SaaS-included credits decrement off
  // `Subscription.meterBalanceMicro` before falling through to
  // status='paid'. Tenants with no grant (free tier) get the same
  // 'paid' write as before, so this swap is backward-compatible.
  const meterStore = makeCreditAwareMeterStore({
    plan: resolvePlan(planTier),
    // Playground mode (Clerk-authed turn from /playground) forces
    // sandbox routing, so paid users can experiment without burning
    // their cap and free-tier users can demo without us settling.
    sandbox: apiKey?.effectiveKeyType === 'sandbox' || playgroundMode,
    segment,
    defaults: {
      ...(turnPayer ? { payerType: turnPayer } : {}),
      ...(turnPayerUserId ? { payerUserId: turnPayerUserId } : {}),
    },
  });
  const sessionStore = makeSessionStore();

  // useChat sends UIMessages; convertToModelMessages narrows them to
  // the provider-shape model messages stream-text expects.
  const modelMessages = await convertToModelMessages(body.messages as UIMessage[]);
  const startedAt = Date.now();

  // Enable thinking on the conversational LLM so AI Elements'
  // <Reasoning> bubble has parts to render. Only applies when the model
  // is a gateway slug; direct Vertex / direct Anthropic handles their
  // own thinking config via the model handle itself when applicable.
  // Provider options carry both the thinking config (when applicable)
  // and the prompt-cache hints (anthropic ephemeral cache, gemini
  // cachedContent breakpoint). Caching is scoped to the system prompt
  // + tool definitions only — the user's messages are NEVER cached so
  // there's no cross-tenant leak surface. ~10× input-token COGS
  // reduction on agentic loops where system + tools dominate.
  const chatProviderOptions =
    typeof modelHandle === 'string'
      ? {
          google: {
            thinkingConfig: { thinkingBudget: 4096, includeThoughts: true },
          },
          anthropic: {
            thinking: { type: 'enabled', budgetTokens: 4096 },
            // Ephemeral cache breakpoint at the system prompt; the AI
            // SDK rolls it into the system message for Anthropic. The
            // tool-definition prefix gets cached automatically by the
            // provider when tools repeat across turns.
            cacheControl: { type: 'ephemeral' as const },
          },
        }
      : undefined;

  const result = streamText({
    model: modelHandle,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    // Per-turn step ceiling — runaway-loop defense. Bumped to 8 for
    // the operator chat surface (richer tool flows than dispatch);
    // the autoplan eng review's #1 critical-gap insurance plus
    // explicit user request in the credits-cogs locked decisions.
    stopWhen: stepCountIs(8),
    maxRetries: 2,
    providerOptions: chatProviderOptions,
    // Vercel AI Gateway groups runs by metadata in its observability
    // dashboard. Tagging every call lets us attribute COGS back to
    // tenant + tier + model — the autoplan DX-review "magical moment"
    // recommendation. Also lets the gateway dashboard answer
    // "which Pro tenants are routing to opus most" without a separate
    // COGS pipeline. Independent from credits — ships value even if
    // the deduction loop stops.
    experimental_telemetry: aiTelemetryConfig('sendero-chat', {
      userId: userId ?? 'anonymous',
      tenantId,
      sessionId: agentSessionId(tenantId, channel),
      surface: 'app-api',
      trigger: 'user',
      channel,
      turnId,
      planTier,
      model: typeof modelHandle === 'string' ? modelHandle : 'direct',
      scope: 'agent-chat',
    }),
    // The closure captures everything we need to write the meter
    // event + update the session AFTER the last chunk lands. The
    // client has already received its tokens at this point; meter
    // writes are fire-and-forget from the user's perspective.
    onFinish: async finish => {
      const latencyMs = Date.now() - startedAt;
      const idempotencyKey = buildIdempotencyKey({
        tenantId,
        channel,
        turnId,
        eventKind: 'chat_reply',
      });
      // Token-aware turn price: take the larger of the segment-priced
      // preflight (covers cap-policy minimums + plan-tier discounts via
      // pricingOverrides) and the actual provider cost from finish.usage.
      // Plan-tier discount applies to BOTH paths so paid plans get
      // their advertised cut even when an expensive thinking model
      // dominates cost.
      const modelId = inferModelId(modelHandle);
      const usage = (finish as { usage?: ChatUsage }).usage;
      const planConfig = resolvePlan(planTier);
      const discountBps = planConfig.nanopaymentDiscountBps;
      const tokenAwarePrice = chatTurnPriceMicroUsdc(modelId, usage, discountBps);
      const turnPrice = pre.priceMicroUsdc > tokenAwarePrice ? pre.priceMicroUsdc : tokenAwarePrice;
      const breakdown = chatPricingBreakdown(modelId, usage, discountBps);

      try {
        await meterStore.create({
          tenantId,
          userId,
          toolName: 'chat_reply',
          priceMicroUsdc: turnPrice,
          status: 'paid' satisfies MeterStatus,
          note: `channel=${channel} idem=${idempotencyKey} surface=stream model=${modelId ?? 'unknown'}`,
          metadata: {
            channel,
            idempotencyKey,
            turnId,
            surface: 'agent_chat_stream',
            pricing: breakdown,
            preflightMicroUsdc: pre.priceMicroUsdc.toString(),
          },
        });
      } catch (err) {
        if (!isDuplicateKeyError(err)) {
          console.error('[agent/chat] meter write failed:', err);
        }
      }

      // Mirror runAgentTurn's session update so future turns see the
      // accumulated history if the client ever drops `messages` and
      // relies on server-side state.
      try {
        const existing = await sessionStore.getByActor({ tenantId, subjectKey });
        const prior: ConversationState = existing?.state ?? { turns: [], subjectKey };
        const userTurn = lastUserText(body.messages as UIMessage[]);
        const next: ConversationState = {
          ...prior,
          turns: [
            ...prior.turns,
            ...(userTurn
              ? [
                  {
                    at: new Date(startedAt).toISOString(),
                    role: 'user' as const,
                    text: userTurn,
                    channel,
                    turnId,
                  },
                ]
              : []),
            {
              at: new Date().toISOString(),
              role: 'agent' as const,
              text: finish.text ?? '',
              channel,
              turnId,
              toolCalls: (finish.toolCalls ?? []).map(tc => ({ name: tc.toolName, ok: true })),
            },
          ].slice(-40),
        };
        await sessionStore.upsert({
          tenantId,
          userId: isServiceAccount ? null : userId,
          subjectKey,
          state: next,
        });
      } catch (err) {
        console.error('[agent/chat] session upsert failed:', err);
      }

      capture({
        event: 'agent_reply_sent',
        distinctId,
        properties: {
          tenantId,
          channel,
          locale,
          tripId: body.tripId ?? null,
          latencyMs,
        },
      });

      // Langfuse scoring + LLM-as-a-judge eval (fire-and-forget).
      // Read the live OTel trace id from the active span — the AI SDK
      // call above wrote spans through aiTelemetryConfig, and the
      // Langfuse trace id IS the OTel trace id. Falls back to turnId
      // for safety; without the real id, scores would land on phantom
      // traces. Capture before the after() block so the closure sees a
      // stable value even after onFinish returns.
      //
      // Walk finish.steps to aggregate all tool calls + their success.
      // finish.toolCalls only returns the FINAL step's calls, so a
      // tool→summarize turn would record 0 tools. Read step.toolResults
      // to compute success per call instead of hardcoding `true` (the
      // judge needs honest signal, not optimistic noise). Same fix as
      // /api/chat (Step 1).
      const langfuseTraceId = getActiveTraceId() ?? turnId;
      const stepsArr = Array.isArray((finish as { steps?: unknown[] }).steps)
        ? ((finish as { steps?: unknown[] }).steps as Array<{
            toolCalls?: Array<{ toolName?: string; toolCallId?: string }>;
            toolResults?: Array<{
              toolCallId?: string;
              output?: unknown;
              error?: unknown;
              errorText?: string;
            }>;
          }>)
        : [];
      const allInvokedTools: Array<{ toolName: string; success: boolean }> = [];
      for (const step of stepsArr) {
        const calls = Array.isArray(step?.toolCalls) ? step.toolCalls : [];
        const results = Array.isArray(step?.toolResults) ? step.toolResults : [];
        for (const call of calls) {
          if (typeof call?.toolName !== 'string') continue;
          const r = results.find(x => x.toolCallId === call.toolCallId);
          const out = r?.output;
          const success =
            !r ||
            (!r.error &&
              !r.errorText &&
              !(out && typeof out === 'object' && 'error' in (out as Record<string, unknown>)));
          allInvokedTools.push({ toolName: call.toolName, success });
        }
      }
      if (allInvokedTools.length === 0) {
        for (const tc of finish.toolCalls ?? []) {
          allInvokedTools.push({ toolName: tc.toolName, success: true });
        }
      }

      // Wrap fire-and-forget LLM-judge calls in after() — without it
      // Vercel teardown orphans the four gpt-4.1-nano completions when
      // the stream closes before they return.
      after(async () => {
        try {
          await scoreLatency(langfuseTraceId, latencyMs);
          // scoreCost — was missing on this surface (Step 2). Reuses
          // turnPrice already computed for the meter write above.
          await scoreCost(langfuseTraceId, turnPrice);
          if (allInvokedTools.length > 0) {
            await scoreToolSuccess(langfuseTraceId, allInvokedTools);
          }
          const lastUser = lastUserText(body.messages as UIMessage[]);
          if (lastUser && finish.text) {
            await evaluateTrace({
              traceId: langfuseTraceId,
              input: lastUser,
              output: finish.text,
            });
          }
          await flushLangfuse();
        } catch (err) {
          console.warn('[agent/chat] langfuse scoring failed (non-fatal):', err);
        }
      });

      await flush();
    },
    onError: event => {
      const err = event?.error;
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown';
      console.error('[agent/chat] stream error:', msg);
    },
  });

  return result.toUIMessageStreamResponse({
    headers: {
      'X-Sendero-Surface': 'agent-chat',
    },
    // Surface the live Langfuse trace id on the assistant message so
    // the operator thumbs UI can score the right trace via
    // POST /api/agent/feedback. The OTel context is active during
    // streamText execution, so getActiveTraceId() returns the real
    // span trace id; falls back to turnId if OTel is unavailable.
    messageMetadata: ({ part }: { part: { type: string } }) => {
      if (part.type === 'start') {
        const traceId = getActiveTraceId() ?? turnId;
        return { senderoTraceId: traceId };
      }
      return undefined;
    },
  });
}

/**
 * Pull the most-recent user-authored text from a UIMessage array so
 * we can record it on the session log. Falls back to '' if the
 * caller only sent assistant turns (rare but legal).
 */
function lastUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    const parts = (m as UIMessage).parts ?? [];
    const text = parts
      .map(p =>
        p && typeof p === 'object' && 'type' in p && p.type === 'text'
          ? ((p as { text?: string }).text ?? '')
          : ''
      )
      .filter(Boolean)
      .join('\n');
    if (text) return text;
  }
  return '';
}
