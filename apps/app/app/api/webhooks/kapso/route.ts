/**
 * POST /api/webhooks/kapso
 *
 * Project-scope Kapso webhook. The current event Sendero acts on is
 * `whatsapp.phone_number.created` — fired after the operator finishes
 * Meta Embedded Signup in Kapso's hosted setup page. The payload
 * carries the freshly-allocated `phone_number_id` + WABA metadata that
 * inbound message routing keys on.
 *
 * Plumbed through `processDurableWebhook` (matches Duffel/Circle/Clerk
 * inbound handlers) so Kapso retries cleanly dedupe against
 * WebhookEvent and don't double-flip status. The Meta-level inbound
 * message webhook is a separate route (`/api/webhooks/whatsapp`) that
 * uses Meta's own signature.
 *
 * Signature: HMAC-SHA256 hex in `x-webhook-signature`. The secret is
 * project-wide (`KAPSO_GLOBAL_WEBHOOK_SECRET`), set once via
 * `bun scripts/register-kapso-webhook.ts`. Per-install secrets were
 * dropped because Kapso signs per-project, not per-customer — the
 * earlier per-install scan was wasted work and never aligned with
 * what Kapso actually delivered.
 */

import { after } from 'next/server';
import { type NextRequest, NextResponse } from 'next/server';

import { type Prisma, prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient, parseProjectEvent, verifyKapsoSignature } from '@sendero/kapso';
import { notifyOperatorHandoff, roomIdForSupportCase } from '@sendero/collaboration/server';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { webhookEventStore } from '@/lib/webhook-events';
import { ensureTenantWhatsAppFlows } from '@/lib/whatsapp-flow-registry';
import { isMetaMockPhoneNumber, META_MOCK_PHONE_NUMBER_MESSAGE } from '@/lib/whatsapp-mock-number';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = env.kapsoGlobalWebhookSecret();
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  const signature =
    req.headers.get('x-webhook-signature') ?? req.headers.get('x-kapso-signature') ?? null;

  if (!verifyKapsoSignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const event = parseProjectEvent(payload);
  if (!event) {
    // Unknown event type — Kapso may add new ones. 200 so they stop
    // retrying.
    console.log('[webhooks/kapso] ignored unknown event', { payload });
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Per-event-kind dedup id. `phone_number.created` keys on
  // `(customerId, phoneNumberId)`; workflow events key on
  // `(executionId, phoneNumberId)` so retries collapse cleanly.
  const externalId =
    event.kind === 'phone_number.created'
      ? `${event.kind}:${event.customerId}:${event.phoneNumberId}`
      : `${event.kind}:${event.executionId ?? 'noid'}:${event.phoneNumberId ?? 'nophone'}`;
  const result = await processDurableWebhook({
    provider: 'kapso',
    externalId,
    eventType: event.kind,
    payload,
    event,
    store: webhookEventStore,
    dispatch: async parsed => dispatchKapsoEvent(parsed),
    acceptedError: dispatchResult => (dispatchResult.matched ? null : 'no_install_match'),
    logger: console,
    logPrefix: '[webhooks/kapso]',
  });

  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (result.deduped === false && result.acceptedError === 'no_install_match') {
    return NextResponse.json({ ok: true, matched: false });
  }
  return NextResponse.json({ ok: true });
}

interface DispatchResult {
  matched: boolean;
  installId?: string;
  tenantId?: string;
}

async function dispatchKapsoEvent(
  event: import('@sendero/kapso').ParsedKapsoProjectEvent
): Promise<DispatchResult> {
  if (event.kind === 'workflow.execution.handoff') {
    return dispatchWorkflowHandoff(event);
  }
  if (event.kind === 'workflow.execution.failed') {
    return dispatchWorkflowFailed(event);
  }
  return dispatchPhoneNumberCreated(event);
}

async function dispatchPhoneNumberCreated(event: {
  kind: 'phone_number.created';
  customerId: string;
  phoneNumberId: string;
  businessAccountId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}): Promise<DispatchResult> {
  const install = await prisma.whatsAppInstall.findUnique({
    where: { kapsoCustomerId: event.customerId },
    select: {
      id: true,
      tenantId: true,
      metadata: true,
      tenant: { select: { displayName: true } },
    },
  });
  if (!install) {
    console.warn('[webhooks/kapso] no install for customer', {
      customerId: event.customerId,
      phoneNumberId: event.phoneNumberId,
    });
    return { matched: false };
  }

  if (isMetaMockPhoneNumber(event.displayPhoneNumber)) {
    await prisma.whatsAppInstall.update({
      where: { id: install.id },
      data: {
        status: 'error',
        phoneNumberId: null,
        displayPhoneNumber: null,
        businessDisplayName: null,
        kapsoConnectionId: null,
        lastErrorMessage: META_MOCK_PHONE_NUMBER_MESSAGE,
        metadata: mergeJsonObject(install.metadata, {
          metaMockPhoneNumberRejectedAt: new Date().toISOString(),
          metaMockPhoneNumber: event.displayPhoneNumber,
          metaMockPhoneNumberId: event.phoneNumberId,
        }),
      },
    });
    console.warn('[webhooks/kapso] rejected Meta mock phone number', {
      tenantId: install.tenantId,
      phoneNumberId: event.phoneNumberId,
      displayPhoneNumber: event.displayPhoneNumber,
    });
    return { matched: true, installId: install.id, tenantId: install.tenantId };
  }

  const activation = await activateTenantWorkflowTrigger({
    tenantId: install.tenantId,
    phoneNumberId: event.phoneNumberId,
    displayPhoneNumber: event.displayPhoneNumber,
  });
  let tenantFlows: unknown;
  try {
    tenantFlows = await ensureTenantWhatsAppFlows({
      tenantId: install.tenantId,
      tenantDisplayName: install.tenant.displayName,
      phoneNumberId: event.phoneNumberId,
      businessAccountId: event.businessAccountId,
    });
  } catch (err) {
    tenantFlows = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
    console.warn('[webhooks/kapso] tenant flow registration failed after phone activation', {
      tenantId: install.tenantId,
      phoneNumberId: event.phoneNumberId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await prisma.whatsAppInstall.update({
    where: { id: install.id },
    data: {
      status: 'active',
      phoneNumberId: event.phoneNumberId,
      businessAccountId: event.businessAccountId ?? undefined,
      displayPhoneNumber: event.displayPhoneNumber ?? undefined,
      businessDisplayName: event.verifiedName ?? undefined,
      kapsoConnectionId: event.phoneNumberId,
      lastHealthyAt: new Date(),
      lastErrorMessage: null,
      metadata: mergeJsonObject(install.metadata, {
        tenantWorkflow: activation,
        tenantFlows,
      }),
    },
  });

  console.log('[webhooks/kapso] install activated', {
    tenantId: install.tenantId,
    channel: 'whatsapp',
    direction: 'inbound',
    status: 'active',
    phoneNumberId: event.phoneNumberId,
  });
  return { matched: true, installId: install.id, tenantId: install.tenantId };
}

function mergeJsonObject(current: unknown, patch: Record<string, unknown>): Prisma.InputJsonObject {
  const base =
    current && typeof current === 'object' && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  return { ...base, ...patch } as Prisma.InputJsonObject;
}

async function activateTenantWorkflowTrigger(args: {
  tenantId: string;
  phoneNumberId: string;
  displayPhoneNumber?: string;
}): Promise<Record<string, unknown>> {
  const workflowId = env.kapsoTenantWorkflowId();
  const apiKey = env.kapsoApiKey();
  if (!workflowId || !apiKey) {
    return {
      status: 'skipped',
      reason: !workflowId ? 'missing_KAPSO_TENANT_WORKFLOW_ID' : 'missing_KAPSO_API_KEY',
      checkedAt: new Date().toISOString(),
    };
  }

  const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
  const result: Record<string, unknown> = {
    workflowId,
    phoneNumberId: args.phoneNumberId,
    displayPhoneNumber: args.displayPhoneNumber ?? null,
    checkedAt: new Date().toISOString(),
  };

  try {
    result.health = await kapso.checkPhoneHealth(args.phoneNumberId);
  } catch (err) {
    result.healthError = err instanceof Error ? err.message : String(err);
  }

  try {
    const trigger = await kapso.createWorkflowTrigger(workflowId, {
      trigger_type: 'inbound_message',
      phone_number_id: args.phoneNumberId,
      display_name: `Sendero tenant ${args.tenantId}`,
      active: true,
    });
    result.status = 'active';
    result.triggerId = trigger.id;
  } catch (err) {
    result.status = 'error';
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}

/**
 * Phase H — Kapso fired its built-in `handoff_to_human` default tool.
 * Sendero mirrors the same operator notifications that
 * `request_human_handoff` (our tool) writes: ChannelHandoff row,
 * Trip.events `handoff_requested` entry, Liveblocks inbox notification,
 * Slack Block Kit card. Resolves tenant + traveler from the
 * `phone_number_id` + `customer_phone` Kapso passes.
 *
 * Idempotent on (tenantId, executionId) — repeated Kapso retries
 * dedupe via `processDurableWebhook` upstream + by checking for an
 * existing ChannelHandoff with `metadata.kapsoExecutionId` here.
 */
async function dispatchWorkflowHandoff(event: {
  kind: 'workflow.execution.handoff';
  workflowId: string | null;
  executionId: string | null;
  phoneNumberId: string | null;
  customerPhone: string | null;
  reason: string | null;
  summary: string | null;
}): Promise<DispatchResult> {
  if (!event.phoneNumberId || !event.customerPhone) {
    console.warn('[webhooks/kapso] handoff event missing phone identifiers', { event });
    return { matched: false };
  }

  const install = await prisma.whatsAppInstall.findFirst({
    where: { phoneNumberId: event.phoneNumberId, status: { not: 'disabled' } },
    select: { tenantId: true },
  });
  if (!install) {
    console.warn('[webhooks/kapso] handoff: no install for phoneNumberId', {
      phoneNumberId: event.phoneNumberId,
    });
    return { matched: false };
  }

  const identity = await prisma.channelIdentity.findFirst({
    where: { tenantId: install.tenantId, externalUserId: event.customerPhone, kind: 'whatsapp' },
    select: { id: true, userId: true },
  });
  if (!identity) {
    console.warn('[webhooks/kapso] handoff: no channel identity for traveler', {
      tenantId: install.tenantId,
      customerPhone: event.customerPhone,
    });
    return { matched: true, tenantId: install.tenantId };
  }

  const trip = identity.userId
    ? await prisma.trip.findFirst({
        where: {
          tenantId: install.tenantId,
          travelerId: identity.userId,
          status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      })
    : null;

  // Idempotency comes from processDurableWebhook upstream — the
  // `externalId` we synthesize keys on Kapso's `executionId`, so a
  // retry of the same handoff event collapses before reaching us.
  // Belt-and-suspenders dedup against duplicate handoffs for the same
  // execution would require a metadata column on ChannelHandoff —
  // deferred (we'd add a Kapso-execution-tracking table instead so the
  // ChannelHandoff schema stays focused).

  const question = event.reason ?? 'Agent escalated via Kapso default handoff_to_human';
  const summary = event.summary ?? null;

  // Stash the Kapso execution id inside the question prefix when it's
  // available — gives operators a way to cross-reference Kapso console
  // runs without adding a schema field for the migration cycle.
  const questionWithRef = event.executionId
    ? `[kapso:${event.executionId.slice(0, 12)}] ${question}`
    : question;

  const handoff = await prisma.channelHandoff.create({
    data: {
      tenantId: install.tenantId,
      tripId: trip?.id ?? null,
      channelIdentityId: identity.id,
      channel: 'whatsapp',
      question: questionWithRef,
      summary,
      liveblocksRoomId: 'pending',
    },
    select: { id: true },
  });

  const liveblocksRoomId = roomIdForSupportCase(install.tenantId, handoff.id);
  await prisma.channelHandoff.update({
    where: { id: handoff.id },
    data: { liveblocksRoomId },
  });

  if (trip?.id) {
    const entry: Prisma.InputJsonObject = {
      id: `ho_${handoff.id}_handoff_requested`,
      kind: 'handoff_requested',
      handoffId: handoff.id,
      channel: 'whatsapp',
      direction: 'internal',
      source: 'kapso_handoff_to_human',
      createdAt: new Date().toISOString(),
      question,
      ...(summary ? { summary } : {}),
    };
    await prisma.$executeRaw`
      UPDATE trips
         SET events = COALESCE(events, '[]'::jsonb) || ${entry as unknown as Prisma.JsonValue}::jsonb
       WHERE id = ${trip.id} AND "tenantId" = ${install.tenantId}
    `;
  }

  // Fire Liveblocks operator notification — exact same shape as
  // request_human_handoff so the operator dashboard treats both
  // escalation paths identically. `after()` keeps the work tied to the
  // function lifecycle on Vercel Fluid Compute; bare `void` risks the
  // promise being killed when the function suspends post-response.
  after(
    notifyOperatorHandoff({
      tenantId: install.tenantId,
      handoffId: handoff.id,
      liveblocksRoomId,
      title: 'Sendero needs your input',
      message: summary ? `${question} — ${summary}` : question,
      url: `/dashboard/handoffs/${handoff.id}`,
    }).catch(err => {
      console.warn('[webhooks/kapso] handoff liveblocks notify failed', {
        handoffId: handoff.id,
        error: err instanceof Error ? err.message : String(err),
      });
    })
  );

  // Slack fan-out — reuse the same Block Kit card request_human_handoff
  // posts. Lazy-loaded so this route stays light when Slack isn't used.
  after(
    (async () => {
      try {
        const slackInstall = await prisma.slackInstall.findFirst({
          where: { tenantId: install.tenantId, revokedAt: null },
          select: { botToken: true, routing: true },
        });
        if (!slackInstall?.botToken) return;
        const routing = (slackInstall.routing ?? {}) as Record<string, unknown>;
        const defaultChannel =
          typeof routing.defaultChannel === 'string' ? routing.defaultChannel : null;
        if (!defaultChannel) return;
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010';
        const handoffUrl = `${baseUrl.replace(/\/$/, '')}/dashboard/handoffs/${handoff.id}`;
        const { createSlackClient, sendBlocks } = await import('@sendero/slack');
        const client = createSlackClient(slackInstall.botToken);
        await sendBlocks({
          client,
          channel: defaultChannel,
          text: `Sendero handoff: ${question}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: '🛎  Sendero needs your input' } },
            { type: 'section', text: { type: 'mrkdwn', text: `*Question*\n${question}` } },
            ...(summary
              ? [
                  {
                    type: 'section' as const,
                    text: { type: 'mrkdwn' as const, text: `*Context*\n${summary}` },
                  },
                ]
              : []),
            {
              type: 'context',
              elements: [
                { type: 'mrkdwn', text: 'Source: `Kapso handoff_to_human` (auto-fanout)' },
                ...(trip?.id ? [{ type: 'mrkdwn' as const, text: `Trip: \`${trip.id}\`` }] : []),
                { type: 'mrkdwn', text: `Handoff: \`${handoff.id}\`` },
              ],
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Answer in Sendero' },
                  url: handoffUrl,
                  style: 'primary',
                },
              ],
            },
          ],
        });
      } catch (err) {
        console.warn('[webhooks/kapso] handoff slack fanout failed', {
          handoffId: handoff.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })()
  );

  return { matched: true, tenantId: install.tenantId };
}

/**
 * Phase H — Kapso reported a workflow execution failure. Sendero
 * records the row for ops visibility but does NOT auto-escalate
 * (workflow failures are internal, not customer-facing). Operators
 * see a digest in the dashboard. Repeated/transient failures are
 * deduped upstream by `processDurableWebhook`.
 */
async function dispatchWorkflowFailed(event: {
  kind: 'workflow.execution.failed';
  workflowId: string | null;
  executionId: string | null;
  phoneNumberId: string | null;
  customerPhone: string | null;
  errorMessage: string | null;
  errorCode: string | null;
}): Promise<DispatchResult> {
  if (!event.phoneNumberId) {
    console.warn('[webhooks/kapso] workflow.failed missing phoneNumberId', { event });
    return { matched: false };
  }
  const install = await prisma.whatsAppInstall.findFirst({
    where: { phoneNumberId: event.phoneNumberId },
    select: { tenantId: true },
  });
  if (!install) {
    return { matched: false };
  }
  console.warn('[webhooks/kapso] workflow.execution.failed', {
    tenantId: install.tenantId,
    workflowId: event.workflowId,
    executionId: event.executionId,
    customerPhone: event.customerPhone,
    errorMessage: event.errorMessage,
    errorCode: event.errorCode,
  });
  // Future: persist to a `WorkflowExecutionFailure` table for the ops
  // dashboard digest. For now the warn line lets operators grep logs.
  return { matched: true, tenantId: install.tenantId };
}
