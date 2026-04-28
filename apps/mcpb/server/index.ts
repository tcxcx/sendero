/**
 * Sendero MCPB stdio→HTTP proxy.
 *
 * Claude Desktop spawns this script as the MCP server when the user
 * installs the .mcpb bundle. The MCP wire protocol over stdio is
 * newline-delimited JSON-RPC 2.0 — we read each line, forward the
 * payload to https://app.sendero.travel/api/mcp via HTTP POST, and
 * write the response back to stdout.
 *
 * Why no SDK dependency: the proxy is bytes-in / bytes-out. Pulling in
 * @modelcontextprotocol/sdk would force us to register per-method
 * handlers, which means re-decoding the protocol our remote endpoint
 * already implements. Keeping it raw keeps the bundle ~5kb and the
 * code in one file you can read top-to-bottom.
 *
 * Auth: SENDERO_API_KEY arrives via env from the user_config field
 * (Claude Desktop reads it from the OS keychain on macOS / Windows
 * Credential Manager / libsecret on Linux). Without it we exit fast
 * with a friendly hint rather than spinning forever.
 *
 * Notifications (MCP requests with no `id` field) get no response.
 * We forward them upstream for side-effects but do not write to
 * stdout for them; doing so would inject a bogus response that
 * Claude Desktop doesn't expect.
 */

import { createInterface } from 'node:readline';

const API_KEY = process.env.SENDERO_API_KEY;
const MCP_URL = process.env.SENDERO_MCP_URL ?? 'https://app.sendero.travel/api/mcp';

if (!API_KEY) {
  process.stderr.write(
    '[sendero-mcpb] SENDERO_API_KEY is not set.\n' +
      '              Open Claude Desktop → Settings → Extensions → Sendero → Configure\n' +
      '              and paste a key from https://app.sendero.travel/dashboard/settings/api-keys.\n'
  );
  process.exit(1);
}

interface JsonRpcMessage {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: unknown;
}

async function forward(payload: JsonRpcMessage | JsonRpcMessage[]): Promise<unknown> {
  const r = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
      'user-agent': 'sendero-mcpb/0.1.0',
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    // Surface upstream HTTP failures as JSON-RPC errors so Claude
    // Desktop renders them in-chat rather than silently dropping.
    const id = Array.isArray(payload) ? null : (payload.id ?? null);
    return {
      jsonrpc: '2.0' as const,
      id,
      error: {
        code: -32603,
        message: `Sendero upstream returned ${r.status} ${r.statusText}`,
      },
    };
  }
  return r.json();
}

function isNotification(msg: JsonRpcMessage): boolean {
  return msg.method !== undefined && msg.id === undefined;
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let payload: JsonRpcMessage | JsonRpcMessage[];
  try {
    payload = JSON.parse(trimmed) as JsonRpcMessage | JsonRpcMessage[];
  } catch (err) {
    process.stderr.write(
      `[sendero-mcpb] failed to parse stdin JSON: ${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  // Pure-notification batches don't need a response. Mixed batches are
  // handled upstream — the server returns responses only for the
  // request members and we forward whatever JSON it returns.
  const allNotifications = Array.isArray(payload)
    ? payload.every(isNotification)
    : isNotification(payload);

  try {
    const response = await forward(payload);
    if (allNotifications) return;
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (err) {
    const id = Array.isArray(payload) ? null : (payload.id ?? null);
    const errorResponse = {
      jsonrpc: '2.0' as const,
      id,
      error: {
        code: -32603,
        message: `Sendero proxy error: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
    process.stdout.write(`${JSON.stringify(errorResponse)}\n`);
  }
});

rl.on('close', () => {
  process.exit(0);
});
