/**
 * Sendero MCP server — Hono instance that speaks MCP over Streamable
 * HTTP. Tools come from `lib/tools/` — same registry the chat route
 * consumes, so there's no tool drift.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { toolList } from './tools';
import { buildMcpCatalog } from './tools/adapters/mcp';

const toolCatalog = buildMcpCatalog(toolList);

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
    tools: Object.entries(toolCatalog).map(([name, t]) => ({
      name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  };
}

async function callTool(name: string, args: any) {
  const t = toolCatalog[name];
  if (!t) throw new Error(`Unknown tool: ${name}`);
  const result = await t.handler(args ?? {});
  return {
    content: [
      { type: 'text' as const, text: JSON.stringify(result, null, 2) },
    ],
    isError: false,
  };
}

async function handleRpc(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
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
                'AI travel agent + USDC settlement rail on Arc L2. Books real flights via Duffel, settles via Circle Gateway + App Kit.',
            },
          },
        };
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: listTools() };
      case 'tools/call': {
        const { name, arguments: args } = req.params ?? {};
        const result = await callTool(name, args);
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

export const mcpApp = new Hono()
  .basePath('/api/mcp')
  .use(
    '*',
    cors({
      origin: '*',
      allowHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id'],
      allowMethods: ['GET', 'POST', 'OPTIONS'],
    }),
  )
  .get('/', (c) =>
    c.json({
      name: 'sendero-arc',
      version: '0.9.5-alpha',
      description:
        'Sendero MCP — AI travel booking + Arc L2 USDC settlement + Circle Gateway treasury rails.',
      protocolVersion: PROTOCOL_VERSION,
      transports: ['streamable-http'],
      endpoint: '/api/mcp',
      tools: Object.keys(toolCatalog),
      docs: 'https://github.com/criptopoeta/sendero-arc',
    }),
  )
  .post('/', async (c) => {
    const body = (await c.req.json()) as JsonRpcRequest | JsonRpcRequest[];
    const batch = Array.isArray(body) ? body : [body];
    const responses: JsonRpcResponse[] = [];
    for (const req of batch) {
      const resp = await handleRpc(req);
      if (resp) responses.push(resp);
    }
    if (responses.length === 0) return c.body(null, 202);
    return c.json(Array.isArray(body) ? responses : responses[0]);
  });
