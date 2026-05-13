/**
 * Slack agent loop — single entrypoint the webhook routes call.
 *
 * Wires Sendero's channel-agnostic `runAgentTurn` engine
 * (`@sendero/agent`) to the Slack-specific surface:
 *   - Tools = Sendero's canonical `toolList` (flights, hotels, escrow,
 *     settlement, …) + `senderoSlackTools(install)` (8 bot-token-only
 *     Slack actions: send / schedule / canvas / read channel / read
 *     thread / read user profile / join / delete).
 *   - Persona is injected as the agent system prompt; the engine
 *     concatenates it with locale + recent-turns context.
 *   - The agent's final reply is posted back into the originating
 *     thread via `chat.postMessage` keyed on (channelId, threadTs).
 *
 * Multi-tenancy: every public field on `install` is per-tenant (botToken,
 * teamId, tenantId, routing). `senderoSlackTools(install)` instantiates a
 * fresh `WebClient(install.botToken)` per call, so two parallel turns
 * from different tenants never share a Slack client.
 *
 * Approval flow: tools that mutate the workspace
 * (`slack_send_message`, `slack_create_canvas`, `slack_join_channel`,
 * `slack_delete_message`) are gated via the AI SDK's `needsApproval`
 * mechanism inside `senderoSlackTools`. When the LLM picks one of these,
 * the AI SDK emits a `tool-approval-request` step instead of executing.
 * The corporate-travel approval card primitives in `./approval`
 * (`sendApprovalRequest`, `parseApprovalAction`) are the click-resume
 * substrate; today they're tied to trip/booking shape, so a follow-up
 * generalizes them for Slack-action approvals (see TODO below).
 */

import type { ToolSet } from 'ai';

import {
  type AgentInput,
  type AgentMediaAttachment,
  type ConversationState,
  runAgentTurn,
  type RunAgentTurnArgs,
  type SessionStore,
} from '@sendero/agent';
import { buildSlackPersonaWithContext } from '@/lib/agent-persona';
import type { CapStore } from '@sendero/billing/caps';
import type { MeterStore } from '@sendero/billing/meter';
import type { BillingSegment } from '@sendero/billing/pricing';
import { toolList } from '@sendero/tools';
import { buildAiSdkTools } from '@sendero/tools/adapters/ai-sdk';

import { createSlackClient, type SlackEventEnvelope } from '@sendero/slack';

import {
  gatewayErrorAllowsDirectRetry,
  resolveDirectModels,
  resolveModel,
  type ModelTier,
} from './agent-models';
import { persistLobsterTrapAlerts, type LobsterTrapInspectionReport } from './lobstertrap';
import { senderoSlackTools } from './slack-agent-tools';
import { markThreadSubscribed } from './slack-thread-subscription';
import { appendTripEvent, resolveActiveTripForUser } from './trip-events';

/**
 * Persisted Slack install — superset of OAuth's `SlackInstall` plus the
 * Prisma-only fields the consuming app stores. Kept structural so we
 * don't import `@prisma/client` in this package (the `@sendero/database`
 * package owns that dependency).
 */
export interface PersistedSlackInstall {
  /** Tenant binding — set when the OAuth callback writes the row. */
  tenantId: string;
  enterpriseId: string | null;
  teamId: string;
  teamName: string;
  botUserId: string;
  botToken: string;
  scope: string;
  isEnterpriseInstall: boolean;
  authedUserId: string;
  /** Channel routing config from the Slack setup wizard. Null when unset. */
  routing?: SlackRoutingConfig | null;
}

/**
 * Channel routing config persisted on `SlackInstall.routing`.
 *
 * Shape (set by the channel setup wizard):
 *   { defaultChannel: string,
 *     routes: Array<{ eventClass: string, channel: string, mode: 'silent' | 'thread' | 'broadcast' }> }
 *
 * Null means "no rules configured" — fall back to whatever channel
 * the inbound event arrived on (the working assumption Slack uses
 * everywhere else: reply where you were addressed).
 */
export interface SlackRoutingConfig {
  defaultChannel?: string;
  routes?: Array<{ eventClass: string; channel: string; mode?: 'silent' | 'thread' | 'broadcast' }>;
}

export interface RunSlackAgentTurnArgs {
  /** Loaded `SlackInstall` row — owns botToken + tenant binding + routing. */
  install: PersistedSlackInstall;
  /** Top-level Slack envelope from the webhook (used for trace + tenant key). */
  envelope: SlackEventEnvelope;
  /** User-facing event text — mention body, slash command body, etc. */
  text: string;
  /**
   * Optional inbound media (Slack `event.files[]` after fetch + base64).
   * Forwarded to the agent runtime as multimodal file parts so the model
   * can run `scan_document_auto` on the attachment without needing to
   * resolve a Slack file URL itself.
   */
  attachments?: AgentMediaAttachment[];
  /** Thread to reply into. For top-level mentions Slack returns the message ts. */
  threadTs: string;
  /** Originating Slack channel (`C…`). */
  channelId: string;
  /** The Slack user (`U…`) that triggered the event. */
  userId: string;
  /** Sendero User id mapped from the Slack user (resolver lives in the consuming app). */
  senderoUserId: string;
  /** Optional per-tenant locale (BCP-47). */
  locale?: string;
  /** Optional channel name for richer context. */
  channelName?: string;
  /** Optional org name surfaced in the system prompt for grounding. */
  orgName?: string;
  /** Plan tier label — surfaced verbatim in the persona. */
  planTier?: string;
  /**
   * AI SDK model handle. Optional — when omitted, the function resolves the
   * model via `resolveModel(tier)` from `@/lib/agent-models`, which honors
   * the canonical Sendero policy:
   *
   *   1. Gateway-first (Gemini-first via `providerOptions.gateway.order =
   *      google → anthropic → openai`).
   *   2. Direct-provider fallback in the same cascade order on gateway-wide
   *      failure (see `gatewayErrorAllowsDirectRetry`).
   *
   * Pass an explicit model only for tests or one-off overrides — production
   * callers should NOT pin a single provider/model.
   */
  model?: RunAgentTurnArgs['model'];
  /** Tier hint for `runAgentTurn` + the model resolver. Defaults to `smart`. */
  tier?: RunAgentTurnArgs['tier'];
  /** Injected stores — same shapes as `apps/app/api/agent/dispatch`. */
  capStore: CapStore;
  meterStore: MeterStore;
  sessionStore: SessionStore;
  resolveSegment: (tenantId: string) => Promise<BillingSegment>;
  pricingOverrides?: RunAgentTurnArgs['pricingOverrides'];
  loadTrip?: RunAgentTurnArgs['loadTrip'];
}

export interface RunSlackAgentTurnResult {
  text: string;
  postedTs?: string;
  blocked: boolean;
  trail: Array<{ toolName: string; ok: boolean; latencyMs: number; priceMicroUsdc: string }>;
  meterEvents: Array<{ toolName: string; ok: boolean; priceMicroUsdc: string }>;
  latencyMs: number;
}

/**
 * Run a single Slack agent turn end-to-end.
 *
 * Steps:
 *   1. Build merged tool registry — Sendero tools (filtered to '*' scope,
 *      same default the dispatch route uses for shared-secret callers) +
 *      Slack tools bound to `install.botToken`.
 *   2. Compose a Slack-flavored persona over `SENDERO_SOUL` (org + plan +
 *      channel + routing context) so the LLM knows it's posting in Slack.
 *   3. Hand off to `runAgentTurn` — it owns cap preflight, session
 *      lookup, prompt building, the actual LLM call, idempotent meter
 *      writes, and session updates.
 *   4. Post the agent's final text back into the thread via
 *      `chat.postMessage(channel, thread_ts)`.
 *   5. Surface meter events for the caller to log; the dispatch path
 *      already persists them inside `runAgentTurn`.
 */
export async function runSlackAgentTurn(
  args: RunSlackAgentTurnArgs
): Promise<RunSlackAgentTurnResult> {
  const slackTools = senderoSlackTools(args.install);
  const senderoTools = buildAiSdkTools(toolList, {
    traveler: {
      tenantId: args.install.tenantId,
      userId: args.senderoUserId,
    },
  });

  // Slack tool names are stable / namespaced (`slack_*`), so a flat merge
  // is collision-free against `@sendero/tools` (none of which use that
  // prefix). Slack tools take precedence on any future overlap.
  const tools: ToolSet = { ...senderoTools, ...slackTools };

  const persona = await buildSlackPersonaWithContext(
    {
      orgName: args.orgName ?? args.install.teamName,
      planTier: args.planTier,
      channelName: args.channelName,
      channelId: args.channelId,
      routingPreamble: renderSlackRoutingPreamble(args.install.routing ?? null),
    },
    args.locale ?? null
  );

  const turnId = args.envelope.event_id ?? `slack:${args.envelope.team_id}:${Date.now()}`;
  const input: AgentInput = {
    actor: {
      tenantId: args.install.tenantId,
      userId: args.senderoUserId,
      ...(args.locale ? { locale: args.locale } : {}),
    },
    channel: 'slack',
    text: args.text,
    turnId,
    ...(args.attachments && args.attachments.length > 0 ? { attachments: args.attachments } : {}),
    meta: {
      // Channel-agnostic subjectKey for stateful sessions: thread-scoped
      // so a single Slack user has separate context per thread.
      subjectKey: `slack:${args.install.teamId}:${args.channelId}:${args.threadTs}`,
      slack: {
        teamId: args.install.teamId,
        enterpriseId: args.install.enterpriseId ?? null,
        channelId: args.channelId,
        threadTs: args.threadTs,
        slackUserId: args.userId,
      },
    },
  };

  // Resolve the model via the canonical policy (Gemini-first gateway →
  // direct-provider cascade) unless the caller explicitly pins one.
  // NEVER hardcode a single model here — the gateway IS the redundancy.
  const tier: ModelTier = args.tier ?? 'smart';
  const lobsterTrapReports: LobsterTrapInspectionReport[] = [];
  const lobsterTrapContext = {
    tenantId: args.install.tenantId,
    userId: args.senderoUserId,
    channel: 'slack',
    turnId,
    authMode: 'internal' as const,
    x402: false,
    onReport: (report: LobsterTrapInspectionReport) => {
      lobsterTrapReports.push(report);
    },
  };
  const initialModel = args.model ?? resolveModel(tier, lobsterTrapContext);
  if (!initialModel) {
    throw new Error(
      'No AI model available — set AI_GATEWAY_API_KEY (preferred) or one of ' +
        'GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY.'
    );
  }

  // Post a "thinking" placeholder up front so the user sees the bot
  // engage immediately. Cold turns can take 5–20s; without this the
  // thread looks dead until the model finishes. We `chat.update` the
  // same `ts` once the reply is ready — Slack treats edits as silent
  // (no re-notify), so this is purely UX and never spams.
  //
  // Step-based streaming: between tool calls we narrate progress
  // ("Searching flights…" → "Comparing options…") so the user sees
  // the bot working. This is *step* streaming, not token streaming;
  // the placeholder edits once per AI SDK step (typically 1–4 per
  // turn). True per-token streaming would require swapping
  // `generateText` → `streamText` in `@sendero/agent::run.ts` (shared
  // with dispatch + chat) — separate ~4d refactor, intentionally
  // deferred.
  //
  // Fail-soft: if the placeholder post itself fails (network blip,
  // revoked token), we just skip the edit later and post the final
  // reply fresh.
  const slack = createSlackClient(args.install.botToken);
  let placeholderTs: string | null = null;
  try {
    const placeholder = await slack.chat.postMessage({
      channel: args.channelId,
      thread_ts: args.threadTs,
      text: '_Thinking…_',
      mrkdwn: true,
      unfurl_links: false,
    });
    placeholderTs = placeholder.ts ?? null;
  } catch (err) {
    console.warn('[slack.agent] placeholder post failed; falling back to single-shot post', {
      teamId: args.install.teamId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Step-streaming hook: when AI SDK finishes a step (text gen or
  // tool call), update the placeholder so the user sees progress.
  // We accumulate all text-only fragments into `runningText` so the
  // partial reply grows toward the final answer without us having
  // to wait for the whole turn to complete.
  //
  // chat.update rate limit (Tier 3, 50/min per workspace) is not a
  // concern here — turns rarely exceed 4 steps so we'll never hit it.
  let runningText = '';
  let lastStatus = '';
  const onStepFinish = placeholderTs
    ? async (step: { stepNumber: number; toolNames: string[]; text: string }) => {
        if (step.text) runningText += step.text;
        const status = renderStepStatus(step, tools, runningText);
        // Skip the round-trip when the rendered status matches the last
        // one we sent — Slack treats identical edits as no-ops anyway,
        // but cheaper to skip the whole API call.
        if (status === lastStatus) return;
        lastStatus = status;
        try {
          await slack.chat.update({
            channel: args.channelId,
            ts: placeholderTs!,
            text: status,
          });
        } catch (updateErr) {
          // Edit failed (channel closed, bot kicked between steps). The
          // final post-turn write below still tries — log + move on.
          console.warn('[slack.agent] step update failed (non-fatal)', {
            stepNumber: step.stepNumber,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          });
        }
      }
    : undefined;

  // Canonical ledger write — inbound traveler message. Resolved trip
  // is the most-recent active one for this Sendero user. When null
  // (no in-flight trip), the write is skipped; the agent still runs
  // and may create a trip via tool calls. Same fail-soft posture as
  // the dispatch route's path.
  const tripIdForLedger = await resolveActiveTripForUser({
    tenantId: args.install.tenantId,
    userId: args.senderoUserId,
  });
  if (tripIdForLedger && args.text) {
    await appendTripEvent({
      tripId: tripIdForLedger,
      tenantId: args.install.tenantId,
      event: {
        id: `inbound_${turnId}`,
        kind: 'inbox_reply',
        direction: 'inbound',
        channel: 'slack',
        createdAt: new Date().toISOString(),
        text: args.text,
        author: {
          kind: 'traveler',
          slackUserId: args.userId,
          userId: args.senderoUserId,
        },
      },
    });
  }

  let result: Awaited<ReturnType<typeof runAgentTurn>>;
  try {
    result = await runAgentTurn({
      input,
      model: initialModel,
      tier,
      tools,
      capStore: args.capStore,
      meterStore: args.meterStore,
      sessionStore: args.sessionStore,
      resolveSegment: args.resolveSegment,
      ...(args.pricingOverrides ? { pricingOverrides: args.pricingOverrides } : {}),
      ...(args.loadTrip ? { loadTrip: args.loadTrip } : {}),
      persona,
      ...(onStepFinish ? { onStepFinish } : {}),
    });
  } catch (err) {
    // Gateway-wide failure → cascade to direct providers in
    // google → anthropic → openai order. Match dispatch route's policy
    // exactly so customers see consistent fallback regardless of channel.
    const retryModels = gatewayErrorAllowsDirectRetry(err) ? resolveDirectModels(tier) : [];
    if (retryModels.length === 0) throw err;
    let retryErr: unknown = null;
    let retryResult: Awaited<ReturnType<typeof runAgentTurn>> | null = null;
    for (const candidate of retryModels) {
      try {
        // eslint-disable-next-line no-console
        console.warn(`[slack.agent] gateway failed; retrying direct provider ${candidate.label}`);
        retryResult = await runAgentTurn({
          input,
          model: candidate.model,
          tier,
          tools,
          capStore: args.capStore,
          meterStore: args.meterStore,
          sessionStore: args.sessionStore,
          resolveSegment: args.resolveSegment,
          ...(args.pricingOverrides ? { pricingOverrides: args.pricingOverrides } : {}),
          ...(args.loadTrip ? { loadTrip: args.loadTrip } : {}),
          persona,
          ...(onStepFinish ? { onStepFinish } : {}),
        });
        break;
      } catch (innerErr) {
        retryErr = innerErr;
      }
    }
    if (!retryResult) throw retryErr ?? err;
    result = retryResult;
  }

  // Surface meter events at debug level — the engine already persisted
  // them via the injected meterStore, this is just for the adapter's
  // own observability.
  const meterEvents = result.trail.map(t => ({
    toolName: t.toolName,
    ok: t.ok,
    priceMicroUsdc: t.priceMicroUsdc,
  }));
  if (meterEvents.length > 0) {
    // eslint-disable-next-line no-console
    console.debug(
      `[slack.agent] tenant=${args.install.tenantId} turn=${turnId} ` +
        `tools=[${meterEvents.map(m => m.toolName).join(',')}]`
    );
  }

  await persistLobsterTrapAlerts({
    tenantId: args.install.tenantId,
    reports: lobsterTrapReports,
    context: lobsterTrapContext,
  });

  // Surface tool-emitted share cards as native Block Kit cards in the
  // thread BEFORE the agent's text reply. Each share renders through
  // the canonical channel-render layer so the card is visually
  // primary; the agent's prose follow-up is the commentary. Failures
  // here are non-fatal — the text reply still posts.
  if (result.shareCards && result.shareCards.length > 0) {
    try {
      const { dispatchAgentShareCardsSlack } = await import('@/lib/channel-send');
      const cardResult = await dispatchAgentShareCardsSlack({
        install: args.install,
        channel: args.channelId,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
        cards: result.shareCards,
        idPrefix: `tr_${turnId}`,
      });
      for (const skip of cardResult.skipped) {
        console.warn('[slack.agent] share-card send skipped', skip);
      }
    } catch (err) {
      console.warn('[slack.agent] share-card render failed (non-fatal)', {
        teamId: args.install.teamId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Post the agent's final reply into the originating thread. We always
  // thread (`thread_ts`) — never broadcast — so noisy channels don't
  // turn into a top-level firehose. If we already posted a "Thinking…"
  // placeholder, edit it in place (silent); otherwise post fresh.
  let postedTs: string | undefined;
  if (result.text && result.text.trim().length > 0) {
    if (placeholderTs) {
      try {
        await slack.chat.update({
          channel: args.channelId,
          ts: placeholderTs,
          text: result.text,
          // `mrkdwn` only applies on `chat.postMessage`; edits inherit
          // the original message's parse mode, so it's not in the
          // `chat.update` arg type.
        });
        postedTs = placeholderTs;
      } catch (err) {
        // Edit failed (rare — channel closed, bot kicked between
        // placeholder + final). Fall back to a fresh post so the user
        // still sees the answer.
        console.warn('[slack.agent] chat.update on placeholder failed; posting fresh', {
          teamId: args.install.teamId,
          placeholderTs,
          error: err instanceof Error ? err.message : String(err),
        });
        const posted = await slack.chat.postMessage({
          channel: args.channelId,
          thread_ts: args.threadTs,
          text: result.text,
          mrkdwn: true,
          unfurl_links: false,
        });
        postedTs = posted.ts ?? undefined;
      }
    } else {
      const posted = await slack.chat.postMessage({
        channel: args.channelId,
        thread_ts: args.threadTs,
        text: result.text,
        mrkdwn: true,
        unfurl_links: false,
      });
      postedTs = posted.ts ?? undefined;
    }
  } else if (placeholderTs) {
    // Empty result (e.g. tool-approval pause). Replace the
    // "Thinking…" placeholder with a neutral state so the thread isn't
    // left with a dangling spinner-emoji message.
    try {
      await slack.chat.update({
        channel: args.channelId,
        ts: placeholderTs,
        text: '_Working on it — I may need approval before continuing._',
      });
    } catch {
      // Best-effort; no-op on failure.
    }
  }

  // TODO(slack-approval): When the LLM picked a `needsApproval`-gated
  // Slack tool, the AI SDK pauses with a `tool-approval-request` step
  // and `result.text` may be empty (or a "I want to do X — approve?"
  // narration). The corporate-travel approval helpers in `./approval`
  // are tied to trip/booking shape today; a follow-up generalizes them
  // so we can render an Approve/Reject card for arbitrary Slack tool
  // calls and resume the turn from the existing interactions handler.
  // For now the user simply sees the LLM's narration in the thread.

  // Mark the thread subscribed so follow-up messages in the same
  // thread (no fresh @-mention needed) trigger the agent. Fire-and-
  // forget — a Redis blip shouldn't block the return path.
  if (postedTs && args.channelId && args.threadTs) {
    void markThreadSubscribed({
      teamId: args.install.teamId,
      channelId: args.channelId,
      threadTs: args.threadTs,
    });
  }

  // Canonical ledger write — agent reply. Lands next to the inbound
  // event written above so the operator sees the full thread on the
  // trip inbox view. Skipped when no trip resolved or empty reply.
  if (tripIdForLedger && result.text && result.text.trim().length > 0) {
    await appendTripEvent({
      tripId: tripIdForLedger,
      tenantId: args.install.tenantId,
      event: {
        id: `agent_${turnId}`,
        kind: 'agent_reply',
        direction: 'outbound',
        channel: 'slack',
        createdAt: new Date().toISOString(),
        text: result.text,
        author: { kind: 'agent' },
      },
    });
  }

  return {
    text: result.text,
    ...(postedTs ? { postedTs } : {}),
    blocked: result.blocked,
    trail: result.trail,
    meterEvents,
    latencyMs: result.latencyMs,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

/**
 * Render a "step in progress" status for the placeholder edit.
 *
 * If the step finished with text (final-answer step), surface the
 * accumulated `runningText` so the user sees the answer growing.
 *
 * If the step ran tools, narrate which ones — operators should see
 * "🔎 Searching flights, hotels…" between calls instead of a static
 * "_Thinking…_". Sendero's tool catalog is large; we map the common
 * verbs but fall through to the literal tool name on miss so new
 * tools render readably without code changes here.
 */
function renderStepStatus(
  step: { stepNumber: number; toolNames: string[]; text: string },
  _tools: ToolSet,
  runningText: string
): string {
  // Final-answer-shape step: surface the partial answer so the user
  // can start reading. Add a faint trailing ellipsis so they know
  // there's more coming if the engine continues.
  if (runningText.trim().length > 0) {
    return `${runningText}\n\n_…_`;
  }
  if (step.toolNames.length === 0) {
    return '_Thinking…_';
  }
  const verbs = step.toolNames.map(toolNameToVerb);
  // Dedup adjacent identical verbs ("Searching" + "Searching" → "Searching")
  const unique = Array.from(new Set(verbs));
  return `🔎 ${unique.join(', ')}…`;
}

function toolNameToVerb(toolName: string): string {
  // High-traffic tools get a friendly verb; everything else falls
  // through to the literal tool name (still readable, less polished).
  if (toolName.startsWith('search_flights')) return 'Searching flights';
  if (toolName.startsWith('search_hotels')) return 'Searching hotels';
  if (toolName.startsWith('hold_')) return 'Holding the option';
  if (toolName.startsWith('book_')) return 'Booking';
  if (toolName.startsWith('settle_')) return 'Settling';
  if (toolName.startsWith('scan_document')) return 'Scanning the document';
  if (toolName.startsWith('lookup_trip')) return 'Looking up the trip';
  if (toolName.startsWith('slack_')) return 'Working in Slack';
  return `Running \`${toolName}\``;
}

/**
 * Render the per-tenant routing preamble that gets stitched between the
 * (Langfuse-managed) tenant/channel context and the (Langfuse-managed)
 * Slack tool guidance. Routing rules are dynamic per turn — they can't
 * live as static prompt copy, so they stay in code as composed text.
 */
function renderSlackRoutingPreamble(routing: SlackRoutingConfig | null): string {
  if (!routing) {
    return '- Routing: not configured. Reply in the originating thread; do not move the conversation.';
  }
  const lines: string[] = [];
  if (routing.defaultChannel) {
    lines.push(`- Default routing channel: ${routing.defaultChannel}`);
  }
  if (routing.routes?.length) {
    lines.push('- Event routing rules:');
    for (const r of routing.routes) {
      lines.push(`  - ${r.eventClass} → ${r.channel}${r.mode ? ` (${r.mode})` : ''}`);
    }
  }
  // Reuse the `ConversationState` type so TS type-checks the import even
  // when the engine's `recentTurns` block grows new fields.
  void ({} as ConversationState);
  return lines.join('\n');
}
