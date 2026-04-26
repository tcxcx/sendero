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
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import {
  buildSystemPrompt,
  buildIdempotencyKey,
  type Channel,
  type ConversationState,
  isDuplicateKeyError,
  type ModelTier,
  renderWorkflowsBlock,
  SENDERO_SOUL,
} from '@sendero/agent';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';
import { preflight } from '@sendero/billing/meter';
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
  makeMeterStore,
  makeSessionStore,
  requestLocale,
  resolveDirectModel,
  resolveModel,
  resolveSegment,
  resolveTenantPlan,
} from '@/lib/agent-auth';
import { detectAttachmentsHint } from '@/lib/agent-attachments-hint';
import { resolveTenantFromApiKey } from '@/lib/api-key-auth';
import { filterToolsByScopes } from '@/lib/dispatch-scopes';
import { enforceRequestSignature, scopesRequireSignature } from '@/lib/dispatch-signing';
import { gateDeclineMessage, reputationGate } from '@/lib/reputation-gate';
import { enforcePolicyChain } from '@/lib/transfer-policy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CHAT_PERSONA = `${SENDERO_SOUL}

## Routing rules
- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  -> sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" -> sendero.agency_cohort.
- Individual traveler booking their own flight -> sendero.book_flight.
- A group planning together -> sendero.group_trip.
- Cancel + refund -> sendero.refund.
- Only call tools directly when none of the canonical workflows fits.
`;

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
      const u = await prisma.user.findUnique({
        where: { clerkUserId: a.userId },
        select: { id: true },
      });
      clerkSession = {
        userId: u?.id ?? a.userId,
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
  const tools = buildAiSdkTools(scopedTools, {
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
  if (vertexProjectEnv) {
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
  const systemPrompt = buildSystemPrompt({
    persona: CHAT_PERSONA,
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

  const meterStore = makeMeterStore(
    apiKey?.effectiveKeyType === 'sandbox' ? { forceStatus: 'sandbox' } : undefined
  );
  const sessionStore = makeSessionStore();

  // useChat sends UIMessages; convertToModelMessages narrows them to
  // the provider-shape model messages stream-text expects.
  const modelMessages = await convertToModelMessages(body.messages as UIMessage[]);
  const startedAt = Date.now();

  const result = streamText({
    model: modelHandle,
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(6),
    maxRetries: 2,
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
      try {
        await meterStore.create({
          tenantId,
          userId,
          toolName: 'chat_reply',
          priceMicroUsdc: pre.priceMicroUsdc,
          status: 'paid' satisfies MeterStatus,
          note: `channel=${channel} idem=${idempotencyKey} surface=stream`,
          metadata: { channel, idempotencyKey, turnId, surface: 'agent_chat_stream' },
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
