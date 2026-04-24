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
 * Tool execution reuses `@sendero/tools`; agent discovery reuses
 * `@sendero/llms` so web and edge manifests stay aligned.
 *
 * Run: `bun run apps/edge/src/index.ts`
 * Deploy: Fly, Cloudflare Workers (with @hono/adapter-cloudflare),
 * Vercel Edge, Deno Deploy, or plain Bun on a VM.
 */

import { buildLlmsTxt, buildSenderoEdgeLlms } from '@sendero/llms';
import {
  buildRobots,
  buildSitemap,
  SENDERO_EDGE_ROUTES,
  serializeRobots,
  serializeSitemap,
} from '@sendero/seo';
import { toolList } from '@sendero/tools';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { mountDiscord } from './adapters/discord';
import { mountMcp } from './adapters/mcp';
import { mountPaidTools } from './adapters/paid-tools';
import { mountSlack } from './adapters/slack';
import { mountWhatsApp } from './adapters/whatsapp';

const app = new Hono();
const edgeOrigin =
  process.env.NEXT_PUBLIC_SENDERO_EDGE_URL ??
  process.env.SENDERO_EDGE_URL ??
  'https://edge.sendero.travel';

function surfaceOrigins() {
  return {
    appOrigin: process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.sendero.travel',
    marketingOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sendero.travel',
    helpOrigin: process.env.NEXT_PUBLIC_HELP_URL ?? 'https://help.sendero.travel',
    docsOrigin: process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sendero.travel',
    edgeOrigin,
  };
}

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
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return c.body(buildLlmsTxt(buildSenderoEdgeLlms(surfaceOrigins())));
});

app.get('/.well-known/llms.txt', c => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');
  return c.body(buildLlmsTxt(buildSenderoEdgeLlms(surfaceOrigins())));
});

app.get('/robots.txt', c => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');

  return c.body(
    serializeRobots(
      buildRobots({
        siteUrl: edgeOrigin,
        allow: ['/', '/llms.txt', '/.well-known/llms.txt', '/mcp', '/tools'],
        disallow: ['/whatsapp', '/slack', '/discord', '/api/webhooks/', '/admin/'],
        agentAllow: ['/', '/llms.txt', '/.well-known/llms.txt', '/mcp', '/tools'],
        agentDisallow: ['/whatsapp', '/slack', '/discord', '/api/webhooks/', '/admin/'],
      })
    )
  );
});

app.get('/sitemap.xml', c => {
  c.header('Content-Type', 'application/xml; charset=utf-8');
  c.header('Cache-Control', 'public, max-age=300, s-maxage=3600');

  return c.body(
    serializeSitemap(
      buildSitemap({
        siteUrl: edgeOrigin,
        routes: SENDERO_EDGE_ROUTES,
        locales: ['en-US'],
        defaultLocale: 'en-US',
      })
    )
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
