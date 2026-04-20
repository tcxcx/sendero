/**
 * MCP JSON-RPC 2.0 surface. Identical protocol to the Next.js route
 * at /api/mcp — both mount the same tool registry, so anything
 * callable in the web app is callable here and vice versa.
 */

import type { Hono } from 'hono';
import { toolList } from '@sendero/tools';
import { buildMcpCatalog } from '@sendero/tools/adapters/mcp';

const PROTOCOL_VERSION = '2024-11-05';

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
              name: 'sendero-edge',
              version: '0.1.0',
              description:
                'Sendero edge worker — MCP + WhatsApp + Slack + Discord from one tool registry.',
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

export function mountMcp(app: Hono): void {
  app.get('/mcp', (c) =>
    c.json({
      name: 'sendero-edge/mcp',
      version: '0.1.0',
      protocolVersion: PROTOCOL_VERSION,
      transports: ['streamable-http'],
      endpoint: '/mcp',
      tools: Object.keys(toolCatalog),
    }),
  );

  app.post('/mcp', async (c) => {
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
}
