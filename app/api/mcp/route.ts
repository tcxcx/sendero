import { mcpApp } from '@/lib/mcp-app';

/**
 * /api/mcp — Streamable HTTP MCP endpoint.
 *
 * Handler delegates to the Hono app in lib/mcp-app.ts so the MCP
 * surface stays self-contained and portable (you could also run it as
 * a standalone `bun run` worker using @hono/node-server).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = (req: Request) => mcpApp.fetch(req);
export const POST = (req: Request) => mcpApp.fetch(req);
export const OPTIONS = (req: Request) => mcpApp.fetch(req);
