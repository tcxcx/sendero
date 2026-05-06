/**
 * @sendero/arize-phoenix/_fetch — Cloudflare-bot-challenge-resilient
 * HTTP client for Phoenix Cloud.
 *
 * **Why this exists.** Phoenix Cloud sits behind Cloudflare's WAF.
 * Bun's `fetch` (and some Node fetch shapes / TLS profiles) get
 * fingerprinted as a bot and served HTTP 200 + an HTML auth page,
 * even with a valid Bearer token in the Authorization header. The
 * exact same request via `curl --http1.1` sails through. The
 * difference is in the TLS handshake / ALPN signature, not the auth.
 *
 * Strategy: try the runtime's native `fetch` first (cheap, fast). If
 * we requested JSON and got `200 + text/html`, we know we hit the bot
 * challenge — retry the same call via curl. Curl is available on the
 * Vercel function runtime (Linux base image).
 *
 * Returns a minimal Response-like object so callers don't need to know
 * which path served them. Always resolves; never throws.
 *
 * Used by recall.ts, experiments.ts, and promote.ts. The seed script
 * (scripts/phoenix-seed-resolved-gaps.ts) ships its own inline curl
 * shell-out — same pattern, different file because it predates this
 * helper and the user already verified it works end-to-end.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 6000;

export interface PhoenixFetchInit {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  /** Total budget in ms; default 6000. Applies to native fetch AND curl fallback. */
  timeoutMs?: number;
}

export interface PhoenixResponse {
  ok: boolean;
  status: number;
  /** Where the response came from — useful for log triage. */
  via: 'native' | 'curl' | 'error';
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export async function phoenixFetch(
  url: string,
  init: PhoenixFetchInit = {}
): Promise<PhoenixResponse> {
  const headers = init.headers ?? {};
  const acceptHdr = headers.accept ?? headers.Accept ?? '';
  const wantsJson = acceptHdr.includes('json');
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 1. Try native fetch first.
  const native = await tryNativeFetch(url, init, timeoutMs);
  if (native && !isBotChallenge(native, wantsJson)) {
    return native;
  }

  // 2. Curl fallback. Either native failed or returned a bot challenge.
  return curlFetch(url, init, timeoutMs);
}

async function tryNativeFetch(
  url: string,
  init: PhoenixFetchInit,
  timeoutMs: number
): Promise<(PhoenixResponse & { _contentType: string }) | null> {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
      ...(init.body ? { body: init.body } : {}),
      signal: controller.signal,
    });
    const contentType = res.headers.get('content-type') ?? '';
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      via: 'native',
      _contentType: contentType,
      async text() {
        return text;
      },
      async json() {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      },
    };
  } catch {
    return null;
  } finally {
    clearTimeout(handle);
  }
}

function isBotChallenge(
  res: PhoenixResponse & { _contentType?: string },
  wantsJson: boolean
): boolean {
  if (!wantsJson) return false;
  if (res.status !== 200) return false;
  return (res._contentType ?? '').toLowerCase().startsWith('text/html');
}

async function curlFetch(
  url: string,
  init: PhoenixFetchInit,
  timeoutMs: number
): Promise<PhoenixResponse> {
  const args: string[] = [
    '-sS',
    '--http1.1',
    '-X',
    init.method ?? 'GET',
    url,
    '-w',
    '\n__HTTP__%{http_code}',
    '--max-time',
    String(Math.max(1, Math.ceil(timeoutMs / 1000))),
  ];
  for (const [k, v] of Object.entries(init.headers ?? {})) {
    args.push('-H', `${k}: ${v}`);
  }
  if (init.body !== undefined) {
    args.push('--data-binary', '@-');
  }

  return new Promise<PhoenixResponse>(resolve => {
    const proc = spawn('curl', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    proc.on('error', err => {
      resolve(makeResponse(false, 0, 'error', `curl spawn failed: ${err.message}`));
    });
    proc.on('close', exitCode => {
      if (exitCode !== 0 && !stdout) {
        resolve(
          makeResponse(false, 0, 'error', `curl exit ${exitCode}: ${stderr.slice(0, 400)}`)
        );
        return;
      }
      const codeMatch = stdout.match(/__HTTP__(\d+)$/);
      const status = codeMatch ? Number(codeMatch[1]) : 0;
      const text = stdout.replace(/\n?__HTTP__\d+$/, '');
      resolve(makeResponse(status >= 200 && status < 300, status, 'curl', text));
    });
    if (init.body !== undefined) {
      proc.stdin.write(init.body);
    }
    proc.stdin.end();
  });
}

function makeResponse(
  ok: boolean,
  status: number,
  via: 'native' | 'curl' | 'error',
  text: string
): PhoenixResponse {
  return {
    ok,
    status,
    via,
    async text() {
      return text;
    },
    async json() {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}
