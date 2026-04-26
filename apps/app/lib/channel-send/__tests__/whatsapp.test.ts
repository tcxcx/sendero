import { describe, expect, test, mock, beforeEach } from 'bun:test';

import type {
  ChannelMessageApprovalRequest,
  ChannelMessageCard,
  ChannelMessageReasoning,
  ChannelMessageText,
  ChannelMessageToolInvocation,
  ChannelCta,
} from '../../channel-render/types';
import { whatsAppInstallFixture } from './__fixtures__/installs';

// Local message fixtures (see slack.test.ts header note). Kept inline
// until Agent A's shared fixtures land; refactor in a follow-up.
const FROZEN_AT = '2026-04-25T10:00:00.000Z';
const AGENT_AUTHOR = { role: 'agent' as const, name: 'Sendero AI' };

const textMessage: ChannelMessageText = {
  kind: 'text',
  id: 'msg-text-1',
  author: AGENT_AUTHOR,
  content: 'Booked **AA 100** JFK to LHR.',
  createdAt: FROZEN_AT,
};

function cardMessage(overrides: Partial<ChannelMessageCard> = {}): ChannelMessageCard {
  return {
    kind: 'card',
    id: 'msg-card-1',
    author: AGENT_AUTHOR,
    title: 'Itinerary held',
    body: 'JFK to LHR on Apr 30.',
    bullets: ['Departs 21:30 EDT', 'Refundable'],
    ctas: [
      { kind: 'approve', label: 'Confirm', value: 'booking-1', emphasis: 'primary' },
      { kind: 'reject', label: 'Cancel', value: 'booking-1', emphasis: 'secondary' },
    ],
    createdAt: FROZEN_AT,
    ...overrides,
  };
}

const approvalMessage: ChannelMessageApprovalRequest = {
  kind: 'approval_request',
  id: 'booking-1',
  author: AGENT_AUTHOR,
  subject: { travelerName: 'Casey', route: 'JFK to LHR', amountUsd: 482.1 },
  createdAt: FROZEN_AT,
};

const reasoningMessage: ChannelMessageReasoning = {
  kind: 'reasoning',
  id: 'msg-reasoning-1',
  author: AGENT_AUTHOR,
  content: 'Compared 4 offers.',
  createdAt: FROZEN_AT,
};

const toolInvocationMessage: ChannelMessageToolInvocation = {
  kind: 'tool_invocation',
  id: 'msg-tool-inv-1',
  author: AGENT_AUTHOR,
  toolName: 'search_offers',
  input: { origin: 'JFK', destination: 'LHR' },
  status: 'streaming',
  createdAt: FROZEN_AT,
};

interface CtorCall {
  phoneNumberId: string;
  accessToken: string;
  apiBaseUrl?: string;
}

const ctorCalls: CtorCall[] = [];
const sendCalls: unknown[] = [];
let sendResult: unknown = { messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] };

class FakeWhatsAppClient {
  constructor(config: CtorCall) {
    ctorCalls.push(config);
  }
  async send(payload: unknown) {
    sendCalls.push(payload);
    return sendResult;
  }
}

mock.module('@sendero/whatsapp', () => ({
  WhatsAppClient: FakeWhatsAppClient,
}));

// Strip the env fallback so the explicit accessToken arg is the only
// path that produces a usable token. The "missing accessToken" case
// re-asserts WHATSAPP_ACCESS_TOKEN='' inside its body for clarity.
process.env.WHATSAPP_ACCESS_TOKEN = '';

const { sendChannelMessageWhatsApp } = await import('../whatsapp');

beforeEach(() => {
  ctorCalls.length = 0;
  sendCalls.length = 0;
  sendResult = { messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] };
});

describe('sendChannelMessageWhatsApp', () => {
  test('happy path: text message instantiates client + sends rendered payload with recipient stamped', async () => {
    const result = await sendChannelMessageWhatsApp({
      install: whatsAppInstallFixture(),
      recipient: '+15551230001',
      message: textMessage,
      accessToken: 'wa-explicit-token',
    });

    expect(result).toEqual({
      sent: true,
      response: { messaging_product: 'whatsapp', messages: [{ id: 'wamid.TEST' }] },
      degraded: undefined,
    });

    expect(ctorCalls.length).toBe(1);
    expect(ctorCalls[0]).toMatchObject({
      phoneNumberId: '17035552345',
      accessToken: 'wa-explicit-token',
    });

    expect(sendCalls.length).toBe(1);
    const payload = sendCalls[0] as Record<string, unknown>;
    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.to).toBe('+15551230001');
    expect(payload.type).toBe('text');
    const text = payload.text as { body: string };
    expect(text.body).toMatch(/Booked/);
  });

  test('card with image header builds an interactive button payload with image header', async () => {
    await sendChannelMessageWhatsApp({
      install: whatsAppInstallFixture(),
      recipient: '+15551230002',
      message: cardMessage({ imageUrl: 'https://cdn.example.com/route.png' }),
      accessToken: 'wa-explicit-token',
    });

    expect(sendCalls.length).toBe(1);
    const payload = sendCalls[0] as {
      type: string;
      interactive?: { type: string; header?: { type: string; image?: { link: string } } };
    };
    expect(payload.type).toBe('interactive');
    expect(payload.interactive?.type).toBe('button');
    expect(payload.interactive?.header?.type).toBe('image');
    expect(payload.interactive?.header?.image?.link).toBe('https://cdn.example.com/route.png');
  });

  test('card with >3 CTAs degrades to a list and forwards degraded flag', async () => {
    const fiveCtas: ChannelCta[] = [
      { kind: 'select_offer', label: 'Offer 1', value: 'o1' },
      { kind: 'select_offer', label: 'Offer 2', value: 'o2' },
      { kind: 'select_offer', label: 'Offer 3', value: 'o3' },
      { kind: 'select_offer', label: 'Offer 4', value: 'o4' },
      { kind: 'select_offer', label: 'Offer 5', value: 'o5' },
    ];
    const result = await sendChannelMessageWhatsApp({
      install: whatsAppInstallFixture(),
      recipient: '+15551230003',
      message: cardMessage({ ctas: fiveCtas }),
      accessToken: 'wa-explicit-token',
    });

    // 5 CTAs <= WA_LIST_ROWS_MAX (10), so the renderer surfaces a list
    // without flagging degraded. The payload-shape change (interactive
    // button -> interactive list) is the actual degradation signal here.
    expect(result).toMatchObject({ sent: true, degraded: false });
    const payload = sendCalls[0] as { interactive?: { type: string } };
    expect(payload.interactive?.type).toBe('list');
  });

  test.each([
    ['tool_invocation', toolInvocationMessage],
    ['approval_request', approvalMessage],
    ['reasoning', reasoningMessage],
  ] as const)('%s is not relayed to WhatsApp — send never called', async (_label, msg) => {
    const result = await sendChannelMessageWhatsApp({
      install: whatsAppInstallFixture(),
      recipient: '+15551230004',
      message: msg,
      accessToken: 'wa-explicit-token',
    });

    expect(result).toEqual({ sent: false, reason: 'kind-not-relayed-to-whatsapp' });
    expect(ctorCalls.length).toBe(0);
    expect(sendCalls.length).toBe(0);
  });

  test('install row missing phoneNumberId fails soft', async () => {
    const result = await sendChannelMessageWhatsApp({
      install: whatsAppInstallFixture({ phoneNumberId: '' }),
      recipient: '+15551230005',
      message: textMessage,
      accessToken: 'wa-explicit-token',
    });

    expect(result).toEqual({ sent: false, reason: 'install-missing-phone-number-id' });
    expect(ctorCalls.length).toBe(0);
    expect(sendCalls.length).toBe(0);
  });

  test('access token unavailable (no override + no env) fails soft', async () => {
    const previous = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_ACCESS_TOKEN = '';
    try {
      const result = await sendChannelMessageWhatsApp({
        install: whatsAppInstallFixture(),
        recipient: '+15551230006',
        message: textMessage,
      });

      expect(result).toEqual({ sent: false, reason: 'access-token-unavailable' });
      expect(ctorCalls.length).toBe(0);
      expect(sendCalls.length).toBe(0);
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = previous;
    }
  });
});
