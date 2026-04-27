/**
 * WhatsApp audit-log writers — inbound webhook events + outbound sends.
 *
 * Closes Bucket 5 (observability) gaps. Operators looking at
 * `/dashboard/channels/whatsapp/inbox` see one row per webhook
 * delivery (verify outcome, normalized counts, duration), and one row
 * per outbound send (wamid, recipient, source, delivery status).
 *
 * All writes are fail-soft: on a Prisma blip we log + swallow rather
 * than throwing into the webhook hot path. Slack / Meta retries on
 * non-200 acks would be a much worse outcome than a missing audit row.
 */

import crypto from 'node:crypto';

import type { WhatsAppSendEvent } from '@sendero/whatsapp';
import { prisma } from '@sendero/database';

/**
 * The labels we use on `WhatsAppOutboundMessage.source`. New sources
 * MUST be added here so the operator UI's filter chips stay
 * exhaustive.
 */
export const OUTBOUND_SOURCES = [
  'agent_reply',
  'agent_fallback',
  'otp',
  'security_alert',
  'manual',
  'broadcast',
  'channel_notify',
  'tool_call',
] as const;

export type OutboundSource = (typeof OUTBOUND_SOURCES)[number];

/**
 * Insert one `WhatsAppOutboundMessage` row per successful send.
 * Called from inside the WhatsAppClient `onSent` hook — caller
 * supplies tenantId + source; the WhatsApp event payload supplies
 * wamid + kind + recipient + preview.
 */
export async function logOutboundMessage(args: {
  tenantId: string;
  phoneNumberId: string;
  source: OutboundSource;
  traceId?: string;
  event: WhatsAppSendEvent;
}): Promise<void> {
  try {
    await prisma.whatsAppOutboundMessage.create({
      data: {
        tenantId: args.tenantId,
        wamid: args.event.wamid,
        phoneNumberId: args.phoneNumberId,
        recipientId: args.event.recipientId,
        kind: args.event.kind,
        source: args.source,
        ...(args.event.templateName ? { templateName: args.event.templateName } : {}),
        ...(args.event.preview ? { preview: args.event.preview } : {}),
        ...(args.traceId ? { traceId: args.traceId } : {}),
        deliveryStatus: 'sent',
      },
    });
  } catch (err) {
    // P2002 = unique constraint (wamid already inserted, e.g. from a
    // retry loop). Swallow it; the existing row stays authoritative.
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return;
    }
    console.error('[whatsapp-audit] outbound insert failed', {
      wamid: args.event.wamid,
      source: args.source,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Insert one `WhatsAppWebhookEvent` row at the end of every inbound
 * webhook handler. The route should call this AFTER the 200 ack via
 * `after()` so a slow audit insert never blocks Meta's ack window.
 */
export async function logWebhookEvent(args: {
  tenantId: string | null;
  receivedAt: Date;
  rawBody: string;
  signatureValid: boolean;
  replayWindowOk: boolean | null;
  messageCount: number;
  identityChangeCount: number;
  statusUpdateCount: number;
  droppedReplayCount: number;
  droppedDuplicateCount: number;
  dispatchedCount: number;
  durationMs: number;
  traceId: string;
  /** When true (per-tenant config), persist the raw envelope JSON. */
  persistRaw?: boolean;
  rawEnvelope?: unknown;
}): Promise<void> {
  try {
    const payloadHash = crypto.createHash('sha256').update(args.rawBody).digest('hex');
    await prisma.whatsAppWebhookEvent.create({
      data: {
        ...(args.tenantId ? { tenantId: args.tenantId } : {}),
        receivedAt: args.receivedAt,
        signatureValid: args.signatureValid,
        replayWindowOk: args.replayWindowOk,
        payloadHash,
        messageCount: args.messageCount,
        identityChangeCount: args.identityChangeCount,
        statusUpdateCount: args.statusUpdateCount,
        droppedReplayCount: args.droppedReplayCount,
        droppedDuplicateCount: args.droppedDuplicateCount,
        dispatchedCount: args.dispatchedCount,
        durationMs: args.durationMs,
        traceId: args.traceId,
        ...(args.persistRaw && args.rawEnvelope !== undefined
          ? { rawEnvelope: args.rawEnvelope as never }
          : {}),
      },
    });
  } catch (err) {
    console.error('[whatsapp-audit] webhook insert failed', {
      traceId: args.traceId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Reconcile a status update against the outbound row. Called from the
 * status-webhook handler in the route. Sets the per-status timestamp
 * column (`deliveredAt` / `readAt` / `failedAt`) plus the `deliveryStatus`
 * + optional `failureReason`.
 *
 * Returns the count of rows updated (0 means we don't have a record
 * of that wamid — likely a send that predates the audit log).
 */
export async function reconcileOutboundStatus(args: {
  wamid: string;
  status: string;
  failureReason: string | null;
  at: Date;
}): Promise<number> {
  try {
    const data: Record<string, unknown> = {
      deliveryStatus: args.status,
    };
    if (args.failureReason) data.failureReason = args.failureReason;
    if (args.status === 'delivered') data.deliveredAt = args.at;
    if (args.status === 'read') data.readAt = args.at;
    if (args.status === 'failed') data.failedAt = args.at;

    const result = await prisma.whatsAppOutboundMessage.updateMany({
      where: { wamid: args.wamid },
      data,
    });
    return result.count;
  } catch (err) {
    console.error('[whatsapp-audit] status reconcile failed', {
      wamid: args.wamid,
      status: args.status,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}
