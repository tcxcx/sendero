/**
 * Setup-link orchestration tests.
 *
 * Ported from desk-v1 (setup-link flow did not exist there — this is a
 * fresh primitive built from the integrate-whatsapp SKILL.md spec).
 */

import { KapsoClient } from './client';
import { isSetupLinkExpired, startOnboarding } from './setup-link';
import { describe, expect, it } from 'bun:test';

function stubClient(responses: unknown[]): KapsoClient {
  let i = 0;
  return new KapsoClient({
    apiKey: 'k',
    fetchImpl: (async () => {
      const body = responses[i++];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch,
  });
}

describe('startOnboarding', () => {
  it('creates customer then setup link with redirect_url', async () => {
    const expires = new Date(Date.now() + 3600_000).toISOString();
    const client = stubClient([
      { data: [] },
      { customer: { id: 'cus_x', name: 'Acme', external_customer_id: 'tenant_x' } },
      {
        setup_link: {
          id: 'sl_x',
          url: 'https://setup.kapso.ai/sl_x',
          customer_id: 'cus_x',
          expires_at: expires,
        },
      },
    ]);

    const out = await startOnboarding(client, {
      tenantId: 'tenant_x',
      tenantName: 'Acme',
      redirectUrl: 'https://sendero.travel/dashboard/settings/channels?onboarding=whatsapp',
      countryIsos: ['US', 'BR'],
    });

    expect(out.customer.id).toBe('cus_x');
    expect(out.setupLink.id).toBe('sl_x');
    expect(out.setupLink.url).toMatch(/^https:\/\/setup.kapso.ai/);
  });

  it('uses an isolated customer external id when provided', async () => {
    let capturedBody = '';
    const client = new KapsoClient({
      apiKey: 'k',
      fetchImpl: (async (url, init) => {
        if (String(url).includes('/setup_links')) {
          return new Response(
            JSON.stringify({
              setup_link: {
                id: 'sl_y',
                url: 'https://setup.kapso.ai/sl_y',
                expires_at: new Date(Date.now() + 3600_000).toISOString(),
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (String(url).includes('/customers') && init?.method === 'POST') {
          capturedBody = String(init.body);
          return new Response(
            JSON.stringify({
              customer: { id: 'cus_y', name: 'Acme', external_customer_id: 'tenant_x:attempt_1' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (String(url).includes('/customers?')) {
          return new Response(JSON.stringify({ data: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch,
    });

    await startOnboarding(client, {
      tenantId: 'tenant_x',
      customerExternalId: 'tenant_x:attempt_1',
      tenantName: 'Acme',
      redirectUrl: 'https://sendero.travel/dashboard/channels/whatsapp',
    });

    expect(capturedBody).toContain('"external_customer_id":"tenant_x:attempt_1"');
  });
});

describe('isSetupLinkExpired', () => {
  it('returns false for future expiry', () => {
    expect(isSetupLinkExpired({ expires_at: new Date(Date.now() + 60_000).toISOString() })).toBe(
      false
    );
  });
  it('returns true for past expiry', () => {
    expect(isSetupLinkExpired({ expires_at: new Date(Date.now() - 60_000).toISOString() })).toBe(
      true
    );
  });
  it('returns true for unparseable dates', () => {
    expect(isSetupLinkExpired({ expires_at: 'nope' })).toBe(true);
  });
});
