import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');

type FlowStep = {
  screen: string;
  data: Record<string, unknown>;
  expectScreen: string;
};

type FlowJourney = {
  key: string;
  path: string;
  startScreen: string;
  steps: FlowStep[];
  expectedOperation: string;
};

async function loadHandler(path: string) {
  const code = await readFile(resolve(root, path), 'utf8');
  const context = vm.createContext({
    Response,
    fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
  });
  vm.runInContext(`${code}; globalThis.__handler = handler;`, context);
  return context.__handler as (request: Request, env: Record<string, string>) => Promise<Response>;
}

function request(body: unknown) {
  return new Request('https://kapso.local/flow', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const journeys: FlowJourney[] = [
  {
    key: 'login_signup',
    path: 'functions/login-signup-data-endpoint/index.js',
    startScreen: 'ACCOUNT',
    expectedOperation: 'create_whatsapp_login_signup',
    steps: [
      {
        screen: 'ACCOUNT',
        expectScreen: 'TRAVELER_PROFILE',
        data: {
          account_mode: 'signup',
          display_name: 'Traveler One',
          email: 'traveler@example.com',
          phone: '+12014298750',
          locale: 'en-US',
        },
      },
      {
        screen: 'TRAVELER_PROFILE',
        expectScreen: 'SUCCESS',
        data: {
          account_mode: 'signup',
          display_name: 'Traveler One',
          email: 'traveler@example.com',
          phone: '+12014298750',
          locale: 'en-US',
          nationality_iso3: 'CHL',
          wallet_consent: true,
        },
      },
    ],
  },
  {
    key: 'trip_intake',
    path: 'functions/trip-intake-data-endpoint/index.js',
    startScreen: 'TRIP_BASICS',
    expectedOperation: 'create_trip_intake',
    steps: [
      {
        screen: 'TRIP_BASICS',
        expectScreen: 'TRAVELERS',
        data: {
          destination: 'Santiago',
          origin: 'New York',
          start_date: '2026-06-01',
          end_date: '2026-06-07',
          trip_type: 'business',
          budget: 'USD 2,000',
        },
      },
      {
        screen: 'TRAVELERS',
        expectScreen: 'APPROVAL',
        data: {
          destination: 'Santiago',
          origin: 'New York',
          start_date: '2026-06-01',
          end_date: '2026-06-07',
          trip_type: 'business',
          budget: 'USD 2,000',
          traveler_name: 'Traveler One',
          traveler_email: 'traveler@example.com',
          traveler_phone: '+12014298750',
          traveler_count: '1',
          needed_products: ['flights', 'hotels'],
        },
      },
      {
        screen: 'APPROVAL',
        expectScreen: 'SUCCESS',
        data: {
          destination: 'Santiago',
          origin: 'New York',
          start_date: '2026-06-01',
          end_date: '2026-06-07',
          trip_type: 'business',
          budget: 'USD 2,000',
          traveler_name: 'Traveler One',
          traveler_email: 'traveler@example.com',
          traveler_phone: '+12014298750',
          traveler_count: '1',
          needed_products: ['flights', 'hotels'],
          notes: 'Window seat',
        },
      },
    ],
  },
  {
    key: 'support_intake',
    path: 'functions/support-intake-data-endpoint/index.js',
    startScreen: 'SUPPORT_TYPE',
    expectedOperation: 'create_support_ticket',
    steps: [
      {
        screen: 'SUPPORT_TYPE',
        expectScreen: 'SUPPORT_DETAILS',
        data: { support_area: 'billing_refund', urgency: 'urgent' },
      },
      {
        screen: 'SUPPORT_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          support_area: 'billing_refund',
          urgency: 'urgent',
          reference: 'SR-123',
          details: 'Refund question',
          preferred_contact: 'WhatsApp',
        },
      },
    ],
  },
  {
    key: 'quote_approval',
    path: 'functions/quote-approval-data-endpoint/index.js',
    startScreen: 'QUOTE_REVIEW',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'QUOTE_REVIEW',
        expectScreen: 'QUOTE_DETAILS',
        data: {
          trip_id: 'trip_1',
          quote_id: 'quote_1',
          selected_option: 'Option A',
          decision: 'approve_intent',
        },
      },
      {
        screen: 'QUOTE_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          quote_id: 'quote_1',
          selected_option: 'Option A',
          decision: 'approve_intent',
          notes: 'Looks good',
        },
      },
    ],
  },
  {
    key: 'ancillaries',
    path: 'functions/ancillaries-data-endpoint/index.js',
    startScreen: 'ANCILLARY_TYPE',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'ANCILLARY_TYPE',
        expectScreen: 'ANCILLARY_DETAILS',
        data: { trip_id: 'trip_1', traveler_name: 'Traveler One', products: ['bags', 'seats'] },
      },
      {
        screen: 'ANCILLARY_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          traveler_name: 'Traveler One',
          products: ['bags', 'seats'],
          budget: 'USD 120',
          details: 'Aisle seat',
        },
      },
    ],
  },
  {
    key: 'disruption_help',
    path: 'functions/disruption-help-data-endpoint/index.js',
    startScreen: 'DISRUPTION_TYPE',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'DISRUPTION_TYPE',
        expectScreen: 'DISRUPTION_DETAILS',
        data: { trip_id: 'trip_1', disruption_type: 'delay', urgency: 'urgent' },
      },
      {
        screen: 'DISRUPTION_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          disruption_type: 'delay',
          urgency: 'urgent',
          flight_or_pnr: 'LA123',
          desired_outcome: 'rebook',
          details: 'Need same-day arrival',
        },
      },
    ],
  },
  {
    key: 'prefund_claim',
    path: 'functions/prefund-claim-data-endpoint/index.js',
    startScreen: 'CLAIM_CONTEXT',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'CLAIM_CONTEXT',
        expectScreen: 'CLAIM_CONFIRM',
        data: {
          booking_id: 'booking_1',
          ticket_email: 'traveler@example.com',
          has_email_code: 'no',
        },
      },
      {
        screen: 'CLAIM_CONFIRM',
        expectScreen: 'SUCCESS',
        data: {
          booking_id: 'booking_1',
          ticket_email: 'traveler@example.com',
          has_email_code: 'no',
          issue: 'Cannot find email code',
        },
      },
    ],
  },
  {
    key: 'booking_change',
    path: 'functions/booking-change-data-endpoint/index.js',
    startScreen: 'CHANGE_REQUEST',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'CHANGE_REQUEST',
        expectScreen: 'CHANGE_DETAILS',
        data: {
          trip_id: 'trip_1',
          pnr: 'ABC123',
          change_type: 'change_dates',
          urgency: 'urgent',
        },
      },
      {
        screen: 'CHANGE_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          pnr: 'ABC123',
          change_type: 'change_dates',
          urgency: 'urgent',
          preferred_alternatives: 'Next morning',
          reason: 'Meeting moved',
        },
      },
    ],
  },
  {
    key: 'accommodation',
    path: 'functions/accommodation-data-endpoint/index.js',
    startScreen: 'STAY_BASICS',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'STAY_BASICS',
        expectScreen: 'STAY_DETAILS',
        data: {
          trip_id: 'trip_1',
          city: 'Paris',
          check_in: '2026-06-01',
          check_out: '2026-06-04',
          rooms: '1',
        },
      },
      {
        screen: 'STAY_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          city: 'Paris',
          check_in: '2026-06-01',
          check_out: '2026-06-04',
          rooms: '1',
          budget: 'USD 300/night',
          amenities: ['breakfast'],
        },
      },
    ],
  },
  {
    key: 'car_transfer',
    path: 'functions/car-transfer-data-endpoint/index.js',
    startScreen: 'GROUND_BASICS',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'GROUND_BASICS',
        expectScreen: 'GROUND_DETAILS',
        data: {
          trip_id: 'trip_1',
          service_type: 'airport_transfer',
          pickup: 'JFK',
          dropoff: 'Manhattan',
          pickup_time: '2026-06-01 10:00',
        },
      },
      {
        screen: 'GROUND_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          service_type: 'airport_transfer',
          pickup: 'JFK',
          dropoff: 'Manhattan',
          pickup_time: '2026-06-01 10:00',
          passengers: '2',
          vehicle_class: 'sedan',
        },
      },
    ],
  },
  {
    key: 'restaurant_experience',
    path: 'functions/restaurant-experience-data-endpoint/index.js',
    startScreen: 'EXPERIENCE_BASICS',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'EXPERIENCE_BASICS',
        expectScreen: 'EXPERIENCE_DETAILS',
        data: {
          trip_id: 'trip_1',
          city_or_area: 'Madrid',
          request_type: 'restaurant',
          date_time: 'Friday dinner',
        },
      },
      {
        screen: 'EXPERIENCE_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          city_or_area: 'Madrid',
          request_type: 'restaurant',
          date_time: 'Friday dinner',
          cuisine_or_theme: 'Tapas',
          budget: 'EUR 80',
        },
      },
    ],
  },
  {
    key: 'nft_trip_gallery',
    path: 'functions/nft-trip-gallery-data-endpoint/index.js',
    startScreen: 'GALLERY_REQUEST',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'GALLERY_REQUEST',
        expectScreen: 'GALLERY_DETAILS',
        data: { trip_id: 'trip_1', request_type: 'request_unlock' },
      },
      {
        screen: 'GALLERY_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          request_type: 'request_unlock',
          stamp_id: 'stamp_1',
          notes: 'Unlock arrival stamp',
        },
      },
    ],
  },
  {
    key: 'refund_escrow',
    path: 'functions/refund-escrow-data-endpoint/index.js',
    startScreen: 'REFUND_ESCROW_TYPE',
    expectedOperation: 'create_tenant_handoff',
    steps: [
      {
        screen: 'REFUND_ESCROW_TYPE',
        expectScreen: 'REFUND_ESCROW_DETAILS',
        data: { trip_id: 'trip_1', request_type: 'refund_request', urgency: 'urgent' },
      },
      {
        screen: 'REFUND_ESCROW_DETAILS',
        expectScreen: 'SUCCESS',
        data: {
          trip_id: 'trip_1',
          request_type: 'refund_request',
          urgency: 'urgent',
          reference: 'invoice_1',
          details: 'Duplicate charge',
        },
      },
    ],
  },
];

describe('shared WhatsApp lifecycle Flow e2e journeys', () => {
  test.each(journeys)('$key runs from INIT to persisted SUCCESS', async journey => {
    const handler = await loadHandler(journey.path);
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({
        ok: true,
        trip: { id: 'trip_created' },
        ticket: { id: 'ticket_created' },
        handoff: { id: 'handoff_created' },
        user: { id: 'user_created' },
        wallet: { address: '0xabc' },
      });
    }) as typeof fetch;

    try {
      const init = await handler(
        request({
          source: 'whatsapp_flow',
          signature_valid: true,
          data_exchange: { action: 'INIT', flow_token: `sendero:${journey.key}:conv_1:exec_1` },
        }),
        {}
      );
      expect((await init.json()).screen).toBe(journey.startScreen);

      for (const step of journey.steps) {
        const response = await handler(
          request({
            source: 'whatsapp_flow',
            signature_valid: true,
            flow: { id: `flow_${journey.key}`, meta_flow_id: `meta_${journey.key}` },
            data_exchange: {
              action: 'data_exchange',
              screen: step.screen,
              flow_token: `sendero:${journey.key}:conv_1:exec_1`,
              data: step.data,
            },
          }),
          {
            SENDERO_APP_ORIGIN: 'https://app.sendero.test',
            SUPPORT_TOOLS_SECRET: 'secret',
            WHATSAPP_PHONE_NUMBER_ID: 'pn_1',
          }
        );
        const json = await response.json();
        expect(json.version).toBe('3.0');
        expect(json.screen).toBe(step.expectScreen);
      }

      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://app.sendero.test/api/internal/support/tools');
      expect(calls[0].body.operation).toBe(journey.expectedOperation);
      expect(calls[0].body.input).toMatchObject({
        flow_token: `sendero:${journey.key}:conv_1:exec_1`,
        flow_id: `flow_${journey.key}`,
      });
      expect(calls[0].body.execution_context).toMatchObject({
        context: { phone_number_id: 'pn_1' },
        system: { flow_execution_id: `sendero:${journey.key}:conv_1:exec_1` },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
