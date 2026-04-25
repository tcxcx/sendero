import { describe, expect, it } from 'bun:test';
import {
  handleClaimLockoutTriggered,
  type AlertSenders,
  type ClaimLockoutEvent,
  type SecurityAlertDeps,
  type SecurityAlertInput,
  type TenantRow,
} from './security-alerts';

const tripId = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const buyerAddr = '0xAbCdEf0123456789abcdef0123456789ABCDEF01' as const;

function eventFixture(): ClaimLockoutEvent {
  return {
    tripId,
    lockedUntil: 1_800_000_000n,
    txHash: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    blockNumber: 12345n,
  };
}

function makeSenders(overrides?: Partial<AlertSenders>): AlertSenders & {
  emailCalls: Array<[string, string]>;
  slackCalls: Array<[string, string]>;
  whatsappCalls: Array<[string, string]>;
} {
  const emailCalls: Array<[string, string]> = [];
  const slackCalls: Array<[string, string]> = [];
  const whatsappCalls: Array<[string, string]> = [];
  return {
    emailCalls,
    slackCalls,
    whatsappCalls,
    sendSecurityAlertEmail:
      overrides?.sendSecurityAlertEmail ??
      (async (to, subject) => {
        emailCalls.push([to, subject]);
        return { ok: true };
      }),
    sendSecurityAlertSlack:
      overrides?.sendSecurityAlertSlack ??
      (async (channel, subject) => {
        slackCalls.push([channel, subject]);
        return { ok: true };
      }),
    sendSecurityAlertWhatsapp:
      overrides?.sendSecurityAlertWhatsapp ??
      (async (phone, subject) => {
        whatsappCalls.push([phone, subject]);
        return { ok: true };
      }),
  };
}

function makeDeps(opts: {
  tenant: TenantRow | null;
  senders: AlertSenders;
}): SecurityAlertDeps & { persisted: SecurityAlertInput[] } {
  const persisted: SecurityAlertInput[] = [];
  return {
    persisted,
    appOrigin: 'https://app.sendero.travel',
    senders: opts.senders,
    async readBuyerAddress() {
      return buyerAddr;
    },
    async findTenantByBuyer() {
      return opts.tenant;
    },
    async persistAlert(input) {
      persisted.push(input);
      return { id: `alert_${persisted.length}` };
    },
  };
}

describe('handleClaimLockoutTriggered', () => {
  it('writes claim_lockout_unknown_buyer with no notifications when buyer is unknown', async () => {
    const senders = makeSenders();
    const deps = makeDeps({ tenant: null, senders });

    const result = await handleClaimLockoutTriggered(eventFixture(), deps);

    expect(result.unknownBuyer).toBe(true);
    expect(result.notificationsSent).toBe(0);
    expect(senders.emailCalls.length).toBe(0);
    expect(senders.slackCalls.length).toBe(0);
    expect(senders.whatsappCalls.length).toBe(0);
    expect(deps.persisted.length).toBe(1);
    expect(deps.persisted[0]!.kind).toBe('claim_lockout_unknown_buyer');
    expect(deps.persisted[0]!.tenantId).toBeNull();
    expect((deps.persisted[0]!.payload as { buyerAddress: string }).buyerAddress).toBe(
      buyerAddr.toLowerCase()
    );
  });

  it('sends exactly one notification when only email is configured', async () => {
    const senders = makeSenders();
    const deps = makeDeps({
      tenant: {
        id: 'tenant_1',
        displayName: 'Acme Travel',
        metadata: { notificationContactEmail: 'ops@acme.test' },
      },
      senders,
    });

    const result = await handleClaimLockoutTriggered(eventFixture(), deps);

    expect(result.unknownBuyer).toBe(false);
    expect(result.notificationsSent).toBe(1);
    expect(senders.emailCalls.length).toBe(1);
    expect(senders.emailCalls[0]![0]).toBe('ops@acme.test');
    expect(senders.slackCalls.length).toBe(0);
    expect(senders.whatsappCalls.length).toBe(0);
    expect(deps.persisted.length).toBe(1);
    expect(deps.persisted[0]!.kind).toBe('claim_lockout');
    expect(deps.persisted[0]!.severity).toBe('high');
    expect(deps.persisted[0]!.tenantId).toBe('tenant_1');
  });

  it('sends three notifications when email + slack + whatsapp are all configured', async () => {
    const senders = makeSenders();
    const deps = makeDeps({
      tenant: {
        id: 'tenant_1',
        displayName: 'Acme Travel',
        metadata: {
          notificationContactEmail: 'ops@acme.test',
          notificationSlackChannelId: 'C0XYZ',
          notificationWhatsappPhone: '+12025551234',
        },
      },
      senders,
    });

    const result = await handleClaimLockoutTriggered(eventFixture(), deps);

    expect(result.notificationsSent).toBe(3);
    expect(senders.emailCalls.length).toBe(1);
    expect(senders.slackCalls.length).toBe(1);
    expect(senders.whatsappCalls.length).toBe(1);
    expect(deps.persisted.length).toBe(1);
    const fanout = (
      deps.persisted[0]!.payload as { fanout: Array<{ channel: string; ok: boolean }> }
    ).fanout;
    expect(fanout.length).toBe(3);
    expect(fanout.every(f => f.ok)).toBe(true);
  });

  it('persists the SecurityAlert even when one channel throws (Slack failure)', async () => {
    const senders = makeSenders({
      async sendSecurityAlertSlack() {
        throw new Error('slack:post_message_failed:rate_limited');
      },
    });
    const deps = makeDeps({
      tenant: {
        id: 'tenant_1',
        displayName: 'Acme Travel',
        metadata: {
          notificationContactEmail: 'ops@acme.test',
          notificationSlackChannelId: 'C0XYZ',
          notificationWhatsappPhone: '+12025551234',
        },
      },
      senders,
    });

    const result = await handleClaimLockoutTriggered(eventFixture(), deps);

    // Email + WhatsApp succeeded, Slack failed → 2 successful sends.
    expect(result.notificationsSent).toBe(2);
    expect(deps.persisted.length).toBe(1);
    const fanout = (
      deps.persisted[0]!.payload as {
        fanout: Array<{ channel: string; ok: boolean; error?: string }>;
      }
    ).fanout;
    const slackOutcome = fanout.find(f => f.channel === 'slack');
    expect(slackOutcome).toBeDefined();
    expect(slackOutcome!.ok).toBe(false);
    expect(slackOutcome!.error).toContain('slack:post_message_failed');
  });
});
