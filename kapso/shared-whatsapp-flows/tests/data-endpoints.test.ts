import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '..');

async function loadHandler(path: string) {
  const code = await readFile(resolve(root, path), 'utf8');
  const context = vm.createContext({ Response, fetch });
  vm.runInContext(`${code}; globalThis.__handler = handler;`, context);
  return context.__handler as (request: Request, env: Record<string, string>) => Promise<Response>;
}

function request(body: unknown) {
  return new Request('https://kapso.local/flow', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('shared WhatsApp Flow data endpoints', () => {
  test('trip endpoint routes basics to travelers', async () => {
    const handler = await loadHandler('functions/trip-intake-data-endpoint/index.js');
    const response = await handler(
      request({
        source: 'whatsapp_flow',
        signature_valid: true,
        data_exchange: {
          action: 'data_exchange',
          screen: 'TRIP_BASICS',
          data: {
            destination: 'Santiago',
            start_date: '2026-06-01',
            trip_type: 'business',
          },
        },
      }),
      {}
    );
    const json = await response.json();
    expect(json.version).toBe('3.0');
    expect(json.screen).toBe('TRAVELERS');
    expect(json.data.destination).toBe('Santiago');
  });

  test('support endpoint routes support type to details', async () => {
    const handler = await loadHandler('functions/support-intake-data-endpoint/index.js');
    const response = await handler(
      request({
        source: 'whatsapp_flow',
        signature_valid: true,
        data_exchange: {
          action: 'data_exchange',
          screen: 'SUPPORT_TYPE',
          data: {
            support_area: 'billing_refund',
            urgency: 'urgent',
          },
        },
      }),
      {}
    );
    const json = await response.json();
    expect(json.version).toBe('3.0');
    expect(json.screen).toBe('SUPPORT_DETAILS');
    expect(json.data.area_title).toBe('Billing or refund');
  });

  test('trip endpoint persists the final approval through Sendero tools', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, trip: { id: 'trip_1' } });
    }) as typeof fetch;

    try {
      const handler = await loadHandler('functions/trip-intake-data-endpoint/index.js');
      const response = await handler(
        request({
          source: 'whatsapp_flow',
          signature_valid: true,
          flow: { id: 'flow_1', meta_flow_id: 'meta_1' },
          data_exchange: {
            action: 'data_exchange',
            screen: 'APPROVAL',
            flow_token: 'sendero:trip_intake:conv_1:exec_1',
            data: {
              destination: 'Santiago',
              start_date: '2026-06-01',
              trip_type: 'business',
              traveler_name: 'Tomas',
              traveler_count: '1',
              needed_products: ['flights'],
            },
          },
        }),
        {
          KAPSO_WEBHOOK_BASE_URL: 'https://app.sendero.test',
          KAPSO_WEBHOOK_SECRET: 'secret',
          WHATSAPP_PHONE_NUMBER_ID: 'pn_1',
        }
      );
      const json = await response.json();
      expect(json.screen).toBe('SUCCESS');
      expect(json.data.extension_message_response.params.trip_id).toBe('trip_1');
      expect(calls[0].url).toBe('https://app.sendero.test/api/internal/support/tools');
      expect(calls[0].body).toMatchObject({
        operation: 'create_trip_intake',
        input: {
          destination: 'Santiago',
          flow_token: 'sendero:trip_intake:conv_1:exec_1',
        },
        execution_context: { context: { phone_number_id: 'pn_1' } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('support endpoint persists the final details through Sendero tools', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, ticket: { id: 'ticket_1' } });
    }) as typeof fetch;

    try {
      const handler = await loadHandler('functions/support-intake-data-endpoint/index.js');
      const response = await handler(
        request({
          source: 'whatsapp_flow',
          signature_valid: true,
          data_exchange: {
            action: 'data_exchange',
            screen: 'SUPPORT_DETAILS',
            flow_token: 'sendero:support_intake:conv_1:exec_1',
            data: {
              support_area: 'billing_refund',
              urgency: 'urgent',
              reference: 'SR-123',
              details: 'Refund request',
            },
          },
        }),
        {
          SENDERO_APP_ORIGIN: 'https://app.sendero.test',
          SUPPORT_TOOLS_SECRET: 'secret',
          WHATSAPP_PHONE_NUMBER_ID: 'pn_1',
        }
      );
      const json = await response.json();
      expect(json.screen).toBe('SUCCESS');
      expect(json.data.extension_message_response.params.ticket_id).toBe('ticket_1');
      expect(calls[0].body).toMatchObject({
        operation: 'create_support_ticket',
        input: {
          priority: 'urgent',
          reference: 'SR-123',
          source: 'whatsapp_flow',
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('login/signup endpoint persists traveler identity and wallet consent', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, user: { id: 'user_1' }, wallet: { address: '0xabc' } });
    }) as typeof fetch;

    try {
      const handler = await loadHandler('functions/login-signup-data-endpoint/index.js');
      const response = await handler(
        request({
          source: 'whatsapp_flow',
          signature_valid: true,
          data_exchange: {
            action: 'data_exchange',
            screen: 'TRAVELER_PROFILE',
            flow_token: 'sendero:login_signup:conv_1:exec_1',
            data: {
              display_name: 'Tomas Cordero',
              email: 'TOMAS@example.com',
              phone: '+12014298750',
              locale: 'en-US',
              nationality_iso3: 'CHL',
              passport_expiry: '2030-12',
              wallet_consent: true,
            },
          },
        }),
        {
          SENDERO_APP_ORIGIN: 'https://app.sendero.test',
          SUPPORT_TOOLS_SECRET: 'secret',
          WHATSAPP_PHONE_NUMBER_ID: 'pn_1',
        }
      );
      const json = await response.json();
      expect(json.screen).toBe('SUCCESS');
      expect(json.data.extension_message_response.params).toMatchObject({
        sendero_saved: 'true',
        account_status: 'verification_required',
        verification_required: 'true',
      });
      expect(json.data.extension_message_response.params.user_id).toBeUndefined();
      expect(json.data.extension_message_response.params.wallet_address).toBeUndefined();
      expect(calls[0].body).toMatchObject({
        operation: 'create_whatsapp_login_signup',
        input: {
          email: 'tomas@example.com',
          ticket_delivery_email: 'tomas@example.com',
          wallet_consent: true,
          flow_token: 'sendero:login_signup:conv_1:exec_1',
        },
        execution_context: { context: { phone_number_id: 'pn_1' } },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test.each([
    {
      name: 'quote approval',
      path: 'functions/quote-approval-data-endpoint/index.js',
      screen: 'QUOTE_DETAILS',
      data: {
        trip_id: 'trip_1',
        quote_id: 'quote_1',
        selected_option: 'Option A',
        decision: 'approve_intent',
        notes: 'Looks good',
      },
      expectedTitle: 'Quote approve_intent: quote_1',
    },
    {
      name: 'ancillaries',
      path: 'functions/ancillaries-data-endpoint/index.js',
      screen: 'ANCILLARY_DETAILS',
      data: {
        trip_id: 'trip_1',
        traveler_name: 'Tomas',
        products: ['bags', 'seats'],
        budget: 'USD 120',
        details: 'Aisle seat',
      },
      expectedTitle: 'Ancillary request',
    },
    {
      name: 'disruption help',
      path: 'functions/disruption-help-data-endpoint/index.js',
      screen: 'DISRUPTION_DETAILS',
      data: {
        trip_id: 'trip_1',
        disruption_type: 'delay',
        urgency: 'urgent',
        flight_or_pnr: 'LA123',
        desired_outcome: 'rebook',
        details: 'Need same-day arrival',
      },
      expectedTitle: 'Disruption help: delay',
    },
    {
      name: 'prefund claim',
      path: 'functions/prefund-claim-data-endpoint/index.js',
      screen: 'CLAIM_CONFIRM',
      data: {
        booking_id: 'booking_1',
        ticket_email: 'traveler@example.com',
        has_email_code: 'no',
        issue: 'Cannot find email',
      },
      expectedTitle: 'Prefunded trip claim help',
    },
    {
      name: 'booking change',
      path: 'functions/booking-change-data-endpoint/index.js',
      screen: 'CHANGE_DETAILS',
      data: {
        trip_id: 'trip_1',
        pnr: 'ABC123',
        change_type: 'change_dates',
        urgency: 'urgent',
        preferred_alternatives: 'Next morning',
        reason: 'Meeting moved',
      },
      expectedTitle: 'Booking change: change_dates',
    },
    {
      name: 'accommodation',
      path: 'functions/accommodation-data-endpoint/index.js',
      screen: 'STAY_DETAILS',
      data: {
        trip_id: 'trip_1',
        city: 'Paris',
        check_in: '2026-06-01',
        check_out: '2026-06-04',
        rooms: '1',
        budget: 'USD 300/night',
        amenities: ['breakfast'],
      },
      expectedTitle: 'Accommodation request: Paris',
    },
    {
      name: 'car transfer',
      path: 'functions/car-transfer-data-endpoint/index.js',
      screen: 'GROUND_DETAILS',
      data: {
        trip_id: 'trip_1',
        service_type: 'airport_transfer',
        pickup: 'JFK',
        dropoff: 'Manhattan',
        pickup_time: '2026-06-01 10:00',
        passengers: '2',
        vehicle_class: 'sedan',
      },
      expectedTitle: 'Ground transport: airport_transfer',
    },
    {
      name: 'restaurant experience',
      path: 'functions/restaurant-experience-data-endpoint/index.js',
      screen: 'EXPERIENCE_DETAILS',
      data: {
        trip_id: 'trip_1',
        city_or_area: 'Madrid',
        request_type: 'restaurant',
        date_time: 'Friday dinner',
        cuisine_or_theme: 'Tapas',
        budget: 'EUR 80',
      },
      expectedTitle: 'Recommendation request: restaurant',
    },
    {
      name: 'nft trip gallery',
      path: 'functions/nft-trip-gallery-data-endpoint/index.js',
      screen: 'GALLERY_DETAILS',
      data: {
        trip_id: 'trip_1',
        request_type: 'request_unlock',
        stamp_id: 'stamp_1',
        notes: 'Unlock arrival stamp',
      },
      expectedTitle: 'Trip gallery: request_unlock',
    },
    {
      name: 'refund escrow',
      path: 'functions/refund-escrow-data-endpoint/index.js',
      screen: 'REFUND_ESCROW_DETAILS',
      data: {
        trip_id: 'trip_1',
        request_type: 'refund_request',
        urgency: 'urgent',
        reference: 'invoice_1',
        details: 'Duplicate charge',
      },
      expectedTitle: 'Refund or escrow: refund_request',
    },
  ])('$name endpoint persists a lifecycle handoff', async ({
    path,
    screen,
    data,
    expectedTitle,
  }) => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ ok: true, handoff: { id: 'handoff_1' } });
    }) as typeof fetch;

    try {
      const handler = await loadHandler(path);
      const response = await handler(
        request({
          source: 'whatsapp_flow',
          signature_valid: true,
          data_exchange: {
            action: 'data_exchange',
            screen,
            flow_token: `sendero:${screen}:conv_1:exec_1`,
            data,
          },
        }),
        {
          SENDERO_APP_ORIGIN: 'https://app.sendero.test',
          SUPPORT_TOOLS_SECRET: 'secret',
          WHATSAPP_PHONE_NUMBER_ID: 'pn_1',
        }
      );
      const json = await response.json();
      expect(json.screen).toBe('SUCCESS');
      expect(json.data.extension_message_response.params.handoff_id).toBe('handoff_1');
      expect(calls[0].body).toMatchObject({
        operation: 'create_tenant_handoff',
        input: {
          title: expectedTitle,
          flow_token: `sendero:${screen}:conv_1:exec_1`,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
