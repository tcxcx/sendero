/**
 * Sendero MCP server — Hono instance that speaks MCP over Streamable
 * HTTP. Exposes the same 8 tools the chat agent uses so Claude Desktop
 * / ChatGPT Apps / Gemini extensions can plug Sendero in as a travel
 * rail natively.
 *
 * Tools mirror app/api/chat/route.ts. We don't import the chat module
 * directly to avoid pulling the AI SDK into a non-AI route.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { searchFlights, createHoldOrder, payFromBalance } from './duffel';
import { getTreasuryBalances } from './circle';
import {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  summarizeBridge,
  summarizeSend,
  summarizeSwap,
} from './appkit';
import {
  transferViaGateway,
  queryUnifiedBalance,
  GATEWAY_CHAINS,
} from './gateway';
import {
  canonicalSplit,
  settleCommissionSplit,
} from './nanopayments';
import type { BridgeParams, SendParams, SwapParams } from '@circle-fin/app-kit';
import { BRIDGE_CHAINS } from './bridge-chains';
import { env } from './env';

// ───────────────────────────────────────────────────────────────────
// MCP tool catalog — names + schemas + handlers in one place
// ───────────────────────────────────────────────────────────────────

const toolCatalog = {
  search_flights: {
    description:
      'Search Duffel for available flight offers between two airports on a given date. Returns a ranked list of fare options.',
    inputSchema: {
      type: 'object',
      required: ['origin', 'destination', 'departureDate'],
      properties: {
        origin: { type: 'string', description: 'IATA code, e.g. SFO' },
        destination: { type: 'string', description: 'IATA code, e.g. LHR' },
        departureDate: { type: 'string', description: 'YYYY-MM-DD' },
        returnDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
        passengers: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
        cabinClass: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          default: 'economy',
        },
      },
    },
    handler: async (input: any) => {
      const offers = await searchFlights(input);
      return { offers };
    },
  },

  book_flight: {
    description:
      'Hold a Duffel flight offer for a named passenger. Returns a PNR + total + payment status. Settlement on Arc is a separate tool.',
    inputSchema: {
      type: 'object',
      required: ['offerId', 'passengerName', 'passengerEmail'],
      properties: {
        offerId: { type: 'string' },
        passengerName: { type: 'string' },
        passengerEmail: { type: 'string', format: 'email' },
        passengerPhone: {
          type: 'string',
          description: 'E.164 format, e.g. +447123456789',
        },
      },
    },
    handler: async (input: any) => {
      const hold = await createHoldOrder({
        offerId: input.offerId,
        passengerName: input.passengerName,
        passengerEmail: input.passengerEmail,
        passengerPhone: input.passengerPhone ?? '+447123456789',
        idempotencyKey: `mcp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      });
      // Immediately pay the hold so the PNR settles (mirrors chat tool).
      try {
        const pay = await payFromBalance(hold.orderId);
        return { ...hold, paymentStatus: pay.status };
      } catch (payErr) {
        return {
          ...hold,
          paymentStatus: 'pending',
          paymentError:
            payErr instanceof Error ? payErr.message : String(payErr),
        };
      }
    },
  },

  check_treasury: {
    description:
      "Read the Sendero corporate treasury's current USDC + EURC balances on Arc Testnet.",
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const balances = await getTreasuryBalances();
      return { balances };
    },
  },

  gateway_balance: {
    description:
      'Return the treasury USDC unified balance across every Gateway-supported testnet (Arc, Ethereum Sepolia, Base Sepolia, Avalanche Fuji, etc.). Fast — queries Circle Gateway API.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => queryUnifiedBalance(),
  },

  gateway_transfer: {
    description:
      'Pull USDC from any Gateway-supported chain and mint it on Arc Testnet (or any other Gateway chain) in sub-500ms. Server signs the burn intent, Circle attests, destination mints. Use when Arc liquidity is short.',
    inputSchema: {
      type: 'object',
      required: ['from', 'to', 'amount'],
      properties: {
        from: {
          type: 'string',
          enum: Object.keys(GATEWAY_CHAINS),
          description: 'Source chain key',
        },
        to: {
          type: 'string',
          enum: Object.keys(GATEWAY_CHAINS),
          description: 'Destination chain key (usually Arc_Testnet)',
        },
        amount: {
          type: 'string',
          description: 'Decimal USDC amount, e.g. "5.00"',
        },
        recipient: {
          type: 'string',
          description: '0x-address on destination (defaults to treasury)',
        },
      },
    },
    handler: async (input: any) => {
      if (input.from === input.to) {
        return { error: 'from and to must differ' };
      }
      const r = await transferViaGateway({
        from: input.from,
        to: input.to,
        amountUsdc: input.amount,
        recipient: input.recipient,
      });
      return {
        state: 'success',
        from: input.from,
        to: input.to,
        amount: input.amount,
        mintHash: r.mintHash,
        explorerUrl: r.explorerUrl,
      };
    },
  },

  swap_tokens: {
    description:
      'Swap between USDC and EURC on Arc Testnet via Circle App Kit. Treasury-signed via viem adapter.',
    inputSchema: {
      type: 'object',
      required: ['fromToken', 'toToken', 'amount'],
      properties: {
        fromToken: { type: 'string', enum: ['USDC', 'EURC'] },
        toToken: { type: 'string', enum: ['USDC', 'EURC'] },
        amount: { type: 'string' },
      },
    },
    handler: async (input: any) => {
      if (input.fromToken === input.toToken) {
        return { error: 'fromToken and toToken must differ' };
      }
      const kit = getAppKit();
      const adapter = getTreasuryAdapter();
      const params: SwapParams = {
        from: { adapter, chain: 'Arc_Testnet' },
        tokenIn: input.fromToken,
        tokenOut: input.toToken,
        amountIn: input.amount,
        config: { kitKey: getKitKey() },
      };
      const result = await kit.swap(params);
      const s = summarizeSwap(result);
      return {
        state: s.state,
        txHash: s.txHash,
        explorerUrl: s.explorerUrl,
        amountIn: result.amountIn,
        amountOut: result.amountOut,
      };
    },
  },

  send_tokens: {
    description:
      'Transfer USDC or EURC from the Sendero treasury to any Arc Testnet address.',
    inputSchema: {
      type: 'object',
      required: ['to', 'amount'],
      properties: {
        to: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
        amount: { type: 'string' },
        token: { type: 'string', enum: ['USDC', 'EURC'], default: 'USDC' },
      },
    },
    handler: async (input: any) => {
      const kit = getAppKit();
      const adapter = getTreasuryAdapter();
      const params: SendParams = {
        from: { adapter, chain: 'Arc_Testnet' },
        to: input.to,
        amount: input.amount,
        token: input.token ?? 'USDC',
      };
      const result = await kit.send(params);
      const s = summarizeSend(result);
      return {
        state: s.state,
        txHash: s.txHash,
        explorerUrl: s.explorerUrl,
        amount: input.amount,
        token: input.token ?? 'USDC',
        to: input.to,
      };
    },
  },

  settle_split: {
    description:
      'Execute a canonical commission fan-out on Arc Testnet in a single batch: gross splits atomically into supplier net + agency commission + Sendero rail + validator tip. Pass gross + supplier address; defaults fill other parties.',
    inputSchema: {
      type: 'object',
      required: ['gross', 'supplier'],
      properties: {
        gross: {
          type: 'string',
          description: 'Total booking amount in USDC (decimal string).',
        },
        supplier: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
        commissionBps: { type: 'integer', default: 1000 },
        senderoFeeBps: { type: 'integer', default: 100 },
      },
    },
    handler: async (input: any) => {
      const legs = canonicalSplit({
        gross: input.gross,
        supplier: input.supplier,
        agency:
          (process.env.DEMO_CLIENT_ADDRESS as any) ||
          '0x6a5d2a2e56ed5162f5e29fe1179e59f2b07140e7',
        sendero:
          (process.env.SENDERO_PROVIDER_ADDRESS as any) ||
          '0x2dd43b06e707d45b40790abd5fa6e39403225425',
        validator:
          (process.env.AUX_VALIDATOR_1_ADDRESS as any) ||
          '0x22f7536934d6a00ade239474465b823418dd84bc',
        commissionBps: input.commissionBps,
        senderoFeeBps: input.senderoFeeBps,
      });
      return settleCommissionSplit(legs);
    },
  },

  bridge_to_arc: {
    description:
      'Bridge USDC from a supported chain INTO Arc Testnet via Circle CCTP v2 (different primitive than Gateway — use when you need the slower, permissionless bridge path).',
    inputSchema: {
      type: 'object',
      required: ['fromChain', 'amount'],
      properties: {
        fromChain: { type: 'string', enum: BRIDGE_CHAINS as unknown as string[] },
        amount: { type: 'string' },
      },
    },
    handler: async (input: any) => {
      const kit = getAppKit();
      const adapter = getTreasuryAdapter();
      const params: BridgeParams = {
        from: { adapter, chain: input.fromChain },
        to: { adapter, chain: 'Arc_Testnet' },
        amount: input.amount,
      };
      const result = await kit.bridge(params);
      const s = summarizeBridge(result);
      return {
        state: s.state,
        fromChain: input.fromChain,
        toChain: 'Arc_Testnet',
        txHash: s.txHash,
        explorerUrl: s.explorerUrl,
      };
    },
  },
} as const;

export type ToolName = keyof typeof toolCatalog;

// ───────────────────────────────────────────────────────────────────
// MCP wire protocol — minimal JSON-RPC 2.0 over HTTP
// (Streamable HTTP transport, client-initiated requests only.)
// ───────────────────────────────────────────────────────────────────

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
  const tool = (toolCatalog as any)[name];
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  const result = await tool.handler(args ?? {});
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
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
        // No response expected for notifications.
        return null;

      default:
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message },
    };
  }
}

// ───────────────────────────────────────────────────────────────────
// Hono app — mounts at /api/mcp
// ───────────────────────────────────────────────────────────────────

export const mcpApp = new Hono().basePath('/api/mcp')
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
    if (responses.length === 0) {
      return c.body(null, 202);
    }
    return c.json(Array.isArray(body) ? responses : responses[0]);
  });
