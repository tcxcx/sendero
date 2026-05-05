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
  ChannelMessageAncillaryPicker,
  ChannelMessageApprovalRequest,
  ChannelMessageCard,
  ChannelMessageEsimActivation,
  ChannelMessageReasoning,
  ChannelMessageSeatPicker,
  ChannelMessageSources,
  ChannelMessageText,
  ChannelMessageToolInvocation,
  ChannelMessageToolResult,
  ChannelMessageTripBrief,
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

  esimActivation(
    overrides: Partial<ChannelMessageEsimActivation> = {}
  ): ChannelMessageEsimActivation {
    return {
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
      expiresAt: '2026-05-25T10:00:00.000Z',
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  seatPicker(
    overrides: Partial<ChannelMessageSeatPicker> = {}
  ): ChannelMessageSeatPicker {
    return {
      kind: 'seat_picker',
      id: 'msg-seat-1',
      author: AGENT_AUTHOR,
      tripId: 'trp_test_001',
      offerId: 'off_test_abc',
      passengerId: 'pas_test_001',
      passengerName: 'Casey Traveler',
      options: [
        {
          serviceId: 'sea_001',
          designator: '12A',
          price: '24.00',
          currency: 'USD',
          cabinClass: 'economy',
          disclosures: ['Window'],
        },
        {
          serviceId: 'sea_002',
          designator: '14C',
          price: '18.00',
          currency: 'USD',
          cabinClass: 'economy',
          disclosures: ['Aisle'],
        },
      ],
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  ancillaryPicker(
    overrides: Partial<ChannelMessageAncillaryPicker> = {}
  ): ChannelMessageAncillaryPicker {
    return {
      kind: 'ancillary_picker',
      id: 'msg-ancillary-1',
      author: AGENT_AUTHOR,
      tripId: 'trp_test_001',
      offerId: 'off_test_abc',
      passengerId: 'pas_test_001',
      passengerName: 'Casey Traveler',
      bags: [
        {
          serviceId: 'bag_001',
          label: 'Carry-on bag',
          price: '0.00',
          currency: 'USD',
          weightKg: 7,
          dimensions: '55×40×20',
        },
        {
          serviceId: 'bag_002',
          label: 'Checked bag',
          price: '45.00',
          currency: 'USD',
          weightKg: 23,
        },
      ],
      cancelForAnyReason: [
        {
          serviceId: 'cfar_001',
          price: '32.00',
          currency: 'USD',
          summary: 'Refund up to 75% for any reason.',
        },
      ],
      createdAt: FROZEN_AT,
      ...overrides,
    };
  },

  tripBrief(overrides: Partial<ChannelMessageTripBrief> = {}): ChannelMessageTripBrief {
    return {
      kind: 'trip_brief',
      id: 'msg-trip-brief-1',
      author: AGENT_AUTHOR,
      trip: {
        tripId: 'trp_test_001',
        name: 'NYC week',
        status: 'in_progress',
        kind: 'round_trip',
        origin: 'EZE',
        destination: 'JFK',
        destinationCountriesIso2: ['us'],
        startDate: '2026-06-01',
        endDate: '2026-06-08',
      },
      flights: [
        {
          bookingId: 'bkg_flight_1',
          pnr: 'XYZ123',
          status: 'ticketed',
          origin: 'EZE',
          destination: 'JFK',
          departureAt: '2026-06-01T22:00:00Z',
          arrivalAt: '2026-06-02T08:30:00Z',
          totalUsd: '850.00',
          segmentCount: 1,
        },
      ],
      stays: [
        {
          bookingId: 'bkg_stay_1',
          status: 'confirmed',
          property: 'The Mercer Hotel',
          city: 'New York',
          checkInDate: '2026-06-02',
          checkOutDate: '2026-06-08',
          nights: 6,
          totalUsd: '1200.00',
        },
      ],
      esims: [
        {
          esimId: 'esim_test_001',
          status: 'active',
          countries: ['US'],
          dataMb: 5120,
          validityDays: 30,
          expiresAt: '2026-06-30T00:00:00Z',
          installUrl: 'https://app.sendero.travel/install/esim/abc.def',
        },
      ],
      alerts: [
        {
          kind: 'flight_canceled',
          severity: 'warn',
          message: 'Outbound flight rebooked — confirm with traveler.',
        },
      ],
      shareUrl: 'https://app.sendero.travel/trip/abc.def',
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
    fixtures.esimActivation(),
    fixtures.seatPicker(),
    fixtures.ancillaryPicker(),
    fixtures.tripBrief(),
  ];
}
