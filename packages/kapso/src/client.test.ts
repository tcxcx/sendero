/**
 * KapsoClient HTTP contract tests. Mocks fetch; no network.
 *
 * Ported from desk-v1 test patterns, adapted for Sendero.
 */

import { KapsoClient, KapsoError } from './client';
import { describe, expect, it } from 'bun:test';

function mockFetch(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return (async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const r = responses[i++] ?? { status: 200, body: {} };
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('KapsoClient', () => {
  it('creates a customer with API key auth', async () => {
    let captured: { url: string; headers: Headers; body: string } | null = null;
    const client = new KapsoClient({
      apiKey: 'test-key',
      fetchImpl: (async (input, init) => {
        captured = {
          url: String(input),
          headers: new Headers(init?.headers ?? {}),
          body: String(init?.body ?? ''),
        };
        return new Response(
          JSON.stringify({
            customer: { id: 'cus_1', name: 'Acme', external_customer_id: 'tenant_a' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const out = await client.createCustomer({ name: 'Acme', externalCustomerId: 'tenant_a' });
    expect(out.id).toBe('cus_1');
    expect(captured).not.toBeNull();
    expect(captured!.url).toContain('/platform/v1/customers');
    expect(captured!.headers.get('x-api-key')).toBe('test-key');
    expect(captured!.body).toContain('"external_customer_id":"tenant_a"');
  });

  it('throws KapsoError with status + body on non-200', async () => {
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: mockFetch([{ status: 422, body: { error: 'invalid' } }]),
    });
    try {
      await client.createCustomer({ name: 'Acme' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(KapsoError);
      const kerr = err as KapsoError;
      expect(kerr.status).toBe(422);
      expect((kerr.body as { error: string }).error).toBe('invalid');
    }
  });

  it('creates a tenant setup link without project-owner phone provisioning by default', async () => {
    let capturedBody = '';
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async (_input, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response(
          JSON.stringify({
            setup_link: {
              id: 'sl_1',
              url: 'https://setup.kapso.ai/sl_1',
              customer_id: 'cus_1',
              expires_at: new Date(Date.now() + 3600_000).toISOString(),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const link = await client.createSetupLink('cus_1', {
      redirect_url: 'https://sendero.travel/x',
    });
    expect(link.id).toBe('sl_1');
    expect(capturedBody).toContain('"allowed_connection_types":["coexistence","dedicated"]');
    expect(capturedBody).toContain('"provision_phone_number":false');
    expect(capturedBody).toContain('"redirect_url":"https://sendero.travel/x"');
  });

  it('registers a webhook with phone-number scope', async () => {
    let capturedUrl = '';
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async input => {
        capturedUrl = String(input);
        return new Response(
          JSON.stringify({
            webhook: {
              id: 'wh_1',
              scope: 'phone_number',
              url: 'https://example.com/wh',
              events: ['whatsapp.message.received'],
              active: true,
              kind: 'kapso',
              payload_version: 'v2',
              secret: 'shh',
              phone_number_id: 'pn_1',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const hook = await client.registerWebhook({
      scope: 'phone_number',
      url: 'https://example.com/wh',
      events: ['whatsapp.message.received'],
      phone_number_id: 'pn_1',
    });
    expect(hook.id).toBe('wh_1');
    expect(hook.secret).toBe('shh');
    expect(capturedUrl).toContain('/platform/v1/whatsapp/phone_numbers/pn_1/webhooks');
  });

  it('checks WhatsApp phone health through the WhatsApp phone-number route', async () => {
    let capturedUrl = '';
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async input => {
        capturedUrl = String(input);
        return new Response(JSON.stringify({ data: { status: 'unhealthy', checks: {} } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });

    const health = await client.checkPhoneHealth('pn_1');
    expect(health.status).toBe('unhealthy');
    expect(capturedUrl).toContain('/platform/v1/whatsapp/phone_numbers/pn_1/health');
  });

  it('lists all WhatsApp phone numbers when no customer filter is supplied', async () => {
    let capturedUrl = '';
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async input => {
        capturedUrl = String(input);
        return new Response(
          JSON.stringify({
            phone_numbers: [
              {
                id: 'row_1',
                phone_number_id: 'pn_1',
                customer_id: 'cus_1',
                display_phone_number: '+1 201-471-6388',
                status: 'active',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const phoneNumbers = await client.listPhoneNumbers();
    expect(phoneNumbers[0]?.phone_number_id).toBe('pn_1');
    expect(capturedUrl).toContain('/platform/v1/whatsapp/phone_numbers');
    expect(capturedUrl).not.toContain('customer_id=');
  });

  it('accepts phone numbers with null Kapso status', async () => {
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: mockFetch([
        {
          status: 200,
          body: {
            phone_numbers: [
              {
                id: 'row_1',
                phone_number_id: 'pn_1',
                customer_id: 'cus_1',
                display_phone_number: '+1 201-471-6388',
                status: null,
              },
            ],
          },
        },
      ]),
    });

    const phoneNumbers = await client.listPhoneNumbersForCustomer('cus_1');
    expect(phoneNumbers[0]?.status).toBeNull();
    expect(phoneNumbers[0]?.phone_number_id).toBe('pn_1');
  });

  it('lists and creates WhatsApp Flows', async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async (input, init) => {
        calls.push({
          url: String(input),
          method: String(init?.method ?? 'GET'),
          body: String(init?.body ?? ''),
        });
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              data: [{ id: 'flow_1', name: 'Sendero Trip intake', phone_number_id: 'pn_1' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            data: {
              id: 'flow_2',
              name: 'Sendero Support intake',
              phone_number_id: 'pn_1',
              meta_flow_id: 'meta_2',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const flows = await client.listWhatsAppFlows({ limit: 25 });
    expect(flows[0]?.id).toBe('flow_1');
    expect(calls[0]?.url).toContain('/platform/v1/whatsapp/flows?limit=25');

    const created = await client.createWhatsAppFlow({
      name: 'Sendero Support intake',
      business_account_id: 'waba_1',
      phone_number_id: 'pn_1',
      flow_json: { version: '7.3', screens: [] },
    });
    expect(created.id).toBe('flow_2');
    expect(created.meta_flow_id).toBe('meta_2');
    expect(calls[1]?.url).toContain('/platform/v1/whatsapp/flows');
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.body).toContain('"business_account_id":"waba_1"');
    expect(calls[1]?.body).toContain('"json_version":"7.3"');
    expect(calls[1]?.body).toContain('"data_api_version":"3.0"');
  });

  it('creates workflow triggers using Kapso trigger payload shape', async () => {
    let captured: { url: string; method: string; body: string } | null = null;
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async (input, init) => {
        captured = {
          url: String(input),
          method: String(init?.method),
          body: String(init?.body ?? ''),
        };
        return new Response(
          JSON.stringify({
            data: {
              id: 'tr_1',
              workflow_id: 'wf_1',
              trigger_type: 'inbound_message',
              active: true,
              display_name: 'Support',
              triggerable: { phone_number_id: 'pn_1' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const trigger = await client.createWorkflowTrigger('wf_1', {
      trigger_type: 'inbound_message',
      phone_number_id: 'pn_1',
      display_name: 'Support',
      active: true,
    });
    expect(trigger.id).toBe('tr_1');
    expect(captured!.url).toContain('/platform/v1/workflows/wf_1/triggers');
    expect(captured!.method).toBe('POST');
    expect(captured!.body).toContain('"phone_number_id":"pn_1"');
    expect(captured!.body).not.toContain('"triggerable"');
  });

  it('replaces workflow triggers through the Kapso PUT endpoint', async () => {
    let captured: { url: string; method: string; body: string } | null = null;
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async (input, init) => {
        captured = {
          url: String(input),
          method: String(init?.method),
          body: String(init?.body ?? ''),
        };
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'tr_1',
                workflow_id: 'wf_1',
                trigger_type: 'inbound_message',
                active: true,
                triggerable: { phone_number_id: 'pn_1' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch,
    });

    const triggers = await client.replaceWorkflowTriggers('wf_1', [
      {
        trigger_type: 'inbound_message',
        phone_number_id: 'pn_1',
        active: true,
      },
    ]);
    expect(triggers).toHaveLength(1);
    expect(captured!.url).toContain('/platform/v1/workflows/wf_1/triggers');
    expect(captured!.url).not.toContain('/replace');
    expect(captured!.method).toBe('PUT');
    expect(captured!.body).toContain('"phone_number_id":"pn_1"');
    expect(captured!.body).not.toContain('"triggerable"');
  });

  it('tolerates bare (unwrapped) responses', async () => {
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: mockFetch([
        {
          status: 200,
          body: { id: 'cus_bare', name: 'Bare' },
        },
      ]),
    });
    const out = await client.getCustomer('cus_bare');
    expect(out.id).toBe('cus_bare');
  });
});
