/**
 * @sendero/web-search/_fetch — Bun-fetch-vs-curl-fallback HTTP helper.
 *
 * Mirrors `@sendero/arize-phoenix/_fetch` exactly. Same defense:
 * Bun's `fetch` (HTTP/2 + ALPN signature) gets fingerprinted by some
 * Cloudflare WAFs as a bot, even with valid auth. Curl over HTTP/1.1
 * sails through. We try native fetch first; on detected bot challenge
 * (200 + text/html when JSON was requested) we retry via curl.
 *
 * For Google Custom Search specifically, native fetch typically works
 * cleanly — googleapis.com is not behind aggressive WAF. The fallback
 * is here for parity + defense against future Google routing changes
 * + symmetry with the Phoenix wrapper. Telemetry exposes `via:
 * 'native' | 'curl' | 'error'` so we can confirm production traffic
 * stays on the native path.
 */

import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 5000;

export interface SenderoFetchInit {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface SenderoFetchResponse {
  ok: boolean;
  status: number;
  via: 'native' | 'curl' | 'error';
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export async function senderoFetch(
  url: string,
  init: SenderoFetchInit = {}
): Promise<SenderoFetchResponse> {
  const headers = init.headers ?? {};
  const acceptHdr = headers.accept ?? headers.Accept ?? '';
  const wantsJson = acceptHdr.includes('json');
  const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const native = await tryNativeFetch(url, init, timeoutMs);
  if (native && !isBotChallenge(native, wantsJson)) {
    return native;
  }
  return curlFetch(url, init, timeoutMs);
}

async function tryNativeFetch(
  url: string,
  init: SenderoFetchInit,
  timeoutMs: number
): Promise<(SenderoFetchResponse & { _contentType: string }) | null> {
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
  res: SenderoFetchResponse & { _contentType?: string },
  wantsJson: boolean
): boolean {
  if (!wantsJson) return false;
  if (res.status !== 200) return false;
  return (res._contentType ?? '').toLowerCase().startsWith('text/html');
}

async function curlFetch(
  url: string,
  init: SenderoFetchInit,
  timeoutMs: number
): Promise<SenderoFetchResponse> {
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

  return new Promise<SenderoFetchResponse>(resolve => {
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
): SenderoFetchResponse {
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
