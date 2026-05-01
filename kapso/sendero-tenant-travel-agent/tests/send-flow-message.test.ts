import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const functionPath = resolve(rootDir, 'functions/sendero-tenant-travel-send-flow-message/index.js');

async function loadFunction() {
  const url = pathToFileURL(functionPath);
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  await import(url.href);
  return (
    globalThis as typeof globalThis & {
      __senderoTenantSendFlowMessage: {
        handler: (request: Request, env: Record<string, string>) => Promise<Response>;
      };
    }
  ).__senderoTenantSendFlowMessage;
}

describe('tenant WhatsApp Flow sender', () => {
  test('resolves Flow ids from Sendero before sending', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), body });
      if (String(url).includes('/api/internal/support/tools')) {
        return Response.json({
          ok: true,
          configured: true,
          flow: {
            kapsoFlowId: 'tenant-flow-trip-intake',
            mode: 'draft',
          },
        });
      }
      return Response.json({ messages: [{ id: 'wamid.1' }] });
    }) as typeof fetch;

    try {
      const runtime = await loadFunction();
      const response = await runtime.handler(
        new Request('https://kapso.local/function', {
          method: 'POST',
          body: JSON.stringify({
            input: { flow_key: 'trip_intake' },
            execution_context: { context: { phone_number_id: 'pn_tenant', phone_number: '1555' } },
            whatsapp_context: {
              conversation: { phone_number_id: 'pn_tenant', phone_number: '1555' },
              messages: [{ direction: 'inbound', wa_id: '1555' }],
            },
          }),
        }),
        {
          KAPSO_API_KEY: 'kapso_test',
          SENDERO_APP_ORIGIN: 'https://app.sendero.test',
          SUPPORT_TOOLS_SECRET: 'secret',
        }
      );

      const result = await response.json();
      expect(result.ok).toBe(true);
      expect(calls[0]?.url).toBe('https://app.sendero.test/api/internal/support/tools');
      expect(calls[0]?.body).toMatchObject({
        operation: 'get_tenant_whatsapp_flow',
        input: { flow_key: 'trip_intake', phone_number_id: 'pn_tenant' },
      });
      expect(calls[1]?.url).toContain('/pn_tenant/messages');
      expect(calls[1]?.body).toMatchObject({
        interactive: {
          action: {
            parameters: {
              flow_id: 'tenant-flow-trip-intake',
              mode: 'draft',
            },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns unconfigured when Sendero has no tenant Flow id', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        configured: false,
        reason: 'flow_not_registered',
      })) as typeof fetch;

    try {
      const runtime = await loadFunction();
      const response = await runtime.handler(
        new Request('https://kapso.local/function', {
          method: 'POST',
          body: JSON.stringify({
            input: { flow_key: 'trip_intake' },
            execution_context: { context: { phone_number_id: 'pn_tenant', phone_number: '1555' } },
          }),
        }),
        {
          KAPSO_API_KEY: 'kapso_test',
          SENDERO_APP_ORIGIN: 'https://app.sendero.test',
          SUPPORT_TOOLS_SECRET: 'secret',
        }
      );

      const result = await response.json();
      expect(result.ok).toBe(false);
      expect(result.configured).toBe(false);
      expect(result.error).toBe('flow_not_registered');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
