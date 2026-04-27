/**
 * Tests for WhatsApp audit-log writers.
 *
 * Mocks `@sendero/database` (Prisma) at module level so we can verify
 * the exact data passed to each Prisma call without spinning a DB.
 *
 * Run: `bun test apps/app/lib/whatsapp-audit.test.ts`
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

interface InboundRow {
  tenantId: string | null;
  signatureValid: boolean;
  payloadHash: string;
  messageCount: number;
  durationMs: number | null;
}
interface OutboundRow {
  tenantId: string;
  wamid: string;
  source: string;
  kind: string;
  deliveryStatus: string;
  failureReason: string | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
}

const state = {
  inbound: [] as InboundRow[],
  outbound: [] as OutboundRow[],
  outboundUpdates: [] as Array<{
    where: { wamid: string };
    data: Record<string, unknown>;
  }>,
  /** Set in tests to simulate Prisma errors. */
  throwOnInbound: false,
  throwOnOutbound: null as null | { code?: string; message: string },
};

mock.module('@sendero/database', () => ({
  prisma: {
    whatsAppWebhookEvent: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (state.throwOnInbound) throw new Error('inbound boom');
        const d = args.data;
        state.inbound.push({
          tenantId: (d.tenantId as string | null) ?? null,
          signatureValid: d.signatureValid as boolean,
          payloadHash: d.payloadHash as string,
          messageCount: d.messageCount as number,
          durationMs: (d.durationMs as number | null) ?? null,
        });
        return { id: `we_${state.inbound.length}` };
      },
    },
    whatsAppOutboundMessage: {
      create: async (args: { data: Record<string, unknown> }) => {
        if (state.throwOnOutbound) {
          const err = state.throwOnOutbound;
          state.throwOnOutbound = null; // one-shot
          const e = new Error(err.message) as Error & { code?: string };
          if (err.code) e.code = err.code;
          throw e;
        }
        const d = args.data;
        state.outbound.push({
          tenantId: d.tenantId as string,
          wamid: d.wamid as string,
          source: d.source as string,
          kind: d.kind as string,
          deliveryStatus: (d.deliveryStatus as string) ?? 'sent',
          failureReason: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
        });
        return { id: `om_${state.outbound.length}` };
      },
      updateMany: async (args: {
        where: { wamid: string };
        data: Record<string, unknown>;
      }) => {
        state.outboundUpdates.push(args);
        const matches = state.outbound.filter(r => r.wamid === args.where.wamid);
        for (const row of matches) {
          if (typeof args.data.deliveryStatus === 'string')
            row.deliveryStatus = args.data.deliveryStatus;
          if (typeof args.data.failureReason === 'string')
            row.failureReason = args.data.failureReason;
          if (args.data.deliveredAt instanceof Date) row.deliveredAt = args.data.deliveredAt;
          if (args.data.readAt instanceof Date) row.readAt = args.data.readAt;
          if (args.data.failedAt instanceof Date) row.failedAt = args.data.failedAt;
        }
        return { count: matches.length };
      },
    },
  },
}));

const { logOutboundMessage, logWebhookEvent, reconcileOutboundStatus } = await import(
  './whatsapp-audit'
);

beforeEach(() => {
  state.inbound = [];
  state.outbound = [];
  state.outboundUpdates = [];
  state.throwOnInbound = false;
  state.throwOnOutbound = null;
});

afterEach(() => {
  state.inbound = [];
  state.outbound = [];
  state.outboundUpdates = [];
});

describe('logWebhookEvent', () => {
  test('persists hashed payload + counts', async () => {
    await logWebhookEvent({
      tenantId: 'tnt_1',
      receivedAt: new Date('2026-04-27T12:00:00Z'),
      rawBody: '{"object":"whatsapp_business_account"}',
      signatureValid: true,
      replayWindowOk: true,
      messageCount: 2,
      identityChangeCount: 0,
      statusUpdateCount: 1,
      droppedReplayCount: 0,
      droppedDuplicateCount: 0,
      dispatchedCount: 2,
      durationMs: 124,
      traceId: 'trc_abc',
    });
    expect(state.inbound).toHaveLength(1);
    expect(state.inbound[0]!.tenantId).toBe('tnt_1');
    expect(state.inbound[0]!.signatureValid).toBe(true);
    expect(state.inbound[0]!.messageCount).toBe(2);
    // Hash is the raw body sha256.
    expect(state.inbound[0]!.payloadHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('null tenantId allowed (status-only payloads with unknown phone_number_id)', async () => {
    await logWebhookEvent({
      tenantId: null,
      receivedAt: new Date(),
      rawBody: '',
      signatureValid: false,
      replayWindowOk: null,
      messageCount: 0,
      identityChangeCount: 0,
      statusUpdateCount: 0,
      droppedReplayCount: 0,
      droppedDuplicateCount: 0,
      dispatchedCount: 0,
      durationMs: 5,
      traceId: 't1',
    });
    expect(state.inbound[0]!.tenantId).toBeNull();
  });

  test('Prisma error swallowed (audit must never break the hot path)', async () => {
    state.throwOnInbound = true;
    await logWebhookEvent({
      tenantId: 'tnt_1',
      receivedAt: new Date(),
      rawBody: '{}',
      signatureValid: true,
      replayWindowOk: true,
      messageCount: 0,
      identityChangeCount: 0,
      statusUpdateCount: 0,
      droppedReplayCount: 0,
      droppedDuplicateCount: 0,
      dispatchedCount: 0,
      durationMs: 1,
      traceId: 't1',
    });
    // No throw, no row.
    expect(state.inbound).toHaveLength(0);
  });
});

describe('logOutboundMessage', () => {
  test('persists wamid + source + kind + preview', async () => {
    await logOutboundMessage({
      tenantId: 'tnt_1',
      phoneNumberId: 'PNID_1',
      source: 'agent_reply',
      traceId: 'trc_1',
      event: {
        wamid: 'wamid.ABC',
        kind: 'text',
        recipientId: '+15555550100',
        preview: 'Your booking is confirmed.',
      },
    });
    expect(state.outbound).toHaveLength(1);
    expect(state.outbound[0]!.wamid).toBe('wamid.ABC');
    expect(state.outbound[0]!.source).toBe('agent_reply');
    expect(state.outbound[0]!.kind).toBe('text');
    expect(state.outbound[0]!.deliveryStatus).toBe('sent');
  });

  test('P2002 (duplicate wamid) swallowed silently', async () => {
    state.throwOnOutbound = { code: 'P2002', message: 'unique violation' };
    await logOutboundMessage({
      tenantId: 'tnt_1',
      phoneNumberId: 'PNID_1',
      source: 'agent_reply',
      event: { wamid: 'wamid.DUP', kind: 'text', recipientId: '+1' },
    });
    expect(state.outbound).toHaveLength(0);
  });

  test('non-P2002 errors are also swallowed (logged) — never break send path', async () => {
    state.throwOnOutbound = { message: 'connection refused' };
    await logOutboundMessage({
      tenantId: 'tnt_1',
      phoneNumberId: 'PNID_1',
      source: 'agent_reply',
      event: { wamid: 'wamid.X', kind: 'text', recipientId: '+1' },
    });
    expect(state.outbound).toHaveLength(0);
  });
});

describe('reconcileOutboundStatus', () => {
  test('delivered → sets deliveryStatus + deliveredAt', async () => {
    state.outbound.push({
      tenantId: 'tnt_1',
      wamid: 'wamid.X',
      source: 'agent_reply',
      kind: 'text',
      deliveryStatus: 'sent',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    });
    const at = new Date('2026-04-27T13:00:00Z');
    const count = await reconcileOutboundStatus({
      wamid: 'wamid.X',
      status: 'delivered',
      failureReason: null,
      at,
    });
    expect(count).toBe(1);
    expect(state.outbound[0]!.deliveryStatus).toBe('delivered');
    expect(state.outbound[0]!.deliveredAt).toEqual(at);
    expect(state.outbound[0]!.readAt).toBeNull();
  });

  test('read → sets readAt', async () => {
    state.outbound.push({
      tenantId: 'tnt_1',
      wamid: 'wamid.Y',
      source: 'agent_reply',
      kind: 'text',
      deliveryStatus: 'delivered',
      failureReason: null,
      deliveredAt: new Date(),
      readAt: null,
      failedAt: null,
    });
    const at = new Date('2026-04-27T13:01:00Z');
    await reconcileOutboundStatus({ wamid: 'wamid.Y', status: 'read', failureReason: null, at });
    expect(state.outbound[0]!.readAt).toEqual(at);
  });

  test('failed → sets failedAt + failureReason', async () => {
    state.outbound.push({
      tenantId: 'tnt_1',
      wamid: 'wamid.Z',
      source: 'agent_reply',
      kind: 'text',
      deliveryStatus: 'sent',
      failureReason: null,
      deliveredAt: null,
      readAt: null,
      failedAt: null,
    });
    const at = new Date('2026-04-27T13:02:00Z');
    await reconcileOutboundStatus({
      wamid: 'wamid.Z',
      status: 'failed',
      failureReason: 'Receiver incapable',
      at,
    });
    expect(state.outbound[0]!.deliveryStatus).toBe('failed');
    expect(state.outbound[0]!.failureReason).toBe('Receiver incapable');
    expect(state.outbound[0]!.failedAt).toEqual(at);
  });

  test('unknown wamid returns 0 (no row to reconcile)', async () => {
    const count = await reconcileOutboundStatus({
      wamid: 'wamid.NEVER',
      status: 'delivered',
      failureReason: null,
      at: new Date(),
    });
    expect(count).toBe(0);
  });
});
