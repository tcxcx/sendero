/**
 * Sendero edge worker — one Bun+Hono instance that serves every
 * non-UI surface from a single deploy:
 *
 *   GET/POST  /mcp        — MCP JSON-RPC 2.0 for Claude Desktop / ChatGPT Apps / etc.
 *   POST      /whatsapp   — Meta Cloud API webhook for WhatsApp Business
 *   POST      /slack      — Slack slash-command / events webhook
 *   POST      /discord    — Discord interactions webhook
 *   GET       /           — health + surface manifest
 *   GET       /llms.txt   — mirrored for agents that discover edge directly
 *
 * Every surface reuses `@sendero/tools` as the single source of truth,
 * so adding a new tool lights it up on every channel automatically.
 *
 * Run: `bun run apps/edge/src/index.ts`
 * Deploy: Fly, Cloudflare Workers (with @hono/adapter-cloudflare),
 * Vercel Edge, Deno Deploy, or plain Bun on a VM.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { toolList } from '@sendero/tools';
import { mountMcp } from './adapters/mcp';
import { mountWhatsApp } from './adapters/whatsapp';
import { mountSlack } from './adapters/slack';
import { mountDiscord } from './adapters/discord';

const app = new Hono();

app.use(
  '*',
  cors({
    origin: '*',
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Mcp-Session-Id',
      'X-Slack-Signature',
      'X-Slack-Request-Timestamp',
      'X-Hub-Signature-256',
      'X-Signature-Ed25519',
      'X-Signature-Timestamp',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);

app.get('/', (c) =>
  c.json({
    name: '@sendero/edge',
    version: '0.1.0',
    description:
      'Sendero multi-surface edge worker. MCP + WhatsApp + Slack + Discord from one tool registry.',
    surfaces: ['/mcp', '/whatsapp', '/slack', '/discord'],
    toolCount: toolList.length,
    tools: toolList.map((t) => t.name),
  }),
);

app.get('/llms.txt', (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(
    `# Sendero edge\n\n> Edge worker serving ${toolList.length} AI tools over MCP, WhatsApp, Slack, and Discord. Same registry (@sendero/tools) powers the Next.js web app.\n\n## Tools\n${toolList.map((t) => `- ${t.name} — ${t.description.split('. ')[0]}`).join('\n')}\n`,
  );
});

mountMcp(app);
mountWhatsApp(app);
mountSlack(app);
mountDiscord(app);

const port = Number(process.env.PORT ?? 3020);

// Bun-native entrypoint. When deployed to an edge runtime that doesn't
// accept `Bun.serve`, replace with that runtime's handler (e.g.,
// `export default app;` for Cloudflare Workers / Vercel Edge).
if (typeof (globalThis as any).Bun !== 'undefined') {
  (globalThis as any).Bun.serve({ port, fetch: app.fetch });
  // eslint-disable-next-line no-console
  console.log(`[sendero/edge] listening on :${port}`);
}

export default app;
