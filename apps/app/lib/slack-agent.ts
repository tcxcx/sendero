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
  type ConversationState,
  runAgentTurn,
  type RunAgentTurnArgs,
  type SessionStore,
  SENDERO_SOUL,
} from '@sendero/agent';
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
import { senderoSlackTools } from './slack-agent-tools';

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

  const persona = buildSlackPersona({
    orgName: args.orgName ?? args.install.teamName,
    planTier: args.planTier,
    channelName: args.channelName,
    channelId: args.channelId,
    routing: args.install.routing ?? null,
  });

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
  const initialModel = args.model ?? resolveModel(tier);
  if (!initialModel) {
    throw new Error(
      'No AI model available — set AI_GATEWAY_API_KEY (preferred) or one of ' +
        'GOOGLE_GENERATIVE_AI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY.'
    );
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

  // Post the agent's final reply into the originating thread. We always
  // thread (`thread_ts`) — never broadcast — so noisy channels don't
  // turn into a top-level firehose.
  let postedTs: string | undefined;
  if (result.text && result.text.trim().length > 0) {
    const slack = createSlackClient(args.install.botToken);
    const posted = await slack.chat.postMessage({
      channel: args.channelId,
      thread_ts: args.threadTs,
      text: result.text,
      mrkdwn: true,
      unfurl_links: false,
    });
    postedTs = posted.ts ?? undefined;
  }

  // TODO(slack-approval): When the LLM picked a `needsApproval`-gated
  // Slack tool, the AI SDK pauses with a `tool-approval-request` step
  // and `result.text` may be empty (or a "I want to do X — approve?"
  // narration). The corporate-travel approval helpers in `./approval`
  // are tied to trip/booking shape today; a follow-up generalizes them
  // so we can render an Approve/Reject card for arbitrary Slack tool
  // calls and resume the turn from the existing interactions handler.
  // For now the user simply sees the LLM's narration in the thread.

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

interface BuildSlackPersonaArgs {
  orgName?: string;
  planTier?: string;
  channelName?: string;
  channelId: string;
  routing: SlackRoutingConfig | null;
}

function buildSlackPersona(args: BuildSlackPersonaArgs): string {
  const parts: string[] = [SENDERO_SOUL, ''];

  parts.push('## Tenant context');
  if (args.orgName) parts.push(`- Workspace: ${args.orgName}`);
  if (args.planTier) parts.push(`- Plan: ${args.planTier}`);

  parts.push('', '## Slack context');
  parts.push(
    args.channelName
      ? `- Channel: #${args.channelName} (${args.channelId})`
      : `- Channel: ${args.channelId}`
  );

  if (args.routing) {
    if (args.routing.defaultChannel) {
      parts.push(`- Default routing channel: ${args.routing.defaultChannel}`);
    }
    if (args.routing.routes?.length) {
      parts.push('- Event routing rules:');
      for (const r of args.routing.routes) {
        parts.push(`  - ${r.eventClass} → ${r.channel}${r.mode ? ` (${r.mode})` : ''}`);
      }
    }
  } else {
    // No routing set → reply in the same channel/thread the user wrote
    // in. Surface that explicitly so the LLM doesn't try to discover a
    // routing dest with a tool call.
    parts.push(
      '- Routing: not configured. Reply in the originating thread; do not move the conversation.'
    );
  }

  parts.push(
    '',
    '## Slack tool guidance',
    '- You have access to Slack tools (`slack_send_message`, `slack_read_channel`, …) AND Sendero travel tools (flights, hotels, escrow). Pick the smallest tool that does the job.',
    '- Mutating Slack tools (send / canvas / join / delete) require human approval — when you want to call one, narrate your intent in plain text instead of forcing the tool call so the workspace admin can confirm.',
    '- Default to thread replies. Do not @-mention `@channel`/`@here` unless the user explicitly asks.',
    '- Use Slack mrkdwn (`*bold*`, `_italic_`, `<https://example.com|link>`). No HTML.'
  );

  // Reuse the `ConversationState` type so TS type-checks the import even
  // when the engine's `recentTurns` block grows new fields.
  void ({} as ConversationState);

  return parts.join('\n');
}
