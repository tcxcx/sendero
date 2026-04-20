/**
 * Discord interactions webhook adapter.
 *
 * Discord pushes slash-command interactions as JSON with Ed25519
 * signatures. Skeleton here parses the payload shape and routes to a
 * tool from @sendero/tools. Signature verification stubbed pending a
 * real Discord app.
 *
 * Env:
 *   DISCORD_PUBLIC_KEY — Ed25519 pubkey for signature verification
 *   DISCORD_BOT_TOKEN  — for follow-up messages
 */

import type { Hono } from 'hono';
import { toolList } from '@sendero/tools';

const INTERACTION_TYPE_PING = 1;
const INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const CALLBACK_TYPE_CHANNEL_MESSAGE = 4;

interface DiscordInteraction {
  type: number;
  data?: {
    name?: string;
    options?: Array<{ name: string; value: string | number | boolean }>;
  };
  member?: { user?: { id: string; username: string } };
  user?: { id: string; username: string };
}

async function inferReply(text: string): Promise<string> {
  if (!text.trim()) {
    return (
      'Sendero · tools bound: ' + toolList.map((t) => t.name).join(', ')
    );
  }
  if (/treasury|balance/i.test(text)) {
    const t = toolList.find((x) => x.name === 'check_treasury');
    if (!t) return 'Treasury tool unavailable.';
    const r = (await t.handler({}, {})) as any;
    return `Treasury on Arc: ${JSON.stringify(r.balances)}`;
  }
  return `Sendero received: "${text}". (Discord adapter stub — LLM routing lands next.)`;
}

export function mountDiscord(app: Hono): void {
  app.post('/discord', async (c) => {
    const payload = (await c.req.json()) as DiscordInteraction;

    if (payload.type === INTERACTION_TYPE_PING) {
      return c.json({ type: 1 });
    }

    if (payload.type === INTERACTION_TYPE_APPLICATION_COMMAND) {
      const textOption = payload.data?.options?.find((o) => o.name === 'text');
      const text = String(textOption?.value ?? '');
      const reply = await inferReply(text);
      return c.json({
        type: CALLBACK_TYPE_CHANNEL_MESSAGE,
        data: { content: reply },
      });
    }

    return c.json({ type: CALLBACK_TYPE_CHANNEL_MESSAGE, data: { content: 'Unsupported interaction type.' } });
  });
}
