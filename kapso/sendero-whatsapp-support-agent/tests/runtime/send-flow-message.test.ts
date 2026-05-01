import { describe, expect, test } from 'bun:test';

import '../../functions/sendero-whatsapp-support-send-flow-message/index.js';

interface SendFlowRuntime {
  handler: (request: Request, env: Record<string, string>) => Promise<Response>;
}

const sendFlow = (
  globalThis as typeof globalThis & { __senderoSupportSendFlowMessage: SendFlowRuntime }
).__senderoSupportSendFlowMessage;

function request(body: unknown) {
  return new Request('https://kapso.local/tool', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('send WhatsApp Flow support function', () => {
  test('uses production Flow defaults when runtime env is absent', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ messages: [{ id: 'wamid.test' }] });
    }) as typeof fetch;

    try {
      const response = await sendFlow.handler(
        request({
          input: { flow_key: 'trip_intake' },
          whatsapp_context: {
            conversation: { phone_number: '+15550001111' },
          },
        }),
        { KAPSO_API_KEY: 'kapso_test' }
      );

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(calls[0].url).toContain('/1125870723936815/messages');
      expect(calls[0].body).toMatchObject({
        interactive: {
          action: {
            parameters: {
              flow_id: '454f053b-3b75-4766-aec8-330e21ce3315',
            },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('sends the interactive Flow payload to the current WhatsApp user', async () => {
    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ messages: [{ id: 'wamid.test' }] });
    }) as typeof fetch;

    try {
      const response = await sendFlow.handler(
        request({
          input: { flow_key: 'trip_intake', mode: 'draft' },
          execution_context: { system: { workflow_execution_id: 'exec_1' } },
          whatsapp_context: {
            conversation: {
              id: 'conv_1',
              phone_number_id: 'pn_1',
              phone_number: '+15550001111',
            },
          },
        }),
        {
          KAPSO_API_KEY: 'kapso_test',
          SENDERO_SUPPORT_TRIP_INTAKE_FLOW_ID: 'flow_1',
        }
      );

      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(calls[0].url).toContain('/pn_1/messages');
      expect(calls[0].body).toMatchObject({
        to: '+15550001111',
        type: 'interactive',
        interactive: {
          type: 'flow',
          action: {
            name: 'flow',
            parameters: {
              flow_id: 'flow_1',
              mode: 'draft',
            },
          },
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
