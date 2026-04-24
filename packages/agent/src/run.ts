/**
 * runAgentTurn — the single entrypoint every channel calls.
 *
 * Input: channel-agnostic AgentInput + injected stores/services.
 * Output: channel-agnostic AgentOutput the adapter renders.
 *
 * Flow:
 *   1. Resolve segment + cap-check via @sendero/billing preflight
 *   2. Load / build ConversationSession (stateful sessions principle)
 *   3. Build agent context — locale slice + preferences + memory +
 *      trip snapshot + conversation history (last 6 turns injected)
 *   4. Render the LLM system prompt including the workflow catalog
 *      so the LLM can route intents to named plans
 *   5. Run generateText() bound to the @sendero/tools catalog
 *   6. Write an idempotent meter event (duplicate turnId → no-op)
 *   7. Append the new turn to the conversation session
 *   8. Return AgentOutput — no channel-specific formatting here
 *
 * Every dependency is injected so tests and alternate runtimes
 * (edge worker, MCP server) can use the same engine without pulling
 * Anthropic / Prisma imports they don't need.
 */

import type { CapStore } from '@sendero/billing/caps';
import { type MeterStore, type PreflightArgs, preflight } from '@sendero/billing/meter';
import type { BillingSegment } from '@sendero/billing/pricing';
import type { MeterStatus } from '@sendero/database';
import { getLocaleSlice } from '@sendero/locale';
import { listWorkflows } from '@sendero/workflows';
import type { LanguageModel, ToolSet } from 'ai';
import { generateText, stepCountIs } from 'ai';

import type { AgentInput, AgentOutput, AgentMediaAttachment } from './channels';
import { isMediaAttachment } from './channels';
import { buildIdempotencyKey, isDuplicateKeyError } from './idempotency';
import {
  type AgentProviderOptions,
  buildProviderOptions,
  type ModelTier,
  selectModel,
} from './models';
import { buildSystemPrompt, renderWorkflowsBlock } from './prompt';
import { appendTurn, type ConversationState, type SessionStore } from './session';

export interface TripSnapshot {
  tripId: string;
  route: string;
  departAt: string;
  status: 'planning' | 'held' | 'booked' | 'in_progress' | 'completed';
  pnr?: string | null;
  bookingRef?: string | null;
}

export interface RunAgentTurnArgs {
  input: AgentInput;
  /**
   * LLM model — either a gateway string like `'anthropic/claude-opus-4.6'`
   * (AI SDK auto-routes through Vercel AI Gateway when AI_GATEWAY_API_KEY
   * is set) OR a direct `LanguageModel` instance for local / test paths.
   */
  model: LanguageModel | string;
  /** Tier this turn uses — feeds `providerOptions.gateway.order`. */
  tier?: ModelTier;
  /** Tool catalog adapted via buildAiSdkTools. */
  tools: ToolSet;
  /** Injected stores. */
  capStore: CapStore;
  meterStore: MeterStore;
  sessionStore: SessionStore;
  /** Resolve the tenant's billing segment (consumer / agency / corporate / ai_agent). */
  resolveSegment: (tenantId: string) => Promise<BillingSegment>;
  /**
   * Optional pricing overrides, applied on top of `DEFAULT_PRICING`.
   * Dispatch passes plan-tier-discounted cells computed via
   * `@sendero/billing/plans` so the resulting MeterEvent rows bill at
   * the discounted rate.
   */
  pricingOverrides?: PreflightArgs['overrides'];
  /** Optional trip lookup. */
  loadTrip?: (args: { tripId: string; tenantId: string }) => Promise<TripSnapshot | null>;
  /** Persona string appended after the context block. */
  persona: string;
}

export interface AgentTurnResult extends AgentOutput {
  /** True when a paused workflow was resumed or a cap blocked the call. */
  blocked: boolean;
  /** Cap-check detail for observability. */
  capPeriods: Array<{
    period: 'daily' | 'monthly';
    spentMicro: bigint;
    capMicro: bigint;
    remainingMicro: bigint;
  }>;
}

export async function runAgentTurn(args: RunAgentTurnArgs): Promise<AgentTurnResult> {
  const startedAt = Date.now();
  const input = args.input;

  // 1. cap preflight
  const segment = await args.resolveSegment(input.actor.tenantId);
  const pre = await preflight(args.capStore, {
    tenantId: input.actor.tenantId,
    action: 'chat_reply',
    segment,
    overrides: args.pricingOverrides,
  });
  if (pre.blocked) {
    return {
      text:
        pre.cap.warnings[0] ??
        'Your tenant has hit its spend cap for this period. Contact your admin.',
      trail: [],
      latencyMs: Date.now() - startedAt,
      billed: false,
      blocked: true,
      capPeriods: pre.cap.periods.map(p => ({
        period: p.period,
        spentMicro: p.spentMicro,
        capMicro: p.capMicro,
        remainingMicro: p.remainingMicro,
      })),
    };
  }

  // 2. conversation session
  const existing = await args.sessionStore.getByActor({
    tenantId: input.actor.tenantId,
    subjectKey: subjectKeyFromActor(input),
  });
  const state: ConversationState = existing?.state ?? {
    turns: [],
    subjectKey: subjectKeyFromActor(input),
  };

  // 3 + 4. context + prompt
  const localeSlice = getLocaleSlice(input.actor.locale ?? null);
  const trip =
    input.actor.tripId && args.loadTrip
      ? await args.loadTrip({ tripId: input.actor.tripId, tenantId: input.actor.tenantId })
      : null;

  const workflowsBlock = renderWorkflowsBlock(
    listWorkflows().map(w => ({ id: w.id, label: w.label, description: w.description }))
  );
  const recentTurnsBlock = renderRecentTurns(state);
  const systemPrompt = buildSystemPrompt({
    persona: args.persona,
    locale: input.actor.locale,
    localeSlice: localeSliceMatchesRequestedLanguage(localeSlice.locale, input.actor.locale)
      ? localeSlice
      : null,
    channelHint: renderChannelHint(input),
    tripContext: renderTripContext(trip),
    workflowCatalog: workflowsBlock,
    recentTurns: recentTurnsBlock,
  });

  // 5. LLM turn — when `model` is a gateway string AND AI_GATEWAY_API_KEY
  //    (or VERCEL_OIDC_TOKEN) is set, AI SDK auto-routes through the
  //    Vercel AI Gateway and honors providerOptions.gateway.order for
  //    automatic fallback across providers.
  //
  //    Multimodal turns: when the user message carries attachments, we
  //    construct a multi-part user message so Gemini (or any multimodal
  //    provider) sees both the image/document and the text. We also
  //    automatically promote to the `smart` tier — OCR benefits from
  //    Pro-class reasoning on ambiguous layouts.
  const mediaAttachments = (input.attachments ?? []).filter(isMediaAttachment);
  const hasMedia = mediaAttachments.length > 0;
  const tier: ModelTier = hasMedia ? 'smart' : (args.tier ?? 'smart');
  const providerOptions: AgentProviderOptions | undefined =
    typeof args.model === 'string' ? buildProviderOptions(tier) : undefined;
  const result = hasMedia
    ? await generateText({
        model: args.model,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              ...mediaAttachments.map(toFilePart),
              ...(input.text ? [{ type: 'text' as const, text: input.text }] : []),
            ],
          },
        ],
        tools: args.tools,
        stopWhen: stepCountIs(4),
        maxRetries: 2,
        providerOptions,
      })
    : await generateText({
        model: args.model,
        system: systemPrompt,
        prompt: input.text,
        tools: args.tools,
        stopWhen: stepCountIs(4),
        maxRetries: 2,
        providerOptions,
      });

  const latencyMs = Date.now() - startedAt;
  const trail = (result.toolCalls ?? []).map(tc => ({
    toolName: tc.toolName,
    ok: true, // AI SDK already reports failed tools via the stream; we coalesce here
    latencyMs: 0,
    priceMicroUsdc: '0',
  }));

  // 6. idempotent meter write
  const idempotencyKey = buildIdempotencyKey({
    tenantId: input.actor.tenantId,
    channel: input.channel,
    turnId: input.turnId,
    eventKind: 'chat_reply',
  });
  let billed = true;
  try {
    await args.meterStore.create({
      tenantId: input.actor.tenantId,
      userId: input.actor.userId,
      toolName: 'chat_reply',
      priceMicroUsdc: pre.priceMicroUsdc,
      status: 'paid' satisfies MeterStatus,
      note: `channel=${input.channel} idem=${idempotencyKey}`,
      metadata: { channel: input.channel, idempotencyKey, turnId: input.turnId },
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      // already metered on a prior attempt — no-op, still successful
      billed = false;
    } else {
      throw err;
    }
  }

  // 7. session update
  const nextState = appendTurn(
    appendTurn(state, {
      at: new Date(startedAt).toISOString(),
      role: 'user',
      text: input.text,
      channel: input.channel,
      turnId: input.turnId,
    }),
    {
      at: new Date().toISOString(),
      role: 'agent',
      text: result.text,
      channel: input.channel,
      turnId: input.turnId,
      toolCalls: trail.map(t => ({ name: t.toolName, ok: t.ok })),
    }
  );
  await args.sessionStore.upsert({
    tenantId: input.actor.tenantId,
    userId: input.actor.userId ?? null,
    subjectKey: subjectKeyFromActor(input),
    state: nextState,
  });

  return {
    text: result.text,
    trail,
    latencyMs,
    billed,
    blocked: false,
    capPeriods: pre.cap.periods.map(p => ({
      period: p.period,
      spentMicro: p.spentMicro,
      capMicro: p.capMicro,
      remainingMicro: p.remainingMicro,
    })),
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Turn an AgentMediaAttachment into an AI SDK v6 file content part.
 * Prefers the raw URL (cheaper — Gemini fetches it server-side) and
 * falls back to inline base64 data when the adapter downloaded the
 * payload itself (e.g. WhatsApp media must be pulled with a bearer
 * token, so the URL isn't publicly fetchable).
 */
function toFilePart(attachment: AgentMediaAttachment): {
  type: 'file';
  data: string;
  mediaType: string;
  filename?: string;
} {
  const payload = attachment.url ?? attachment.data ?? '';
  if (!payload) {
    throw new Error(
      `Attachment (${attachment.kind}/${attachment.mediaType}) has neither url nor data`
    );
  }
  return {
    type: 'file',
    data: payload,
    mediaType: attachment.mediaType,
    ...(attachment.filename ? { filename: attachment.filename } : {}),
  };
}

function subjectKeyFromActor(input: AgentInput): string {
  // Simple default: channel:userId. Consumers can override via meta.subjectKey.
  const metaKey = (input.meta?.subjectKey as string | undefined) ?? null;
  return metaKey ?? `${input.channel}:${input.actor.userId}`;
}

function renderRecentTurns(state: ConversationState): string {
  if (state.turns.length === 0) return '';
  const recent = state.turns.slice(-6);
  return [
    '## Recent conversation',
    ...recent.map(t => `- ${t.role}: ${t.text.slice(0, 200)}`),
  ].join('\n');
}

function renderChannelHint(input: AgentInput): string {
  const subject = input.meta?.subjectKey ? `\n- Subject key: ${input.meta.subjectKey}` : '';
  const displayName = input.actor.displayName
    ? `\n- Traveler name: ${input.actor.displayName}`
    : '';

  const instruction =
    input.channel === 'whatsapp'
      ? 'Plain text only. Keep messages compact for mobile, one clear next action per reply.'
      : input.channel === 'slack'
        ? 'Use concise Slack mrkdwn. Preserve thread context and make approval states explicit.'
        : input.channel === 'mcp'
          ? 'Return schema-literal, auditable responses. Prefer machine-readable next actions.'
          : input.channel === 'email'
            ? 'Write clear email prose with a subject-worthy first sentence and exact trip/payment details.'
            : 'Coordinate with the web UI; do not duplicate cards already visible on screen.';

  return `- Channel: ${input.channel}
- Locale: ${input.actor.locale ?? 'unknown'}${displayName}${subject}
- Instruction: ${instruction}`;
}

function renderTripContext(trip: TripSnapshot | null): string {
  if (!trip) return '';
  return [
    `- Trip: \`${trip.tripId}\` (${trip.status})`,
    `- Route: ${trip.route}`,
    `- Departs: ${trip.departAt}`,
    trip.pnr ? `- PNR: \`${trip.pnr}\`` : '',
    trip.bookingRef ? `- Booking: \`${trip.bookingRef}\`` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function localeSliceMatchesRequestedLanguage(
  sliceLocale: string,
  requested: string | null
): boolean {
  if (!requested) return true;
  const sliceLanguage = sliceLocale.toLowerCase().split('-')[0];
  const requestedLanguage = requested.toLowerCase().split('-')[0];
  return sliceLanguage === requestedLanguage;
}
