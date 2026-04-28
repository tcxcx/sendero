/**
 * Thin HTTP client for Sendero API surfaces.
 *
 * - Bearer auth via the stored key
 * - Optional debug logging to stderr (--debug)
 * - One place for retry policy (none yet — added later)
 */

import { readKey } from '../config/store';

export interface ApiClient {
  baseUrl: string;
  debug: boolean;
}

export function makeClient(opts: { baseUrl: string; debug?: boolean }): ApiClient {
  return { baseUrl: opts.baseUrl.replace(/\/$/, ''), debug: opts.debug ?? false };
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  authRequired?: boolean;
  signal?: AbortSignal;
}

export interface ApiError extends Error {
  status: number;
  body?: unknown;
}

export async function request<T>(
  client: ApiClient,
  path: string,
  opts: RequestOpts = {}
): Promise<T> {
  const url = `${client.baseUrl}${path}`;
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (opts.authRequired !== false) {
    const key = readKey();
    if (!key) {
      const err = new Error('No API key — run `sendero auth login` first.') as ApiError;
      err.status = 401;
      throw err;
    }
    headers.Authorization = `Bearer ${key}`;
  }

  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (client.debug) {
    process.stderr.write(`[debug] ${opts.method ?? 'GET'} ${url}\n`);
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

  if (client.debug) {
    process.stderr.write(`[debug] → ${res.status} ${res.statusText}\n`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = text;
    }
    const err = new Error(`${res.status} ${res.statusText}`) as ApiError;
    err.status = res.status;
    err.body = parsed;
    throw err;
  }

  return (await res.json()) as T;
}

// ─── Specific endpoints ───────────────────────────────────────────────

export interface WhoamiResponse {
  tenantId: string;
  orgId: string;
  keyType: 'sandbox' | 'production';
  effectiveKeyType: 'sandbox' | 'production';
  scopes: string[];
}

export function whoami(client: ApiClient): Promise<WhoamiResponse> {
  return request<WhoamiResponse>(client, '/api/auth/whoami');
}

export interface OpenApiSpec {
  paths?: Record<string, unknown>;
  components?: {
    schemas?: Record<string, unknown>;
  };
}

export function openapi(client: ApiClient): Promise<OpenApiSpec> {
  return request<OpenApiSpec>(client, '/api/openapi.json');
}

export interface McpToolCallResult {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export function mcpCall(
  client: ApiClient,
  tool: string,
  args: Record<string, unknown>
): Promise<McpToolCallResult> {
  return request<McpToolCallResult>(client, '/api/mcp', {
    method: 'POST',
    body: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    },
  });
}
