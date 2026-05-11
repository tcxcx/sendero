/**
 * inspect_my_slack_channel — operator-facing introspection tool.
 *
 * Sister tool to `inspect_my_whatsapp_channel`. The operator chats with
 * Sendero AI on the internal console ("do we have slack enabled?",
 * "is the bot still installed?", "what came in today over slack?")
 * and the agent answers from authoritative state — `SlackInstall` row
 * + recent `Trip.events` filtered to `channel: 'slack'` + meter rows
 * tagged `metadata.channel = 'slack'` + bound-user count.
 *
 * Slack has fewer audit surfaces than WhatsApp (no per-event
 * `WhatsAppWebhookEvent` equivalent), so the activity counters lean on
 * the canonical Trip ledger. That's good enough for "is anything
 * happening?" — for deep delivery diagnostics, fall back to Slack's
 * own audit logs.
 *
 * Auth model:
 *   - tenantId is read from `ctx.traveler.tenantId` (server-resolved
 *     from Clerk org). The LLM cannot supply it via tool input.
 *   - `internal: true` so customer-facing channels never see this in
 *     their catalog.
 *   - Production-safe for authed operators; the only refusal is
 *     "no tenant context" (orphan calls).
 */

import { z } from 'zod';
import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  hours: z
    .number()
    .int()
    .min(1)
    .max(168)
    .default(24)
    .describe(
      'Lookback window in hours for inbound/outbound activity counters. Default 24h. Max one week (168h).'
    ),
  includePreviews: z
    .boolean()
    .default(false)
    .describe(
      'Include last 5 inbound + last 5 outbound (agent reply) message previews from Trip.events. Off by default.'
    ),
});

export type InspectMySlackInput = z.infer<typeof inputSchema>;

export interface SlackInstallSummary {
  exists: boolean;
  status: 'active' | 'revoked' | 'not_installed';
  teamId: string | null;
  teamName: string | null;
  enterpriseId: string | null;
  enterpriseName: string | null;
  isEnterpriseInstall: boolean;
  appId: string | null;
  botUserId: string | null;
  hasBotToken: boolean;
  scopes: string[];
  installedAt: string | null;
  updatedAt: string | null;
  revokedAt: string | null;
  defaultChannel: string | null;
  routingConfigured: boolean;
}

export interface SlackActivityCounters {
  hours: number;
  inboundMessages: number;
  agentReplies: number;
  /** chat_reply MeterEvent rows tagged channel=slack — independent confirmation. */
  meteredReplies: number;
}

export interface SlackMessagePreview {
  at: string;
  preview: string;
  direction?: 'inbound' | 'outbound';
}

export interface InspectMySlackResult {
  status: 'ok' | 'no_tenant_context';
  message: string;
  install: SlackInstallSummary;
  activity?: SlackActivityCounters;
  identities?: { boundUsers: number };
  trips?: { activeLinked: number };
  recentInbound?: SlackMessagePreview[];
  recentOutbound?: SlackMessagePreview[];
}

const NOT_INSTALLED: SlackInstallSummary = {
  exists: false,
  status: 'not_installed',
  teamId: null,
  teamName: null,
  enterpriseId: null,
  enterpriseName: null,
  isEnterpriseInstall: false,
  appId: null,
  botUserId: null,
  hasBotToken: false,
  scopes: [],
  installedAt: null,
  updatedAt: null,
  revokedAt: null,
  defaultChannel: null,
  routingConfigured: false,
};

export async function runInspectMySlack(
  input: InspectMySlackInput,
  ctx: ToolContext | undefined
): Promise<InspectMySlackResult> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    return {
      status: 'no_tenant_context',
      message:
        'No tenant context — this tool is for the operator console where the active Clerk org resolves the tenant. Sign in to the dashboard first.',
      install: NOT_INSTALLED,
    };
  }

  // Coerce — LLMs frequently call optional-only tools with `{}`, which
  // bypasses zod `.default(24)` at the AI SDK adapter layer.
  const hours =
    typeof input.hours === 'number' && Number.isFinite(input.hours) && input.hours > 0
      ? Math.min(168, Math.floor(input.hours))
      : 24;
  const includePreviews = input.includePreviews === true;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [install, recentTrips, meteredReplies, boundUsers, activeTripsCount] = await Promise.all([
    // Tenants can have multiple Slack installs (Grid). Pick the most-
    // recently-active live row first, fall back to revoked for the
    // status surface.
    prisma.slackInstall.findFirst({
      where: { tenantId, revokedAt: null },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.trip.findMany({
      where: { tenantId, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 60,
      select: { events: true },
    }),
    prisma.meterEvent.count({
      where: {
        tenantId,
        toolName: 'chat_reply',
        at: { gte: since },
        // metadata->>channel = 'slack'
        metadata: { path: ['channel'], equals: 'slack' },
      },
    }),
    prisma.slackUserBinding.count({ where: { tenantId } }),
    prisma.trip.count({
      where: {
        tenantId,
        status: { notIn: ['completed', 'canceled', 'failed'] },
        traveler: {
          slackUserBindings: { some: { tenantId } },
        },
      },
    }),
  ]);

  // Fall back to the revoked install for status display when no live row.
  const installRow =
    install ??
    (await prisma.slackInstall.findFirst({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    }));

  let installSummary: SlackInstallSummary = NOT_INSTALLED;
  if (installRow) {
    const routing = (installRow.routing ?? null) as {
      defaultChannel?: string;
      routes?: unknown[];
    } | null;
    installSummary = {
      exists: true,
      status: installRow.revokedAt ? 'revoked' : 'active',
      teamId: installRow.teamId,
      teamName: installRow.teamName,
      enterpriseId: installRow.enterpriseId,
      enterpriseName: installRow.enterpriseName,
      isEnterpriseInstall: installRow.isEnterpriseInstall,
      appId: installRow.appId,
      botUserId: installRow.botUserId,
      hasBotToken: Boolean(installRow.botToken),
      scopes: installRow.scope
        ? installRow.scope
            .split(',')
            .map(s => s.trim())
            .filter(Boolean)
        : [],
      installedAt: installRow.installedAt.toISOString(),
      updatedAt: installRow.updatedAt.toISOString(),
      revokedAt: installRow.revokedAt?.toISOString() ?? null,
      defaultChannel: routing?.defaultChannel ?? null,
      routingConfigured: Boolean(
        routing && (routing.defaultChannel || (routing.routes && routing.routes.length > 0))
      ),
    };
  }

  // Walk recent trips' events to pull Slack-channel rows. Counting cap:
  // we scan up to 60 most-recent trips × their events, bounded.
  let inboundCount = 0;
  let outboundCount = 0;
  const inboundPreviews: SlackMessagePreview[] = [];
  const outboundPreviews: SlackMessagePreview[] = [];
  const sinceMs = since.getTime();
  for (const t of recentTrips) {
    if (!Array.isArray(t.events)) continue;
    for (const raw of t.events) {
      if (!raw || typeof raw !== 'object') continue;
      const evt = raw as Record<string, unknown>;
      if (evt.channel !== 'slack') continue;
      const atIso = typeof evt.createdAt === 'string' ? evt.createdAt : null;
      if (!atIso) continue;
      const t = Date.parse(atIso);
      if (Number.isNaN(t) || t < sinceMs) continue;
      const direction = evt.direction;
      if (direction === 'inbound') {
        inboundCount += 1;
        if (includePreviews && inboundPreviews.length < 30 && typeof evt.text === 'string') {
          inboundPreviews.push({
            at: atIso,
            preview: evt.text.slice(0, 200),
            direction: 'inbound',
          });
        }
      } else if (direction === 'outbound') {
        outboundCount += 1;
        if (includePreviews && outboundPreviews.length < 30 && typeof evt.text === 'string') {
          outboundPreviews.push({
            at: atIso,
            preview: evt.text.slice(0, 200),
            direction: 'outbound',
          });
        }
      }
    }
  }

  const activity: SlackActivityCounters = {
    hours,
    inboundMessages: inboundCount,
    agentReplies: outboundCount,
    meteredReplies,
  };

  const result: InspectMySlackResult = {
    status: 'ok',
    message: buildHumanSummary(installSummary, activity, boundUsers),
    install: installSummary,
    activity,
    identities: { boundUsers },
    trips: { activeLinked: activeTripsCount },
  };

  if (includePreviews) {
    inboundPreviews.sort((a, b) => (a.at < b.at ? 1 : -1));
    outboundPreviews.sort((a, b) => (a.at < b.at ? 1 : -1));
    result.recentInbound = inboundPreviews.slice(0, 5);
    result.recentOutbound = outboundPreviews.slice(0, 5);
  }

  return result;
}

function buildHumanSummary(
  install: SlackInstallSummary,
  activity: SlackActivityCounters,
  boundUsers: number
): string {
  if (!install.exists) {
    return `Slack is NOT installed for this tenant. Visit /dashboard/channels/slack to start the OAuth install.`;
  }
  if (install.status === 'revoked') {
    return `Slack install REVOKED on ${install.revokedAt} (workspace ${install.teamName ?? install.teamId}). Re-install from /dashboard/channels/slack.`;
  }
  return `Slack active in workspace ${install.teamName ?? install.teamId}${
    install.isEnterpriseInstall ? ' (Enterprise Grid)' : ''
  }. Last ${activity.hours}h: ${activity.inboundMessages} inbound · ${activity.agentReplies} agent replies. ${boundUsers} user(s) bound.`;
}

// Prisma includes `slackBindings` on User but the type may not surface
// here without explicit casts in older client builds. Keep the
// `Prisma` import for the metadata->>channel filter shape above.
void ({} as Prisma.JsonObject);

export const inspectMySlackChannelTool: ToolDef<InspectMySlackInput, InspectMySlackResult> = {
  name: 'inspect_my_slack_channel',
  internal: true,
  description:
    "Inspect THIS tenant's own Slack channel — install state, recent inbound + agent-reply activity, bound user count, default routing channel. Tenant id is read from server-resolved auth context; never trust user-supplied tenantIds. Use when the operator asks 'do we have slack enabled?', 'is the bot still installed?', 'what came in over slack today?'. Mirror of inspect_my_whatsapp_channel for parity.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      hours: {
        type: 'integer',
        minimum: 1,
        maximum: 168,
        default: 24,
        description: 'Lookback window in hours.',
      },
      includePreviews: {
        type: 'boolean',
        default: false,
        description: 'Include last 5 inbound + last 5 outbound previews.',
      },
    },
  },
  async handler(input, ctx) {
    return runInspectMySlack(input, ctx);
  },
};
