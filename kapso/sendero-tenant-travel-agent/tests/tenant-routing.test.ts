import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));

const originalFetch = globalThis.fetch;

function loadWorker(relativePath: string) {
  const source = readFileSync(resolve(rootDir, relativePath), 'utf8');
  return new Function(`${source}; return { handler, resolvePhoneNumberId };`)() as {
    handler: (request: Request, env: Record<string, string>) => Promise<Response>;
    resolvePhoneNumberId: (...args: unknown[]) => string | null;
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Kapso tenant routing', () => {
  test('extracts phone_number_id from Kapso execution context', () => {
    const payload = {
      input: {
        toolName: 'get_operator_agency',
        input: {},
      },
      execution_context: {
        context: {
          phone_number_id: 'pn_sol',
        },
      },
    };

    const toolCall = loadWorker('functions/sendero-tool-call/index.js');
    const prefetch = loadWorker('functions/sendero-prefetch-trip/index.js');

    expect(toolCall.resolvePhoneNumberId(payload, payload.input)).toBe('pn_sol');
    expect(prefetch.resolvePhoneNumberId(payload)).toBe('pn_sol');
  });

  test('tool proxy forwards phoneNumberId instead of env tenant when present', async () => {
    const toolCall = loadWorker('functions/sendero-tool-call/index.js');
    let forwarded: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      forwarded = JSON.parse(String(init?.body ?? '{}'));
      return Response.json({ result: { ok: true } });
    }) as typeof fetch;

    const response = await toolCall.handler(
      new Request('https://kapso.local/tool', {
        method: 'POST',
        body: JSON.stringify({
          input: {
            toolName: 'get_operator_agency',
            travelerPhone: '+593980668984',
            input: {},
          },
          execution_context: {
            context: {
              phone_number_id: 'pn_sol',
            },
          },
        }),
      }),
      {
        SENDERO_API_BASE_URL: 'https://sendero.local',
        SENDERO_DISPATCH_SECRET: 'secret',
        SENDERO_TENANT_ID: 'tenant_arc_env',
      }
    );

    expect(response.status).toBe(200);
    expect(forwarded).toMatchObject({
      travelerPhone: '+593980668984',
      phoneNumberId: 'pn_sol',
    });
    expect(forwarded).not.toHaveProperty('tenantId');
  });

  test('prefetch forwards phoneNumberId instead of env tenant when present', async () => {
    const prefetch = loadWorker('functions/sendero-prefetch-trip/index.js');
    let forwarded: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      forwarded = JSON.parse(String(init?.body ?? '{}'));
      return Response.json({ result: { status: 'no_active_trip' } });
    }) as typeof fetch;

    const response = await prefetch.handler(
      new Request('https://kapso.local/prefetch', {
        method: 'POST',
        body: JSON.stringify({
          execution_context: {
            context: {
              phone_number: '+593980668984',
              phone_number_id: 'pn_sol',
            },
          },
        }),
      }),
      {
        SENDERO_API_BASE_URL: 'https://sendero.local',
        SENDERO_DISPATCH_SECRET: 'secret',
        SENDERO_TENANT_ID: 'tenant_arc_env',
      }
    );

    expect(response.status).toBe(200);
    expect(forwarded).toMatchObject({
      travelerPhone: '+593980668984',
      phoneNumberId: 'pn_sol',
    });
    expect(forwarded).not.toHaveProperty('tenantId');
  });
});
