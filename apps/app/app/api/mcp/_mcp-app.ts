/**
 * Sendero MCP server — Hono instance that speaks MCP over Streamable
 * HTTP. Tools come from `lib/tools/` — same registry the chat route
 * consumes, so there's no tool drift.
 *
 * Each `tools/call` resolves the Clerk API key, rebuilds the tool
 * catalog WITH the caller's tenantId in `ctx.traveler`, then invokes
 * the tool handler. Without this binding, a tool handler that trusts
 * a tenantId passed in `args` would let a valid API key for tenant A
 * mutate tenant B's resources.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { toolList } from '@sendero/tools';
import { buildMcpCatalog, type McpToolEntry } from '@sendero/tools/adapters/mcp';
import type { ToolContext } from '@sendero/tools/types';

import type { ResolvedApiKey } from '@/lib/api-key-auth';

// Tools/list is identity-free (names + schemas only), so a single
// module-level catalog built with no context serves every discovery.
// tools/call rebuilds the catalog per-request with the caller's ctx.
const discoveryCatalog = buildMcpCatalog(toolList);

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: any;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2024-11-05';

function listTools() {
  return {
    tools: Object.entries(discoveryCatalog).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

async function callTool(name: string, args: any, catalog: Record<string, McpToolEntry>) {
  const t = catalog[name];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  const result = await t.handler(args ?? {});
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    isError: false,
  };
}

async function handleRpc(
  req: JsonRpcRequest,
  catalog: Record<string, McpToolEntry>
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: 'sendero-arc',
              version: '0.9.5-alpha',
              description:
                'AI travel agent + USDC settlement rail on Arc L2. Books real flights, hotels, and trip services; settles via Circle Gateway + App Kit.',
            },
          },
        };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: listTools() };
      case 'tools/call': {
        const { name, arguments: args } = req.params ?? {};
        const result = await callTool(name, args, catalog);
        return { jsonrpc: '2.0', id, result };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { jsonrpc: '2.0', id, error: { code: -32603, message } };
  }
}

/**
 * CORS origin allowlist. Preflight + credentialed requests only
 * succeed for these origins. Non-browser MCP clients (Claude Desktop,
 * Cursor, custom bun/node scripts) don't send Origin headers and are
 * unaffected; they just need a valid `Authorization: Bearer ak_…`.
 */
function allowedOrigin(origin: string): string | null {
  if (!origin) return null;
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '');
  const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '');
  const allowlist = [
    APP_URL,
    SITE_URL,
    'https://claude.ai',
    'https://app.claude.ai',
    'https://cursor.sh',
    'http://localhost:3010',
    'http://localhost:3000',
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return allowlist.includes(origin) ? origin : null;
}

function buildRequestCatalog(resolved: ResolvedApiKey): Record<string, McpToolEntry> {
  const ctx: ToolContext = {
    traveler: {
      tenantId: resolved.tenantId,
      userId: `svc:${resolved.keyId}`,
    },
  };
  return buildMcpCatalog(toolList, ctx);
}

export const mcpApp = new Hono()
  .basePath('/api/mcp')
  .use(
    '*',
    cors({
      origin: (origin: string) => allowedOrigin(origin) ?? '',
      allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      credentials: false,
    })
  )
  .get('/', c =>
    c.json({
      name: 'sendero-arc',
      version: '0.9.5-alpha',
      description:
        'Sendero MCP — AI travel booking + Arc L2 USDC settlement + Circle Gateway treasury rails.',
      protocolVersion: PROTOCOL_VERSION,
      transports: ['streamable-http'],
      endpoint: '/api/mcp',
      tools: Object.keys(discoveryCatalog),
      docs: 'https://github.com/criptopoeta/sendero-arc',
    })
  )
  .post('/', async c => {
    // API key required for JSON-RPC calls. The GET handler above stays
    // public so agents can fetch the server manifest for discovery.
    const { resolveTenantFromApiKey } = await import('@/lib/api-key-auth');
    const resolved = await resolveTenantFromApiKey(c.req.raw);
    if (!resolved) {
      return c.json(
        {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32001,
            message:
              'Missing or invalid API key. Mint one at /dashboard/settings/api-keys and send as `Authorization: Bearer ak_…`.',
          },
        },
        401
      );
    }

    // Per-request catalog bound to the caller's tenant. Every tool
    // handler now receives `ctx.traveler.tenantId` and MUST prefer it
    // over any tenantId passed in args (handler responsibility).
    const catalog = buildRequestCatalog(resolved);

    const body = (await c.req.json()) as JsonRpcRequest | JsonRpcRequest[];
    const batch = Array.isArray(body) ? body : [body];
    const responses: JsonRpcResponse[] = [];
    for (const req of batch) {
      const resp = await handleRpc(req, catalog);
      if (resp) responses.push(resp);
    }
    if (responses.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(body) ? responses : responses[0]);
  });
