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
import {
  agentSessionId,
  aiTelemetryConfig,
  evaluateTrace,
  flushLangfuse,
  scoreCost,
  scoreLatency,
  scoreToolSuccess,
  traceAgent,
} from '@sendero/langfuse';
import { getLocaleSlice } from '@sendero/locale';
import { listWorkflows } from '@sendero/workflows';
import type { LanguageModel, ToolSet } from 'ai';
import { generateText, stepCountIs } from 'ai';

import type { AgentInput, AgentMediaAttachment, AgentOutput } from './channels';
import { isMediaAttachment } from './channels';
import { buildIdempotencyKey, isDuplicateKeyError } from './idempotency';
import {
  type AgentProviderOptions,
  buildProviderOptions,
  type ModelTier,
  selectModel,
} from './models';
import { buildSystemPrompt, renderWorkflowsBlock } from './prompt';
import { buildSelfHealPreamble } from './self-heal';
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
  /**
   * Optional callback fired after each AI SDK step (text generation OR
   * tool call). Adapters use this for incremental UI updates — e.g.
   * the Slack adapter edits its placeholder message between tool
   * calls so users see "Searching flights…" → "Comparing options…"
   * instead of staring at "_Thinking…_" for the full turn.
   *
   * Step-based, not token-based: keeps the engine on `generateText`
   * so cap/meter/session integrity is unchanged. True token streaming
   * (post-then-edit every 750ms while generating) is a separate
   * `streamText` refactor.
   *
   * Failures are caught here — adapter audit hooks must not break the
   * agent turn.
   */
  onStepFinish?: (event: AgentStepEvent) => Promise<void> | void;
}

/**
 * Step boundary the engine surfaces to the optional `onStepFinish`
 * callback. Mirrors AI SDK's `StepResult` but in a stable shape we
 * own — adapters import this, not the AI SDK type, so an SDK upgrade
 * doesn't ripple into Slack/WhatsApp adapter code.
 */
export interface AgentStepEvent {
  /** 1-indexed step number within the turn. */
  stepNumber: number;
  /** Names of tools called in this step (empty array on text-only steps). */
  toolNames: string[];
  /** Plain-text fragment generated in this step (empty when none). */
  text: string;
  /** AI SDK's `finishReason` for this step. */
  finishReason: string;
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

  const agentType =
    input.channel === 'slack'
      ? 'sendero-slack'
      : input.channel === 'whatsapp'
        ? 'sendero-whatsapp'
        : input.channel === 'mcp'
          ? 'sendero-mcp'
          : 'sendero-conversation';

  const traced = await traceAgent(
    agentType,
    {
      tenantId: input.actor.tenantId,
      ...(input.actor.userId ? { userId: input.actor.userId } : {}),
      sessionId: agentSessionId(input.actor.tenantId, input.channel),
      surface: 'agent-turn',
      trigger: 'user',
      channel: input.channel,
      ...(input.actor.tripId ? { tripId: input.actor.tripId } : {}),
      turnId: input.turnId,
      ...(typeof args.model === 'string' ? { model: args.model } : {}),
    },
    ({ traceId }) => _runAgentTurnInner(args, startedAt, agentType, traceId)
  );

  return traced.result;
}

async function _runAgentTurnInner(
  args: RunAgentTurnArgs,
  startedAt: number,
  agentType: 'sendero-conversation' | 'sendero-slack' | 'sendero-whatsapp' | 'sendero-mcp',
  traceId: string
): Promise<AgentTurnResult> {
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
  const attachmentsHintBlock = renderAttachmentsHint(input);
  const travelDocumentHintBlock = renderTravelEligibilityHint();
  // Self-heal preamble: ask the Minions board whether a similar
  // hypothesis was resolved before. Fail-soft — returns null on
  // missing env (loop not configured), timeout, or any error. Adds at
  // most ~1.5s of latency to the turn when the seam is wired.
  const selfHealPreamble = input.text
    ? await buildSelfHealPreamble({ hypothesis: input.text })
    : null;
  const systemPrompt = buildSystemPrompt({
    persona: args.persona,
    selfHealPreamble: selfHealPreamble ?? undefined,
    locale: input.actor.locale,
    localeSlice: localeSliceMatchesRequestedLanguage(localeSlice.locale, input.actor.locale)
      ? localeSlice
      : null,
    channelHint: renderChannelHint(input),
    tripContext: renderTripContext(trip),
    workflowCatalog: workflowsBlock,
    recentTurns: recentTurnsBlock,
    attachmentsHint: attachmentsHintBlock,
    travelDocumentHint: travelDocumentHintBlock,
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
  // Wrap caller's `onStepFinish` so AI SDK errors in the listener
  // never bubble out of the engine. The adapter audit hooks are
  // optional UX — the agent turn must keep running even if a Slack
  // chat.update fails mid-stream.
  let stepCounter = 0;
  const adaptedOnStepFinish = args.onStepFinish
    ? async (step: {
        text?: string;
        toolCalls?: Array<{ toolName: string }>;
        finishReason: string;
      }) => {
        stepCounter += 1;
        try {
          await args.onStepFinish?.({
            stepNumber: stepCounter,
            toolNames: (step.toolCalls ?? []).map(tc => tc.toolName),
            text: step.text ?? '',
            finishReason: step.finishReason,
          });
        } catch (err) {
          console.error('[agent.run] onStepFinish hook failed (non-fatal)', {
            stepNumber: stepCounter,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    : undefined;

  const telemetry = aiTelemetryConfig(agentType, {
    tenantId: input.actor.tenantId,
    ...(input.actor.userId ? { userId: input.actor.userId } : {}),
    sessionId: agentSessionId(input.actor.tenantId, input.channel),
    surface: 'agent-turn',
    trigger: 'user',
    channel: input.channel,
    ...(input.actor.tripId ? { tripId: input.actor.tripId } : {}),
    turnId: input.turnId,
    ...(typeof args.model === 'string' ? { model: args.model } : {}),
    scope: 'run-agent-turn',
  });

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
        experimental_telemetry: telemetry,
        ...(adaptedOnStepFinish ? { onStepFinish: adaptedOnStepFinish } : {}),
      })
    : await generateText({
        model: args.model,
        system: systemPrompt,
        prompt: input.text,
        tools: args.tools,
        stopWhen: stepCountIs(4),
        maxRetries: 2,
        providerOptions,
        experimental_telemetry: telemetry,
        ...(adaptedOnStepFinish ? { onStepFinish: adaptedOnStepFinish } : {}),
      });

  const latencyMs = Date.now() - startedAt;
  // AI SDK v6 surfaces tool calls + results inside `result.steps[*]`,
  // not at the top level (the top-level `result.toolCalls` /
  // `result.toolResults` are empty arrays in the shape we get back).
  // Aggregate from the steps array so the trail + share-card capture
  // work regardless of which AI SDK minor version is in flight.
  const aggregatedToolCalls = aggregateStepToolCalls(result);
  const aggregatedToolResults = aggregateStepToolResults(result);
  const trail = aggregatedToolCalls.map(tc => ({
    toolName: tc.toolName,
    ok: true, // AI SDK already reports failed tools via the stream; we coalesce here
    latencyMs: 0,
    priceMicroUsdc: '0',
  }));
  // Capture share-card payloads from tool results so adapters can
  // render native interactive elements (WhatsApp interactive buttons,
  // Slack block kit) instead of stringifying the agent's prose
  // summary. Tools opt in by returning `{ ..., share: { title, body,
  // bullets?, primaryCta?, secondaryCtas?, imageUrl? } }`.
  const shareCards = collectShareCards(aggregatedToolResults);

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
  //
  // Defense against past-turn poisoning: if this turn had a tool error
  // AND emitted no share cards (i.e. nothing user-visible succeeded),
  // persist a sanitized agent marker instead of the apology prose.
  // The full apology text would otherwise leak into the next turn's
  // `## Recent conversation` block and the model would condition on
  // it ("the system is down, escalate") instead of retrying. The
  // marker preserves audit ("this turn errored") without poisoning
  // the next turn's prompt.
  const stepsHadError = aggregatedToolResultsHadError(result);
  const noUserVisibleWin = (shareCards?.length ?? 0) === 0;
  const persistedAgentText =
    stepsHadError && noUserVisibleWin
      ? '[turn errored — no user-visible result, retried on next message]'
      : result.text;
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
      text: persistedAgentText,
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

  // 8. fire-and-forget Langfuse scoring + LLM-judge eval + flush.
  //    Must never extend the turn's wall-clock or block the channel
  //    adapter from sending its reply. Errors are swallowed inside
  //    each helper. evaluateTrace is no-op unless LANGFUSE_EVALUATORS=true.
  const toolContextSummary = trail.length
    ? trail.map(t => `- ${t.toolName} (${t.ok ? 'ok' : 'failed'})`).join('\n')
    : undefined;
  void Promise.resolve().then(async () => {
    try {
      await scoreLatency(traceId, latencyMs);
      await scoreCost(traceId, pre.priceMicroUsdc);
      await scoreToolSuccess(
        traceId,
        trail.map(t => ({ success: t.ok, toolName: t.toolName }))
      );
      if (result.text && result.text.trim().length > 0) {
        await evaluateTrace({
          traceId,
          input: input.text,
          output: result.text,
          ...(toolContextSummary ? { context: toolContextSummary } : {}),
        });
      }
      await flushLangfuse();
    } catch (err) {
      // never throw out of fire-and-forget
      console.warn('[agent.run] Langfuse scoring/flush failed (non-fatal)', err);
    }
  });

  return {
    text: result.text,
    trail,
    latencyMs,
    billed,
    blocked: false,
    ...(shareCards.length > 0 ? { shareCards } : {}),
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
 * True when any AI SDK step contained a `tool-error` content block —
 * i.e. the runtime caught a tool throw and reported it back to the
 * model. Used to decide whether to persist the agent's reply text in
 * the conversation history; a turn that ended in apology over a
 * tool failure shouldn't leak that apology into future prompts.
 */
function aggregatedToolResultsHadError(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const steps = (result as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return false;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c && typeof c === 'object' && (c as { type?: unknown }).type === 'tool-error') {
        return true;
      }
    }
  }
  return false;
}

/**
 * Pull every `toolCall` from `result.steps[*]` into a single flat
 * list. AI SDK v6's `generateText` returns `result.steps` with the
 * per-step tool calls; the top-level `result.toolCalls` is empty in
 * the shape we get back. Returns minimal `{ toolName }` shape — the
 * trail aggregator only reads the name.
 */
function aggregateStepToolCalls(result: unknown): Array<{ toolName: string }> {
  if (!result || typeof result !== 'object') return [];
  const steps = (result as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const out: Array<{ toolName: string }> = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const calls = (step as { toolCalls?: unknown }).toolCalls;
    if (!Array.isArray(calls)) continue;
    for (const c of calls) {
      const name = (c as { toolName?: unknown })?.toolName;
      if (typeof name === 'string') out.push({ toolName: name });
    }
  }
  return out;
}

/**
 * Pull every `toolResult` from `result.steps[*]` into a single flat
 * list. Used to feed `collectShareCards` so share payloads emitted by
 * tools (search_flights, hold, book_flight, cancel_order_quote, etc.)
 * surface as native interactive cards on every adapter.
 */
function aggregateStepToolResults(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return [];
  const steps = (result as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  const out: unknown[] = [];
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    const results = (step as { toolResults?: unknown }).toolResults;
    if (!Array.isArray(results)) continue;
    out.push(...results);
  }
  return out;
}

/**
 * Extract cross-channel share-card payloads from the AI SDK turn's
 * tool results. Tools opt-in by returning `{ share: { ... } }` in
 * their result; everything without a `share` field is ignored. The
 * returned list is in tool-call order so adapters can render in
 * sequence.
 */
function collectShareCards(toolResults: unknown): NonNullable<AgentOutput['shareCards']> {
  if (!Array.isArray(toolResults)) return [];
  const out: NonNullable<AgentOutput['shareCards']> = [];
  for (const entry of toolResults) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const toolName = typeof record.toolName === 'string' ? record.toolName : null;
    if (!toolName) continue;
    // AI SDK v6 surfaces tool returns under `output`; older shapes used
    // `result`. Tolerate both so a runtime upgrade can't strand cards.
    const output = (record.output ?? record.result) as Record<string, unknown> | undefined;
    if (!output || typeof output !== 'object') continue;
    const share = (output as { share?: unknown }).share;
    if (!share || typeof share !== 'object' || Array.isArray(share)) continue;
    const s = share as Record<string, unknown>;
    if (typeof s.title !== 'string' || typeof s.body !== 'string') continue;
    // Optional first-class activation payload — picked up when the
    // tool emits a structured `esim_activation`-shaped card. Validated
    // structurally so a malformed entry (missing field, wrong type)
    // degrades to share-only rather than producing a broken card.
    const activation = extractActivation(output);

    out.push({
      toolName,
      share: {
        title: s.title,
        body: s.body,
        ...(Array.isArray(s.bullets) && s.bullets.every(b => typeof b === 'string')
          ? { bullets: s.bullets as string[] }
          : {}),
        ...(isCta(s.primaryCta)
          ? { primaryCta: s.primaryCta as { label: string; kind: string } }
          : {}),
        ...(Array.isArray(s.secondaryCtas) && s.secondaryCtas.every(isCta)
          ? { secondaryCtas: s.secondaryCtas as Array<{ label: string; kind: string }> }
          : {}),
        ...(typeof s.imageUrl === 'string' ? { imageUrl: s.imageUrl } : {}),
      },
      ...(activation ? { activation } : {}),
    });
  }
  return out;
}

/**
 * Pull a structured `activation` payload off a tool output, if present.
 * Returns `null` when any required field is missing or wrong-typed —
 * channel orchestrators then fall through to the generic `share` card.
 */
function extractActivation(
  output: Record<string, unknown>
): NonNullable<NonNullable<AgentOutput['shareCards']>[number]['activation']> | null {
  const a = (output as { activation?: unknown }).activation;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const r = a as Record<string, unknown>;
  if (typeof r.esimId !== 'string') return null;
  if (typeof r.planLabel !== 'string') return null;
  if (typeof r.qrUrl !== 'string') return null;
  if (typeof r.lpaCode !== 'string') return null;
  if (typeof r.installUrl !== 'string') return null;
  if (typeof r.dataMb !== 'number') return null;
  if (typeof r.validityDays !== 'number') return null;
  if (!Array.isArray(r.countries) || !r.countries.every(c => typeof c === 'string')) return null;
  return {
    esimId: r.esimId,
    planLabel: r.planLabel,
    countries: r.countries as string[],
    dataMb: r.dataMb,
    validityDays: r.validityDays,
    qrUrl: r.qrUrl,
    lpaCode: r.lpaCode,
    installUrl: r.installUrl,
    ...(typeof r.priceLine === 'string' ? { priceLine: r.priceLine } : {}),
    ...(typeof r.expiresAt === 'string' ? { expiresAt: r.expiresAt } : {}),
  };
}

function isCta(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as Record<string, unknown>;
  return typeof r.label === 'string' && typeof r.kind === 'string';
}

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

/**
 * When the traveler attaches a PDF or image, tell the model to pull
 * structured fields with `scan_document` before replying — instead of
 * describing the attachment in prose. The tool accepts inline base64 +
 * mediaType, which is exactly what the adapter just downloaded, so the
 * round-trip stays cheap.
 */
/**
 * Proactively nudge the agent to call `check_travel_eligibility` on
 * international trips, and to ask for the traveler's nationality +
 * passport expiry conversationally when neither is on file.  Keeping
 * the nudge short — the tool itself is what does the work.  The
 * important line is the fast-path: don't block on a passport upload
 * if we can ship a valid verdict off self-declared info.
 */
function renderTravelEligibilityHint(): string {
  return [
    '## Travel document eligibility',
    '',
    'Before confirming any cross-border booking, call `check_travel_eligibility` with the traveler + trip. The verdict tells you whether the traveler is cleared (ok), needs a nudge (warn), or the trip should be blocked (block).',
    '',
    'Fast path: if the traveler hasn\'t told us their nationality + passport expiry, ask conversationally ("which passport are you travelling on — US, UK, …?" and "what month does it expire?"). Save them from uploading a document just to quote a trip. The dashboard onboarding card persists this for us — `check_travel_eligibility` will pick it up next turn.',
    '',
    'Only ask the traveler to upload a passport (`upload_passport_to_proceed` action) when the verdict actually requires it — usually a visa-required corridor, expiry inside 12 months of return, or a high-value trip. Never ask preemptively.',
    '',
    'Verdicts carry enum reason codes, not free-form copy. Render them through the UI; never quote the codes back to the traveler verbatim.',
  ].join('\n');
}

function renderAttachmentsHint(input: AgentInput): string {
  const media = (input.attachments ?? []).filter(isMediaAttachment);
  if (media.length === 0) return '';
  const manifest = media
    .map((m, i) => `  ${i + 1}. ${m.kind}/${m.mediaType}${m.filename ? ` (${m.filename})` : ''}`)
    .join('\n');
  return [
    `The traveler attached ${media.length} document${media.length === 1 ? '' : 's'}:`,
    manifest,
    '',
    'Default behavior: call `scan_document_auto` on each attachment. The tool runs Gemini classification + extraction in one shot, so you do NOT have to know the document kind ahead of time. Pass the same `data + mediaType` (or `documentUrl`) you see on the turn.',
    '',
    'Decision rules after the tool returns:',
    '- `detectedKind === "id_document"` → the traveler\'s passport vault is updated automatically when they\'re signed in (`vaultSaved` is set). Confirm in one short line ("Saved your passport — nationality USA, expires 2030-04-12.") and offer the next action (continue booking, ask for missing fields).',
    '- `detectedKind === "invoice" | "receipt" | "boarding_pass"` → the structured fields are in `extraction.data`. Confirm what you extracted in one line and offer the next useful action (log as expense, reconcile to trip, verify PNR). Never transcribe the full extraction back — the UI already renders a card.',
    '- `detectedKind === "unknown"` or `classifierConfidence < 0.55` → ask the traveler to clarify what the document is rather than guessing.',
    '',
    'When you ALREADY know the kind from context (the user said "here\'s the receipt"), prefer the cheaper `scan_document` with the explicit `kind` to skip the classifier round-trip. Otherwise default to `scan_document_auto`.',
    '',
    'One short sentence like "Reading that document…" is enough before the tool call — never describe the attachment in prose without first running a scanner.',
  ].join('\n');
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
