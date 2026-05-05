import { describe, expect, test, mock, beforeEach } from 'bun:test';

import type {
  ChannelMessageApprovalRequest,
  ChannelMessageCard,
  ChannelMessageEsimActivation,
  ChannelMessageReasoning,
  ChannelMessageText,
  ChannelMessageToolInvocation,
} from '../../channel-render/types';
import { slackInstallFixture } from './__fixtures__/installs';

// Local message fixtures. The cross-channel-renderer suite (Agent A)
// publishes a shared `__fixtures__/messages.ts`; once it lands, refactor
// this block to import from there. Keeping them inline today preserves
// independence between the two parallel test suites.
const FROZEN_AT = '2026-04-25T10:00:00.000Z';
const AGENT_AUTHOR = { role: 'agent' as const, name: 'Sendero AI' };

const textMessage: ChannelMessageText = {
  kind: 'text',
  id: 'msg-text-1',
  author: AGENT_AUTHOR,
  content: 'Booked **AA 100** JFK to LHR.',
  createdAt: FROZEN_AT,
};

const cardMessage: ChannelMessageCard = {
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
};

const approvalMessage: ChannelMessageApprovalRequest = {
  kind: 'approval_request',
  id: 'booking-1',
  author: AGENT_AUTHOR,
  subject: {
    travelerName: 'Casey Traveler',
    route: 'JFK to LHR',
    amountUsd: 482.1,
    expiresAt: '2026-04-25T10:15:00.000Z',
    reason: 'over_policy_cap',
  },
  reviewUrl: 'https://sendero.travel/dashboard/console?tripId=trip-1',
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

const esimActivationMessage: ChannelMessageEsimActivation = {
  kind: 'esim_activation',
  id: 'msg-esim-1',
  author: AGENT_AUTHOR,
  esimId: 'esim_test_001',
  planLabel: '5 GB · 30 days · Japan + Korea',
  countries: ['JP', 'KR'],
  dataMb: 5120,
  validityDays: 30,
  qrUrl: 'https://app.sendero.travel/api/esim/qr/abc.def.png',
  lpaCode: 'LPA:1$smdp.example.com$ACTIVATION_TEST',
  installUrl: 'https://app.sendero.travel/install/esim/abc.def',
  priceLine: '$3.00 · charged to your wallet',
  createdAt: FROZEN_AT,
};

interface SendBlocksCall {
  client: unknown;
  channel: string;
  threadTs: string | undefined;
  text: string;
  blocks: unknown;
}

const createClientCalls: string[] = [];
const sendBlocksCalls: SendBlocksCall[] = [];
const FAKE_CLIENT = { _fake: 'webclient' } as const;
let sendBlocksResult: { channel: string; ts: string } = { channel: 'C123', ts: '1700000000.0001' };

mock.module('@sendero/slack', () => ({
  createSlackClient: (token: string) => {
    createClientCalls.push(token);
    return FAKE_CLIENT;
  },
  sendBlocks: async (args: SendBlocksCall) => {
    sendBlocksCalls.push(args);
    return sendBlocksResult;
  },
  // The Slack channel renderer (loaded transitively through the
  // orchestrator) imports buildApprovalBlocks. Provide a recognizable
  // sentinel so the approval test can assert the right path was taken
  // without dragging in real Slack types.
  buildApprovalBlocks: (
    args: { bookingId: string; travelerName: string; route: string; amountUsd: number },
    reviewUrl?: string
  ) => [
    { type: 'section', text: { type: 'mrkdwn', text: '__APPROVAL_BLOCKS__' } },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: JSON.stringify({ ...args, reviewUrl }) }],
    },
  ],
}));

const { sendChannelMessageSlack } = await import('../slack');

beforeEach(() => {
  createClientCalls.length = 0;
  sendBlocksCalls.length = 0;
  sendBlocksResult = { channel: 'C123', ts: '1700000000.0001' };
});

describe('sendChannelMessageSlack', () => {
  test('happy path: text message reaches sendBlocks with the rendered native shape', async () => {
    const result = await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'C123',
      message: textMessage,
    });

    expect(result).toEqual({
      sent: true,
      channel: 'C123',
      ts: '1700000000.0001',
      degraded: undefined,
    });

    expect(createClientCalls).toEqual(['xoxb-test-token']);
    expect(sendBlocksCalls.length).toBe(1);
    const call = sendBlocksCalls[0]!;
    expect(call.client).toBe(FAKE_CLIENT);
    expect(call.channel).toBe('C123');
    expect(call.threadTs).toBeUndefined();
    expect(call.text).toMatch(/Booked/);
    expect(Array.isArray(call.blocks)).toBe(true);
    const blocks = call.blocks as Array<{ type: string }>;
    expect(blocks[0]?.type).toBe('section');
  });

  test('happy path: card with CTAs forwards header + actions blocks with sendero_<kind>.<value> action_ids', async () => {
    await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'C-CARD',
      message: cardMessage,
    });

    expect(sendBlocksCalls.length).toBe(1);
    const blocks = sendBlocksCalls[0]!.blocks as Array<Record<string, unknown>>;
    const kinds = blocks.map(b => b.type);
    expect(kinds).toContain('header');
    expect(kinds).toContain('actions');

    const actions = blocks.find(b => b.type === 'actions') as
      | { elements: Array<{ action_id: string; text: { text: string } }> }
      | undefined;
    expect(actions).toBeDefined();
    const actionIds = actions!.elements.map(e => e.action_id);
    expect(actionIds).toEqual(['sendero_approve.booking-1', 'sendero_reject.booking-1']);
  });

  test('approval_request routes through buildApprovalBlocks', async () => {
    await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'D-DM-OPERATOR',
      message: approvalMessage,
    });

    expect(sendBlocksCalls.length).toBe(1);
    const call = sendBlocksCalls[0]!;
    expect(call.text).toBe('Approval requested: Casey Traveler');
    const blocks = call.blocks as Array<Record<string, unknown>>;
    const sentinel = blocks.find(
      b => b.type === 'section' && (b.text as { text?: string })?.text === '__APPROVAL_BLOCKS__'
    );
    expect(sentinel).toBeDefined();
  });

  test('reasoning kind is not relayed to Slack — sendBlocks never called', async () => {
    const result = await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'C-NOPE',
      message: reasoningMessage,
    });

    expect(result).toEqual({ sent: false, reason: 'kind-not-relayed-to-slack' });
    expect(createClientCalls.length).toBe(0);
    expect(sendBlocksCalls.length).toBe(0);
  });

  test('tool_invocation forwards the renderer degraded:true flag', async () => {
    const result = await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'D-OPERATOR',
      message: toolInvocationMessage,
    });

    expect(result).toEqual({
      sent: true,
      channel: 'C123',
      ts: '1700000000.0001',
      degraded: true,
    });
  });

  test('threadTs is forwarded to sendBlocks when supplied', async () => {
    await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'C-THREAD',
      threadTs: '1699999999.000100',
      message: textMessage,
    });

    expect(sendBlocksCalls[0]?.threadTs).toBe('1699999999.000100');
  });

  test('esim_activation routes through to sendBlocks with QR + install-URL primary CTA', async () => {
    const result = await sendChannelMessageSlack({
      install: slackInstallFixture(),
      channel: 'C-ESIM',
      message: esimActivationMessage,
    });
    if (!result.sent) throw new Error(`expected sent, got ${result.reason}`);

    const call = sendBlocksCalls[0]!;
    expect(call.text).toBe('Trip eSIM ready: 5 GB · 30 days · Japan + Korea');

    const blocks = call.blocks as Array<{ type: string }>;
    expect(blocks.map(b => b.type)).toEqual([
      'header',
      'section',
      'image',
      'actions',
      'context',
    ]);

    // Image block carries the signed QR URL.
    const image = blocks[2] as unknown as { image_url: string };
    expect(image.image_url).toBe('https://app.sendero.travel/api/esim/qr/abc.def.png');

    // Primary action button URL = universal install page.
    const actions = blocks[3] as unknown as {
      elements: Array<{ url?: string; style?: string; text?: { text?: string } }>;
    };
    expect(actions.elements[0].url).toBe('https://app.sendero.travel/install/esim/abc.def');
    expect(actions.elements[0].style).toBe('primary');
    expect(actions.elements[0].text?.text).toContain('Install');
    expect(actions.elements[1].url).toContain('#instructions');
  });
});
