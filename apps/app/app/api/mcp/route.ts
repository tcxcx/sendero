import { mcpApp } from './_mcp-app';

/**
 * /api/mcp — Streamable HTTP MCP endpoint (Hono instance).
 *
 * Kept on a hand-rolled JSON-RPC 2.0 + Hono implementation instead of
 * mcp-use because mcp-use 1.x requires Zod 4 (`z.toJSONSchema`) and
 * our stack is locked to Zod 3.25.x by viem + Circle adapters. The
 * Hono app exposes the same tools/list, tools/call, initialize, ping
 * surface so any MCP client (Claude Desktop / ChatGPT Apps / Cursor /
 * Zed) can connect.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = (req: Request) => mcpApp.fetch(req);
export const POST = (req: Request) => mcpApp.fetch(req);
export const OPTIONS = (req: Request) => mcpApp.fetch(req);
