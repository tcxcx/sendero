/**
 * Canonical ChannelMessage fixtures shared across operator + slack +
 * whatsapp + web renderer tests. One factory per discriminator so a
 * single change to the union surfaces in every test that reads it.
 *
 * Each factory accepts a partial override patch and returns a fully
 * typed ChannelMessage. Renderers are pure mappers, so deterministic
 * inputs let snapshot tests stay byte-stable.
 */

import type {
  ChannelMessage,
  ChannelMessageApprovalRequest,
  ChannelMessageCard,
  ChannelMessageReasoning,
  ChannelMessageSources,
  ChannelMessageText,
  ChannelMessageToolInvocation,
  ChannelMessageToolResult,
} from '../../types';

const FROZEN_AT = '2026-04-25T10:00:00.000Z';

const AGENT_AUTHOR = { role: 'agent' as const, name: 'Sendero AI' };
const TRAVELER_AUTHOR = { role: 'traveler' as const, name: 'Casey Traveler' };

export const fixtures = {
  text(overrides: Partial<ChannelMessageText> = {}): ChannelMessageText {
    return {
      kind: 'text',
      id: 'msg-text-1',
      author: AGENT_AUTHOR,
      content: 'Booked **AA 100** JFK to LHR. See [itinerary](https://sendero.travel/i/abc).',
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  card(overrides: Partial<ChannelMessageCard> = {}): ChannelMessageCard {
    return {
      kind: 'card',
      id: 'msg-card-1',
      author: AGENT_AUTHOR,
      title: 'Itinerary held',
      body: 'JFK to LHR on Apr 30. Hold expires in 15 minutes.',
      bullets: ['Departs 21:30 EDT', 'Economy Plus', 'Refundable'],
      ctas: [
        { kind: 'approve', label: 'Confirm', value: 'booking-1', emphasis: 'primary' },
        { kind: 'reject', label: 'Cancel', value: 'booking-1', emphasis: 'secondary' },
      ],
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  toolInvocation(
    overrides: Partial<ChannelMessageToolInvocation> = {}
  ): ChannelMessageToolInvocation {
    return {
      kind: 'tool_invocation',
      id: 'msg-tool-inv-1',
      author: AGENT_AUTHOR,
      toolName: 'search_offers',
      input: { origin: 'JFK', destination: 'LHR', date: '2026-04-30' },
      status: 'streaming',
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  toolResult(overrides: Partial<ChannelMessageToolResult> = {}): ChannelMessageToolResult {
    return {
      kind: 'tool_result',
      id: 'msg-tool-result-1',
      author: AGENT_AUTHOR,
      toolName: 'search_offers',
      result: { offers: [{ id: 'off-1', total: '482.10' }] },
      share: {
        title: 'Best fare found',
        body: 'AA 100, JFK to LHR, $482.10 all-in.',
        bullets: ['1 stop', '8h 5m', 'Refundable'],
        primaryCta: { kind: 'select_offer', label: 'Hold this fare', value: 'off-1' },
      },
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  approvalRequest(
    overrides: Partial<ChannelMessageApprovalRequest> = {}
  ): ChannelMessageApprovalRequest {
    return {
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
      ...overrides,
    };
  },

  reasoning(overrides: Partial<ChannelMessageReasoning> = {}): ChannelMessageReasoning {
    return {
      kind: 'reasoning',
      id: 'msg-reasoning-1',
      author: AGENT_AUTHOR,
      content: 'Compared 4 offers, AA 100 wins on total cost and refundability.',
      collapsedByDefault: true,
      durationMs: 1820,
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  sources(overrides: Partial<ChannelMessageSources> = {}): ChannelMessageSources {
    return {
      kind: 'sources',
      id: 'msg-sources-1',
      author: AGENT_AUTHOR,
      items: [
        { title: 'AA flight status', url: 'https://aa.com/flights/100' },
        { title: 'Heathrow arrivals', url: 'https://heathrow.com/arrivals' },
      ],
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },
} as const;

export const travelerAuthor = TRAVELER_AUTHOR;

/** Convenience: every kind, in declaration order. Useful for exhaustive loops. */
export function allFixtures(): ChannelMessage[] {
  return [
    fixtures.text(),
    fixtures.card(),
    fixtures.toolInvocation(),
    fixtures.toolResult(),
    fixtures.approvalRequest(),
    fixtures.reasoning(),
    fixtures.sources(),
  ];
}
