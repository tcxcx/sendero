/**
 * inspect_my_whatsapp_channel — operator-facing introspection tool.
 *
 * Sister tool to the `/observe-whatsapp` skill, but scoped to the
 * tenant's OWN install. The operator chats with Sendero AI on the
 * internal console ("do you have our whatsapp enabled?") and the
 * agent answers from authoritative state — install row, recent
 * inbound/outbound counts from the audit tables, delivery health,
 * channel-identity count, last failure reasons.
 *
 * Auth model:
 *   - tenantId is read from `ctx.traveler.tenantId` (server-resolved
 *     from Clerk org). The LLM cannot supply it via tool input.
 *   - `internal: true` so customer-facing channels (WhatsApp/Slack
 *     traveler turns) never see this in their catalog.
 *   - Production-safe: unlike the demand-driven dev gates, this tool
 *     is intentionally usable in production for an authed operator.
 *     The only refusal is "no tenant context" (orphan calls).
 *
 * Returns shape designed to be one-shot answerable: install state,
 * 24h activity counters, delivery breakdown, last 3 failures with
 * reasons, count of identities + active linked trips. Optional
 * `includePreviews: true` surfaces last 5 inbound/outbound previews
 * (already PII-truncated at the audit layer).
 */

import { z } from 'zod';
import { prisma } from '@sendero/database';

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
      'Include last 5 inbound + last 5 outbound message previews (already truncated to ~280 chars at audit time). Off by default — privacy-conscious.'
    ),
});

export type InspectMyWhatsappInput = z.infer<typeof inputSchema>;

export interface WhatsappInstallSummary {
  exists: boolean;
  status: 'pending' | 'active' | 'disabled' | 'error' | 'not_installed';
  displayPhoneNumber: string | null;
  businessDisplayName: string | null;
  hasKapsoConnection: boolean;
  hasMetaPhoneNumberId: boolean;
  hasMetaWaba: boolean;
  lastErrorMessage: string | null;
  installedAt: string | null;
  updatedAt: string | null;
}

export interface WhatsappActivityCounters {
  hours: number;
  webhookEvents: number;
  inboundMessages: number;
  identityChanges: number;
  statusUpdates: number;
  droppedReplay: number;
  droppedDuplicate: number;
  badSignature: number;
  dispatchedToAgent: number;
}

export interface WhatsappOutboundCounters {
  hours: number;
  total: number;
  agentRepliesInTripEvents: number;
  delivered: number;
  read: number;
  failed: number;
  bySource: Record<string, number>;
}

export interface WhatsappApiCallCounters {
  hours: number;
  total: number;
  ok: number;
  errored: number;
  byTarget: Record<string, { total: number; ok: number; errored: number }>;
}

export interface WhatsappFailureSample {
  at: string;
  recipient: string;
  source: string;
  reason: string;
}

export interface WhatsappMessagePreview {
  at: string;
  preview: string;
  kind?: string;
  source?: string;
  status?: string;
}

export interface InspectMyWhatsappResult {
  status: 'ok' | 'no_tenant_context';
  message: string;
  install: WhatsappInstallSummary;
  inbound?: WhatsappActivityCounters;
  outbound?: WhatsappOutboundCounters;
  api?: WhatsappApiCallCounters;
  identities?: { totalActive: number; provisionalUserCount: number };
  trips?: { activeLinked: number };
  recentFailures?: WhatsappFailureSample[];
  recentInbound?: WhatsappMessagePreview[];
  recentOutbound?: WhatsappMessagePreview[];
}

const NOT_INSTALLED: WhatsappInstallSummary = {
  exists: false,
  status: 'not_installed',
  displayPhoneNumber: null,
  businessDisplayName: null,
  hasKapsoConnection: false,
  hasMetaPhoneNumberId: false,
  hasMetaWaba: false,
  lastErrorMessage: null,
  installedAt: null,
  updatedAt: null,
};

export async function runInspectMyWhatsapp(
  input: InspectMyWhatsappInput,
  ctx: ToolContext | undefined
): Promise<InspectMyWhatsappResult> {
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
  // bypasses zod `.default(24)` at the AI SDK adapter layer and leaves
  // `input.hours` undefined (→ `new Date(NaN)` → Prisma rejects).
  const hours =
    typeof input.hours === 'number' && Number.isFinite(input.hours) && input.hours > 0
      ? Math.min(168, Math.floor(input.hours))
      : 24;
  const includePreviews = input.includePreviews === true;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const [install, webhookAggRaw, outboundRows, apiLogs, identityCounts, activeTripsCount, recentTrips] =
    await Promise.all([
      prisma.whatsAppInstall.findUnique({ where: { tenantId } }),
      prisma.whatsAppWebhookEvent.findMany({
        where: { tenantId, receivedAt: { gte: since } },
        select: {
          signatureValid: true,
          messageCount: true,
          identityChangeCount: true,
          statusUpdateCount: true,
          droppedReplayCount: true,
          droppedDuplicateCount: true,
          dispatchedCount: true,
        },
        take: 5_000,
      }),
      prisma.whatsAppOutboundMessage.findMany({
        where: { tenantId, sentAt: { gte: since } },
        select: {
          sentAt: true,
          recipientId: true,
          kind: true,
          source: true,
          preview: true,
          deliveryStatus: true,
          failureReason: true,
        },
        orderBy: { sentAt: 'desc' },
        take: 1_000,
      }),
      prisma.whatsAppApiLog.findMany({
        where: { tenantId, calledAt: { gte: since } },
        select: { target: true, ok: true },
        take: 5_000,
      }),
      prisma.channelIdentity.count({
        where: { tenantId, kind: 'whatsapp' },
      }),
      prisma.trip.count({
        where: {
          tenantId,
          status: { notIn: ['completed', 'canceled', 'failed'] },
          traveler: {
            channelIdentities: { some: { kind: 'whatsapp' } },
          },
        },
      }),
      prisma.trip.findMany({
        where: { tenantId },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: { events: true },
      }),
    ]);

  const installSummary: WhatsappInstallSummary = install
    ? {
        exists: true,
        status:
          install.status === 'pending' ||
          install.status === 'active' ||
          install.status === 'disabled' ||
          install.status === 'error'
            ? install.status
            : 'pending',
        displayPhoneNumber: install.displayPhoneNumber ?? null,
        businessDisplayName: install.businessDisplayName ?? null,
        hasKapsoConnection: Boolean(install.kapsoConnectionId),
        hasMetaPhoneNumberId: Boolean(install.phoneNumberId),
        hasMetaWaba: Boolean(install.businessAccountId),
        lastErrorMessage: install.lastErrorMessage ?? null,
        installedAt: (install as { createdAt?: Date }).createdAt?.toISOString() ?? null,
        updatedAt: (install as { updatedAt?: Date }).updatedAt?.toISOString() ?? null,
      }
    : NOT_INSTALLED;

  const inbound: WhatsappActivityCounters = {
    hours,
    webhookEvents: webhookAggRaw.length,
    inboundMessages: webhookAggRaw.reduce((acc, r) => acc + r.messageCount, 0),
    identityChanges: webhookAggRaw.reduce((acc, r) => acc + r.identityChangeCount, 0),
    statusUpdates: webhookAggRaw.reduce((acc, r) => acc + r.statusUpdateCount, 0),
    droppedReplay: webhookAggRaw.reduce((acc, r) => acc + r.droppedReplayCount, 0),
    droppedDuplicate: webhookAggRaw.reduce((acc, r) => acc + r.droppedDuplicateCount, 0),
    badSignature: webhookAggRaw.filter(r => !r.signatureValid).length,
    dispatchedToAgent: webhookAggRaw.reduce((acc, r) => acc + r.dispatchedCount, 0),
  };

  const tripEventPreviews = collectWhatsappTripEventPreviews(recentTrips, since);
  const agentRepliesInTripEvents = tripEventPreviews.filter(r => r.direction === 'outbound').length;

  const outbound: WhatsappOutboundCounters = {
    hours,
    total: outboundRows.length,
    agentRepliesInTripEvents,
    delivered: outboundRows.filter(r => r.deliveryStatus === 'delivered').length,
    read: outboundRows.filter(r => r.deliveryStatus === 'read').length,
    failed: outboundRows.filter(r => r.deliveryStatus === 'failed').length,
    bySource: outboundRows.reduce<Record<string, number>>((acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + 1;
      return acc;
    }, {}),
  };

  const apiSummary: WhatsappApiCallCounters = {
    hours,
    total: apiLogs.length,
    ok: apiLogs.filter(r => r.ok).length,
    errored: apiLogs.filter(r => !r.ok).length,
    byTarget: apiLogs.reduce<WhatsappApiCallCounters['byTarget']>((acc, r) => {
      const slot = acc[r.target] ?? { total: 0, ok: 0, errored: 0 };
      slot.total += 1;
      if (r.ok) slot.ok += 1;
      else slot.errored += 1;
      acc[r.target] = slot;
      return acc;
    }, {}),
  };

  const recentFailures: WhatsappFailureSample[] = outboundRows
    .filter(r => r.deliveryStatus === 'failed')
    .slice(0, 3)
    .map(r => ({
      at: r.sentAt.toISOString(),
      recipient: maskPhone(r.recipientId),
      source: r.source,
      reason: r.failureReason ?? 'unspecified',
    }));

  const result: InspectMyWhatsappResult = {
    status: 'ok',
    message: buildHumanSummary(installSummary, inbound, outbound, apiSummary),
    install: installSummary,
    inbound,
    outbound,
    api: apiSummary,
    identities: { totalActive: identityCounts, provisionalUserCount: 0 },
    trips: { activeLinked: activeTripsCount },
    recentFailures,
  };

  if (includePreviews) {
    const auditedOutbound = outboundRows.slice(0, 10).map(r => ({
      at: r.sentAt.toISOString(),
      preview: (r.preview ?? '').slice(0, 200),
      kind: r.kind,
      source: r.source,
      status: r.deliveryStatus,
    }));
    const tripOutbound = tripEventPreviews
      .filter(r => r.direction === 'outbound')
      .map(r => ({
        at: r.at,
        preview: r.preview,
        kind: r.kind,
        source: 'trip_events',
        status: 'recorded',
      }));
    result.recentOutbound = [...auditedOutbound, ...tripOutbound]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 5);
    result.recentInbound = tripEventPreviews
      .filter(r => r.direction === 'inbound')
      .map(({ direction: _direction, ...r }) => r)
      .slice(0, 5);
  }

  return result;
}

function maskPhone(raw: string): string {
  // Show country prefix + last 4 of E.164 / BSUID; rest as `*`.
  if (!raw) return raw;
  if (raw.length <= 6) return raw;
  const prefix = raw.startsWith('+') ? raw.slice(0, 3) : raw.slice(0, 2);
  const tail = raw.slice(-4);
  return `${prefix}…${tail}`;
}

function buildHumanSummary(
  install: WhatsappInstallSummary,
  inbound: WhatsappActivityCounters,
  outbound: WhatsappOutboundCounters,
  api: WhatsappApiCallCounters
): string {
  if (!install.exists) {
    return `WhatsApp is NOT installed for this tenant. Visit /dashboard/channels/whatsapp to start the Kapso setup link.`;
  }
  if (install.status !== 'active') {
    return `WhatsApp install state: ${install.status}${install.lastErrorMessage ? ` (${install.lastErrorMessage})` : ''}. Number: ${install.displayPhoneNumber ?? 'not assigned'}.`;
  }
  const errRate =
    api.total > 0 ? `${Math.round((api.errored / api.total) * 100)}% errored` : 'no calls';
  return `WhatsApp active on ${install.displayPhoneNumber}. Last ${inbound.hours}h: ${inbound.inboundMessages} inbound · ${outbound.total} outbound (${outbound.failed} failed) · API ${api.total} calls (${errRate}).`;
}

function collectWhatsappTripEventPreviews(
  trips: Array<{ events: unknown }>,
  since: Date
): Array<WhatsappMessagePreview & { direction: 'inbound' | 'outbound' }> {
  const previews: Array<WhatsappMessagePreview & { direction: 'inbound' | 'outbound' }> = [];
  for (const t of trips) {
    if (!Array.isArray(t.events)) continue;
    for (const raw of t.events) {
      if (!raw || typeof raw !== 'object') continue;
      const evt = raw as Record<string, unknown>;
      if (evt.channel !== 'whatsapp') continue;
      if (evt.direction !== 'inbound' && evt.direction !== 'outbound') continue;
      if (typeof evt.text !== 'string') continue;
      const at = typeof evt.createdAt === 'string' ? evt.createdAt : null;
      if (!at) continue;
      if (new Date(at).getTime() < since.getTime()) continue;
      previews.push({
        at,
        direction: evt.direction,
        preview: evt.text.slice(0, 200),
        kind: typeof evt.kind === 'string' ? evt.kind : undefined,
        source: 'trip_events',
      });
    }
  }
  previews.sort((a, b) => (a.at < b.at ? 1 : -1));
  return previews.slice(0, 30);
}

export const inspectMyWhatsappChannelTool: ToolDef<
  InspectMyWhatsappInput,
  InspectMyWhatsappResult
> = {
  name: 'inspect_my_whatsapp_channel',
  internal: true,
  description:
    "Inspect THIS tenant's own WhatsApp channel — install state, recent inbound/outbound activity, delivery health, last failures. Tenant id is read from server-resolved auth context; never trust user-supplied tenantIds. Use when the operator asks 'do we have whatsapp enabled?', 'how many messages came in today?', 'why did sends fail?'. For Kapso-side diagnostics across phone numbers use the /observe-whatsapp skill.",
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
        description: 'Include last 5 inbound + outbound previews.',
      },
    },
  },
  async handler(input, ctx) {
    return runInspectMyWhatsapp(input, ctx);
  },
};
