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
import { mountPaidTools } from './adapters/paid-tools';

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
  })
);

app.get('/', c =>
  c.json({
    name: '@sendero/edge',
    version: '0.1.0',
    description:
      'Sendero multi-surface edge worker. MCP + WhatsApp + Slack + Discord from one tool registry.',
    surfaces: ['/mcp', '/whatsapp', '/slack', '/discord', '/tools'],
    toolCount: toolList.length,
    tools: toolList.map(t => t.name),
  })
);

app.get('/llms.txt', c => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body(
    `# Sendero edge\n\n> Edge worker serving ${toolList.length} AI tools over MCP, WhatsApp, Slack, and Discord. Same registry (@sendero/tools) powers the Next.js web app.\n\n## Tools\n${toolList.map(t => `- ${t.name} — ${t.description.split('. ')[0]}`).join('\n')}\n`
  );
});

mountMcp(app);
mountWhatsApp(app);
mountSlack(app);
mountDiscord(app);
mountPaidTools(app);

/**
 * Default export is the raw Hono `app`. That's the shape Vercel's
 * `hono/vercel` `handle()` wraps, and also what Cloudflare Workers
 * expects. For local Bun dev we run via `bun run dev` in this
 * package which uses `@hono/node-server` compat under the hood.
 */
// eslint-disable-next-line no-console
console.log(`[sendero/edge] ready · surfaces: / · /mcp · /whatsapp · /slack · /discord · /tools`);

export default app;
