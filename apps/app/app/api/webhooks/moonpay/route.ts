/**
 * POST /api/webhooks/moonpay
 *
 * Receives every MoonPay webhook event for the registered endpoint.
 *
 * Pipeline (mirrors `webhooks/circle`):
 *
 *   1. Signature verify  — HMAC-SHA256 keyed by `MOONPAY_WEBHOOK_SECRET`.
 *      Header: `Moonpay-Signature-V2: t=<unix>,s=<hex>`. ±5 min replay
 *      window enforced inline.
 *   2. Durable dedup     — `processDurableWebhook` against
 *      `webhookEventStore`. Keyed `(provider='moonpay', externalId=eventId)`.
 *      Mirrors Duffel + Circle so MoonPay shares one cross-provider
 *      replay-resistant pipeline.
 *   3. Dispatch          — `dispatchMoonPayEvent`. Tx-state events flip
 *      `MoonPayTopUp.status`; everything else is logged-and-skipped.
 *   4. Rich audit        — `MoonPayWebhookEvent` row written via
 *      `after()` so the ack window stays sub-100ms regardless of DB
 *      latency. Captures sig validity, replay drift, dispatch outcome
 *      + duration. Distinct from `WebhookEvent` which holds only the
 *      canonical "delivered + processed" state.
 *
 * Failure modes ack with 200 except for missing-secret (503) — MoonPay
 * never retries on our misconfiguration. Operators see failures via
 * the rich audit table.
 */

import { after, type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { dispatchMoonPayEvent, type DispatchResult } from '@/lib/moonpay-events';
import { verifyMoonPaySignature } from '@/lib/moonpay-webhook-verify';
import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const SIGNATURE_HEADER = 'moonpay-signature-v2';

interface AuditInput {
  moonpayEventId: string;
  eventType: string;
  signatureValid: boolean;
  replayWindowOk: boolean | null;
  dispatchStatus: 'processed' | 'skipped' | 'failed' | 'duplicate';
  dispatchError?: string;
  durationMs: number;
  rawPayload: unknown;
  userId?: string;
  topUpId?: string;
}

function writeAudit(input: AuditInput): Promise<unknown> {
  return prisma.moonPayWebhookEvent
    .create({
      data: {
        moonpayEventId: input.moonpayEventId,
        eventType: input.eventType,
        signatureValid: input.signatureValid,
        replayWindowOk: input.replayWindowOk,
        dispatchStatus: input.dispatchStatus,
        dispatchError: input.dispatchError,
        durationMs: input.durationMs,
        rawPayload: input.rawPayload as object,
        userId: input.userId,
        topUpId: input.topUpId,
      },
    })
    .catch((err: unknown) => {
      // Audit-write must never bubble — webhook ack already sent.
      // Most common cause: duplicate moonpay_event_id (unique index
      // doing its job after a Redis-miss replay).
      console.warn('[webhooks/moonpay] audit write failed', {
        eventId: input.moonpayEventId,
        type: input.eventType,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
}

interface MoonPayPayload {
  type: string;
  id?: string;
  data?: Record<string, unknown>;
  createdAt?: string;
  environment?: 'test' | 'production';
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const secret = process.env.MOONPAY_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json({ error: 'moonpay_webhook_unconfigured' }, { status: 503 });
  }

  // HMAC must be computed over the exact bytes MoonPay sent.
  const rawBody = await req.text();
  const sigHeader = req.headers.get(SIGNATURE_HEADER) ?? req.headers.get('Moonpay-Signature-V2');
  const sig = verifyMoonPaySignature(rawBody, sigHeader, secret);

  let payload: MoonPayPayload;
  try {
    payload = JSON.parse(rawBody) as MoonPayPayload;
  } catch {
    after(
      writeAudit({
        moonpayEventId: `malformed:${Date.now()}`,
        eventType: 'unknown',
        signatureValid: sig.signatureValid,
        replayWindowOk: sig.replayWindowOk,
        dispatchStatus: 'failed',
        dispatchError: 'invalid_json',
        durationMs: Date.now() - started,
        rawPayload: { rawBodyTruncated: rawBody.slice(0, 1024) },
      })
    );
    return NextResponse.json({ ok: true });
  }

  const eventId = payload.id ?? `nogeid:${payload.type}:${started}`;
  const eventType = payload.type ?? 'unknown';

  if (!sig.signatureValid || sig.replayWindowOk === false) {
    after(
      writeAudit({
        moonpayEventId: eventId,
        eventType,
        signatureValid: sig.signatureValid,
        replayWindowOk: sig.replayWindowOk,
        dispatchStatus: 'failed',
        dispatchError: sig.reason ?? 'signature_or_replay_failed',
        durationMs: Date.now() - started,
        rawPayload: payload,
      })
    );
    return NextResponse.json({ ok: true });
  }

  // Durable dedup + dispatch via the canonical pipeline. Keyed on the
  // MoonPay event id so retries collapse to a single domain effect even
  // if Redis is unavailable (Postgres unique index backstops).
  let dispatchResult: DispatchResult | null = null;
  const result = await processDurableWebhook<MoonPayPayload, DispatchResult>({
    provider: 'moonpay',
    externalId: eventId,
    eventType,
    payload,
    event: payload,
    store: webhookEventStore,
    dispatch: async event => {
      dispatchResult = await dispatchMoonPayEvent(event);
      // `acceptedError` will surface the soft-skip reason without
      // marking the row as failed — keeps cross-provider semantics
      // consistent with Duffel/Circle.
      return dispatchResult;
    },
    acceptedError: r => (r.status === 'skipped' ? (r.error ?? 'skipped') : null),
    logger: console,
    logPrefix: '[webhooks/moonpay]',
  });

  const auditBase = {
    moonpayEventId: eventId,
    eventType,
    signatureValid: true,
    replayWindowOk: true,
    durationMs: Date.now() - started,
    rawPayload: payload,
  } as const;

  if (result.ok === false) {
    after(
      writeAudit({
        ...auditBase,
        dispatchStatus: 'failed',
        dispatchError: result.error,
      })
    );
    // 200 still — MoonPay retry would re-trigger the same dispatcher
    // bug. Operators see the failed audit row + alert downstream.
    return NextResponse.json({ ok: true });
  }

  if (result.deduped === true) {
    after(
      writeAudit({
        ...auditBase,
        dispatchStatus: 'duplicate',
      })
    );
    return NextResponse.json({ ok: true, deduped: true });
  }

  const dispatch = (dispatchResult ?? result.result) as DispatchResult;
  after(
    writeAudit({
      ...auditBase,
      dispatchStatus: dispatch.status,
      dispatchError: dispatch.error,
      userId: dispatch.userId,
      topUpId: dispatch.topUpId,
    })
  );

  return NextResponse.json({ ok: true });
}
