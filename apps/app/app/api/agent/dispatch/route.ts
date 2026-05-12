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

import {
  type AgentInput,
  type Channel,
  gatewayErrorAllowsDirectRetry,
  type ModelTier,
  runAgentTurn,
} from '@sendero/agent';
import { capture, flush, hashDistinctId } from '@sendero/analytics/server';
import { buildResponseHeaders } from '@sendero/auth/dispatch-auth';
import { resolvePlan } from '@sendero/billing/plans';
import { type MeterPayerType, prisma } from '@sendero/database';
import { filterPublicTools, toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';
import { PayerResolutionError, resolvePayer } from '@sendero/tools/lib/resolve-payer';
import { z } from 'zod';

import {
  authorizeDispatch,
  buildPlanOverrides,
  extractBearerForSigning,
  loadTrip,
  makeCapStore,
  makeSessionStore,
  requestLocale,
  resolveDirectModels,
  resolveModel,
  resolveSegment,
  resolveTenantPlan,
} from '@/lib/agent-auth';
import { buildAgentPersona } from '@/lib/agent-persona';
import { resolveTenantFromApiKey } from '@/lib/api-key-auth';
import { makeCreditAwareMeterStore } from '@/lib/credit-store';
import { filterToolsByScopes } from '@/lib/dispatch-scopes';
import { enforceRequestSignature, scopesRequireSignature } from '@/lib/dispatch-signing';
import { gateDeclineMessage, reputationGate } from '@/lib/reputation-gate';
import { buildStartWorkflowTool } from '@/lib/start-workflow-tool';
import { enforcePolicyChain } from '@/lib/transfer-policy';
import { appendTripEvent, resolveTripByBoardingPass, type TripEvent } from '@/lib/trip-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
  /** ChannelIdentity row id — set by channel adapters (WhatsApp/Slack)
   *  so internal tools like `request_human_handoff` can anchor escalation
   *  records to the originating traveler. */
  channelIdentityId: z.string().optional(),
  /** Traveler E.164 phone — only the channel adapter knows this; falls
   *  back to ctx-derived lookups when absent. */
  travelerPhone: z.string().optional(),
});

// Persona resolution moved to apps/app/lib/agent-persona.ts. Resolves
// `sendero-soul` + `sendero-dispatch-routing-rules` from Langfuse Prompt
// Management when LANGFUSE_PROMPT_MANAGEMENT=true; otherwise the hardcoded
// fallbacks inside that helper ship verbatim.

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

  // Transfer-policy preflight. Loads tenant + traveler-scoped guards
  // from `TransferPolicy` and runs them with `amountMicroUsdc: 0n` so
  // hard windows that are *already* over cap reject the turn before
  // the LLM runs (saves cost) and `requiresApproval` rows surface a
  // pending envelope. Tool-scoped guards are evaluated per-charge
  // inside `runAgentTurn` via the legacy CapStore — this preflight
  // doesn't pre-empt them.
  //
  // Service-account callers (apiKey present) skip the traveler
  // projection because their `body.userId = svc:<keyId>` isn't a real
  // User row; only tenant-scoped policies apply.
  const isServiceAccount = Boolean(apiKey);
  const verdict = await enforcePolicyChain({
    tenantId: body.tenantId,
    travelerId: isServiceAccount ? undefined : body.userId,
    context: {
      tenantId: body.tenantId,
      travelerId: isServiceAccount ? undefined : body.userId,
      amountMicroUsdc: 0n,
      kind: 'x402',
    },
  });
  if (verdict.kind !== 'pass') {
    return verdict.response;
  }

  // Reputation gate: per-tenant ReputationPolicy (commit 5) gates
  // engagement with the inbound counterparty (the user, in the
  // typical agency→user direction). Cache-only read, sub-50ms.
  // Default enforcement='warn' surfaces violations without blocking.
  // Service-account callers skip the gate (their userId is
  // `svc:<keyId>` and has no on-chain identity).
  if (!isServiceAccount) {
    const gate = await reputationGate({
      tenantId: body.tenantId,
      counterpartyKind: 'user',
      counterpartyUserId: body.userId,
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
  // Internal tools (channel provisioning, `request_human_handoff`, etc.)
  // are gated to trusted callers: shared-secret webhooks (no apiKey)
  // and full-scope (`*`) keys. External user-minted keys see the
  // public catalog only so prompt-injection on a third-party MCP
  // client can't escalate to operators.
  const allowInternal = !apiKey || grantedScopes.includes('*');
  const surfacedTools = allowInternal ? toolList : filterPublicTools(toolList);
  // Append `start_workflow` for trusted internal callers when the
  // turn is bound to a channel identity (i.e. a traveler thread, not
  // an operator agent-chat turn). The tool persists Session state per
  // traveler so multi-step flows can pause + auto-resume on the next
  // inbound. Lives in apps/app to keep persistence out of the
  // workspace-level tools package.
  const channelToolList =
    allowInternal && body.channelIdentityId
      ? [
          ...surfacedTools,
          buildStartWorkflowTool({
            tenantId: body.tenantId,
            channelIdentityId: body.channelIdentityId,
            channel: body.channel === 'whatsapp' || body.channel === 'slack' ? body.channel : 'web',
            userId: body.userId,
            ...(body.tripId ? { tripId: body.tripId } : {}),
            innerToolCtx: {
              traveler: {
                userId: body.userId,
                tenantId: body.tenantId,
                ...(body.travelerPhone ? { phone: body.travelerPhone } : {}),
              },
              channelIdentityId: body.channelIdentityId,
              appendTripEvent,
              resolveTripByBoardingPass,
              readTripEvents,
            },
          }),
        ]
      : surfacedTools;
  const scopedTools = filterToolsByScopes(channelToolList, grantedScopes);

  // Narrow the zod-inferred shape to the AgentMediaAttachment contract —
  // (toolCtx assembly + buildAiSdkTools call moved below the payer
  // resolution so ctx.payer can be populated from the turn-level resolve).
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

  // Canonical ledger write — inbound traveler message lands on the
  // trip's events log before the agent processes it. Skipped when the
  // caller didn't resolve a tripId (pre-trip exploration); the agent
  // may create a trip via tool calls and future messages will land
  // there. Best-effort: a Postgres blip never blocks dispatch — the
  // helper swallows errors and returns false.
  if (body.tripId && body.text) {
    const inboundChannel = ledgerChannelFromDispatchChannel(body.channel);
    if (inboundChannel) {
      await appendTripEvent({
        tripId: body.tripId,
        tenantId: body.tenantId,
        event: {
          id: `inbound_${agentInput.turnId}`,
          kind: 'inbox_reply',
          direction: 'inbound',
          channel: inboundChannel,
          createdAt: new Date().toISOString(),
          text: body.text,
          author: {
            kind: isServiceAccount ? 'system' : 'traveler',
            userId: body.userId,
          },
        },
      });
    }
  }

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

  // Resolve the per-turn payer once. Single source of truth — all
  // MeterEvent rows written this turn (chat replies, search, settle,
  // etc.) inherit this attribution; tools that resolve their own
  // payer (confirm_booking) override per-event. Service-account
  // dispatches (apiKey present, no real traveler bound) and tenants
  // configured for traveler-pay-but-no-traveler-on-this-turn fail-soft
  // to undefined → MeterEvent rows go in unattributed.
  let turnPayer: MeterPayerType | undefined;
  let turnPayerUserId: string | undefined;
  if (!isServiceAccount) {
    try {
      const resolved = await resolvePayer({
        tenantId: body.tenantId,
        tripId: body.tripId ?? undefined,
        travelerUserId: body.userId,
      });
      turnPayer = resolved.type;
      turnPayerUserId = resolved.travelerUserId ?? undefined;
    } catch (err) {
      if (
        err instanceof PayerResolutionError &&
        (err.code === 'traveler_required' || err.code === 'split_unsupported')
      ) {
        // Surfaces in analytics as `payerType IS NULL`. Don't block
        // dispatch — most legacy / pre-trip turns lack a real wallet
        // payer because they're exploratory chat, not paid actions.
        turnPayer = undefined;
      } else {
        throw err;
      }
    }
  }

  // Credit-aware meter store — routes every metered action through
  // `deductAndRecord()` so SaaS-included credits decrement off
  // `Subscription.meterBalanceMicro`. Sandbox keys still skip the
  // deduction (write 'sandbox') and tenants with no grant fall through
  // to 'paid' at full cost — backward-compatible with prior behavior.
  const dispatchSegment = await resolveSegment(body.tenantId);
  const creditMeterStore = makeCreditAwareMeterStore({
    plan: resolvePlan(planTier),
    sandbox: apiKey?.effectiveKeyType === 'sandbox',
    segment: dispatchSegment,
    defaults: {
      ...(turnPayer ? { payerType: turnPayer } : {}),
      ...(turnPayerUserId ? { payerUserId: turnPayerUserId } : {}),
    },
  });

  // Tool ctx — built here (after payer resolution) so `ctx.payer` is
  // populated for tools that read attribution without re-resolving.
  // Per-tool `provisionedBy` input still wins; this is the floor.
  const tools = buildAiSdkTools(scopedTools, {
    traveler: {
      userId: body.userId,
      tenantId: body.tenantId,
      ...(body.travelerPhone ? { phone: body.travelerPhone } : {}),
    },
    appendTripEvent,
    resolveTripByBoardingPass,
    readTripEvents,
    ...(body.channelIdentityId ? { channelIdentityId: body.channelIdentityId } : {}),
    // Caller identity flows from the API key resolver into every tool
    // handler via ctx.caller. Tools that gate on scope or key type
    // (e.g., confirm_booking's markup-override gate) read from here so
    // the LLM cannot spoof either field via tool input.
    ...(apiKey
      ? {
          caller: {
            scopes: apiKey.scopes,
            keyType: apiKey.keyType,
            effectiveKeyType: apiKey.effectiveKeyType,
          },
        }
      : {}),
    // Resolved payer for this turn — single source of truth for
    // attribution. Tools call resolvePayer themselves only when they
    // need to honor a per-call override; otherwise they read ctx.payer.
    ...(turnPayer
      ? {
          payer: {
            type: turnPayer,
            ...(turnPayerUserId ? { travelerUserId: turnPayerUserId } : {}),
          },
        }
      : {}),
  });

  // Resolve persona once — covers both the gateway attempt and any direct
  // retry below. getPromptWithFallback caches Langfuse fetches for 60s, so
  // this is one network round-trip per minute per server instance.
  const dispatchPersona = await buildAgentPersona('dispatch', agentInput.actor.locale);

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      input: agentInput,
      model: modelHandle,
      tier,
      tools,
      capStore: makeCapStore(),
      meterStore: creditMeterStore,
      sessionStore: makeSessionStore(),
      resolveSegment,
      pricingOverrides,
      loadTrip,
      persona: dispatchPersona,
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
          meterStore: creditMeterStore,
          sessionStore: makeSessionStore(),
          resolveSegment,
          pricingOverrides,
          loadTrip,
          persona: dispatchPersona,
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

    // Canonical ledger write — agent reply lands on the trip's events
    // log next to the inbound message above. Same skip-when-no-tripId
    // contract; same fail-soft posture. The pair (inbound + outbound)
    // is what makes the unified inbox thread legible to operators.
    if (body.tripId && result.text) {
      const outboundChannel = ledgerChannelFromDispatchChannel(body.channel);
      if (outboundChannel) {
        await appendTripEvent({
          tripId: body.tripId,
          tenantId: body.tenantId,
          event: {
            id: `agent_${agentInput.turnId}`,
            kind: 'agent_reply',
            direction: 'outbound',
            channel: outboundChannel,
            createdAt: new Date().toISOString(),
            text: result.text,
            author: { kind: 'agent' },
          },
        });
      }
    }
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
    ...(result.shareCards && result.shareCards.length > 0 ? { shareCards: result.shareCards } : {}),
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
 * Map a dispatch `Channel` (which includes `mcp`) to a `TripEvent`
 * channel. MCP-originated turns map to `web` for ledger purposes —
 * an MCP client is conceptually "the web", just programmatic. Returns
 * null for unknown channels so the caller skips the ledger write
 * rather than writing a malformed row.
 */
function ledgerChannelFromDispatchChannel(channel: Channel): TripEvent['channel'] | null {
  switch (channel) {
    case 'whatsapp':
    case 'slack':
    case 'email':
    case 'web':
      return channel;
    case 'mcp':
      return 'web';
    default:
      return null;
  }
}

async function readTripEvents(args: { tripId: string; tenantId: string }): Promise<TripEvent[]> {
  const trip = await prisma.trip.findFirst({
    where: { id: args.tripId, tenantId: args.tenantId },
    select: { events: true },
  });
  return Array.isArray(trip?.events) ? (trip.events as unknown as TripEvent[]) : [];
}
