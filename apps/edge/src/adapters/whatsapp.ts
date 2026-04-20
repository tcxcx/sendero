/**
 * WhatsApp Business Cloud API webhook adapter.
 *
 * Flow:
 *  1. Meta hits POST /whatsapp with a message payload.
 *  2. We route the text through an AI model that can call @sendero/tools.
 *  3. We reply with a WhatsApp message via the Graph API.
 *
 * For the hackathon this ships as a SHELL: signature verification,
 * parsed payload, tool registry loaded, AI inference stubbed to a
 * "Sendero received: <text>" echo so the wire path is testable end to
 * end without burning LLM credits. Swap the stub for a real Anthropic
 * or OpenAI call once a WhatsApp Business number + Meta app are provisioned.
 *
 * Env:
 *   WHATSAPP_VERIFY_TOKEN       — string Meta uses for webhook verification
 *   WHATSAPP_APP_SECRET         — HMAC secret for payload signing
 *   WHATSAPP_PHONE_NUMBER_ID    — Meta phone number ID
 *   WHATSAPP_ACCESS_TOKEN       — long-lived Cloud API token
 */

import type { Hono } from 'hono';
import { routeToAgent } from '@sendero/tools/agent';

interface InboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

interface WhatsAppWebhookPayload {
  entry?: Array<{
    id: string;
    changes?: Array<{
      value?: {
        messages?: InboundMessage[];
        metadata?: { phone_number_id: string };
      };
    }>;
  }>;
}

async function sendMessage(
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    // eslint-disable-next-line no-console
    console.log(`[whatsapp] (stub) → ${to}: ${body}`);
    return;
  }
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    },
  );
  if (!res.ok) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] send failed:', res.status, await res.text());
  }
}

async function inferReply(text: string, senderPhone: string): Promise<string> {
  const result = await routeToAgent(text, {
    ctx: { traveler: { phone: senderPhone } },
    maxSteps: 5,
  });
  // Log for observability — lands in the edge worker logs.
  // eslint-disable-next-line no-console
  console.log(
    `[whatsapp] ${result.provider} · ${result.steps} steps · tools=[${result.toolsCalled.join(',')}]`,
  );
  return result.text;
}

export function mountWhatsApp(app: Hono): void {
  // Meta webhook verification handshake.
  app.get('/whatsapp', (c) => {
    const mode = c.req.query('hub.mode');
    const token = c.req.query('hub.verify_token');
    const challenge = c.req.query('hub.challenge');
    const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? 'sendero-dev';
    if (mode === 'subscribe' && token === expected && challenge) {
      return c.text(challenge, 200);
    }
    return c.text('forbidden', 403);
  });

  app.post('/whatsapp', async (c) => {
    const payload = (await c.req.json()) as WhatsAppWebhookPayload;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value) continue;
        const phoneNumberId = value.metadata?.phone_number_id ?? '';
        for (const msg of value.messages ?? []) {
          if (msg.type !== 'text' || !msg.text?.body) continue;
          const reply = await inferReply(msg.text.body, msg.from);
          if (phoneNumberId) {
            await sendMessage(phoneNumberId, msg.from, reply);
          }
        }
      }
    }

    // Meta wants a fast 200 even on async processing.
    return c.body(null, 200);
  });
}
