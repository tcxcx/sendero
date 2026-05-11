/**
 * Slack audit-log writers — inbound webhook deliveries + agent/tool timeline.
 *
 * Mirrors the WhatsApp audit posture, but uses raw SQL so the hot path
 * can write new audit rows even before a generated Prisma client exposes
 * model helpers. All writes are fail-soft: observability must not make
 * Slack retry webhook deliveries or block traveler replies.
 */

import { prisma } from '@sendero/database';

import crypto from 'node:crypto';

const PREVIEW_LIMIT = 1_200;

export type SlackWebhookDispatchStatus =
  | 'dispatched'
  | 'skipped'
  | 'duplicate'
  | 'busy'
  | 'failed'
  | 'revoked'
  | 'unknown_install';

export async function logSlackWebhookEvent(args: {
  tenantId: string | null;
  receivedAt: Date;
  rawBody: string;
  teamId: string;
  enterpriseId?: string | null;
  eventId?: string | null;
  eventType?: string | null;
  eventSubtype?: string | null;
  channelId?: string | null;
  threadTs?: string | null;
  slackUserId?: string | null;
  signatureValid: boolean;
  replayWindowOk?: boolean | null;
  messageCount: number;
  droppedDuplicateCount?: number;
  droppedBusyCount?: number;
  dispatchedCount?: number;
  dispatchStatus: SlackWebhookDispatchStatus;
  dispatchError?: string | null;
  durationMs?: number | null;
  traceId?: string | null;
  persistRaw?: boolean;
  rawEnvelope?: unknown;
}): Promise<void> {
  try {
    const payloadHash = crypto.createHash('sha256').update(args.rawBody).digest('hex');
    const rawEnvelope = args.persistRaw ? JSON.stringify(args.rawEnvelope ?? null) : null;
    await prisma.$executeRaw`
      INSERT INTO "slack_webhook_events" (
        "tenant_id",
        "received_at",
        "team_id",
        "enterprise_id",
        "event_id",
        "event_type",
        "event_subtype",
        "channel_id",
        "thread_ts",
        "slack_user_id",
        "signature_valid",
        "replay_window_ok",
        "message_count",
        "dropped_duplicate_count",
        "dropped_busy_count",
        "dispatched_count",
        "dispatch_status",
        "dispatch_error",
        "duration_ms",
        "trace_id",
        "payload_hash",
        "raw_envelope"
      )
      VALUES (
        ${args.tenantId},
        ${args.receivedAt},
        ${args.teamId},
        ${args.enterpriseId ?? null},
        ${args.eventId ?? null},
        ${args.eventType ?? null},
        ${args.eventSubtype ?? null},
        ${args.channelId ?? null},
        ${args.threadTs ?? null},
        ${args.slackUserId ?? null},
        ${args.signatureValid},
        ${args.replayWindowOk ?? null},
        ${args.messageCount},
        ${args.droppedDuplicateCount ?? 0},
        ${args.droppedBusyCount ?? 0},
        ${args.dispatchedCount ?? 0},
        ${args.dispatchStatus},
        ${clip(args.dispatchError)},
        ${args.durationMs ?? null},
        ${args.traceId ?? null},
        ${payloadHash},
        ${rawEnvelope}::jsonb
      )
    `;
  } catch (err) {
    console.error('[slack-audit] webhook insert failed', {
      teamId: args.teamId,
      eventId: args.eventId,
      dispatchStatus: args.dispatchStatus,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export type SlackAgentEventKind =
  | 'turn_started'
  | 'placeholder_posted'
  | 'placeholder_failed'
  | 'step_update'
  | 'tool_started'
  | 'tool_finished'
  | 'tool_failed'
  | 'tool_slow'
  | 'turn_finished'
  | 'turn_failed'
  | 'outbound_posted'
  | 'outbound_failed';

export async function logSlackAgentEvent(args: {
  tenantId: string;
  traceId?: string | null;
  eventId?: string | null;
  turnId?: string | null;
  teamId: string;
  enterpriseId?: string | null;
  channelId: string;
  threadTs: string;
  slackUserId?: string | null;
  senderoUserId?: string | null;
  tripId?: string | null;
  sequence: number;
  kind: SlackAgentEventKind;
  toolName?: string | null;
  ok?: boolean | null;
  durationMs?: number | null;
  statusText?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const metadata = args.metadata ? JSON.stringify(args.metadata) : null;
    await prisma.$executeRaw`
      INSERT INTO "slack_agent_events" (
        "tenant_id",
        "trace_id",
        "event_id",
        "turn_id",
        "team_id",
        "enterprise_id",
        "channel_id",
        "thread_ts",
        "slack_user_id",
        "sendero_user_id",
        "trip_id",
        "sequence",
        "kind",
        "tool_name",
        "ok",
        "duration_ms",
        "status_text",
        "error_message",
        "metadata"
      )
      VALUES (
        ${args.tenantId},
        ${args.traceId ?? null},
        ${args.eventId ?? null},
        ${args.turnId ?? null},
        ${args.teamId},
        ${args.enterpriseId ?? null},
        ${args.channelId},
        ${args.threadTs},
        ${args.slackUserId ?? null},
        ${args.senderoUserId ?? null},
        ${args.tripId ?? null},
        ${args.sequence},
        ${args.kind},
        ${args.toolName ?? null},
        ${args.ok ?? null},
        ${args.durationMs ?? null},
        ${clip(args.statusText)},
        ${clip(args.errorMessage)},
        ${metadata}::jsonb
      )
    `;
  } catch (err) {
    console.error('[slack-audit] agent event insert failed', {
      teamId: args.teamId,
      threadTs: args.threadTs,
      kind: args.kind,
      toolName: args.toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function summarizeForAudit(value: unknown): string {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string') return clip(value) ?? '';
  try {
    return clip(JSON.stringify(value)) ?? '';
  } catch {
    return clip(String(value)) ?? '';
  }
}

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length > PREVIEW_LIMIT ? `${value.slice(0, PREVIEW_LIMIT)}…` : value;
}
