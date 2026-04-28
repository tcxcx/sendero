/**
 * OAuth login flow for the CLI.
 *
 * Architecture decision: the OAuth round-trip mints a Sendero `ak_*`
 * API key, which is what every Sendero API route already accepts. We
 * do NOT introduce a parallel OAuth-token auth path. The flow is:
 *
 *   1. CLI generates PKCE verifier + challenge + state
 *   2. CLI starts a local HTTP listener on a fallback port range
 *   3. CLI opens the user's browser to the Sendero OAuth gateway
 *      (`/api/cli/login?challenge=...&state=...&redirect=http://localhost:PORT/cb`)
 *   4. User authenticates in the browser (Clerk session)
 *   5. Browser POSTs to `/api/cli/mint-key` with the verifier+state, which:
 *        a. validates the Clerk session
 *        b. mints an `ak_*` API key against the user's active org
 *        c. redirects the browser back to the local listener with the key
 *   6. Local listener captures the key, closes the listener, returns it
 *   7. CLI stores the key in the keystore — done.
 *
 * Fallback: `--no-browser` mode prints the URL and prompts the user
 * to paste the key manually (reverts to today's behavior).
 */

import { createServer } from 'node:http';
import open from 'open';

import { isValidKeyShape, writeKey } from '../config/store';
import { c, printError, printSuccess } from '../output/print';
import { generateCodeVerifier, generateState, deriveCodeChallenge } from './pkce';

const PORT_RANGE = [8765, 8766, 8767, 8768, 8769, 8770] as const;
const TIMEOUT_MS = 5 * 60 * 1000; // 5 min — generous for SSO + 2FA

export interface LoginOpts {
  apiUrl: string;
  noBrowser?: boolean;
  quiet?: boolean;
}

export interface LoginResult {
  key: string;
  via: 'browser' | 'manual';
}

/**
 * Run the browser OAuth flow. Returns the minted API key on success.
 *
 * Throws on timeout, browser-open failure, or invalid state. Caller
 * (the auth command) is responsible for printing user-friendly errors.
 */
export async function loginWithBrowser(opts: LoginOpts): Promise<LoginResult> {
  const verifier = generateCodeVerifier();
  const challenge = deriveCodeChallenge(verifier);
  const state = generateState();

  const port = await findOpenPort();
  if (!port) {
    throw new Error(
      `No free local port in range ${PORT_RANGE[0]}-${PORT_RANGE[PORT_RANGE.length - 1]}. ` +
        `Close whatever's holding those ports and retry, or use \`--no-browser\` for manual paste.`
    );
  }
  const redirectUri = `http://localhost:${port}/cb`;

  const loginUrl = new URL(`${opts.apiUrl}/api/cli/login`);
  loginUrl.searchParams.set('challenge', challenge);
  loginUrl.searchParams.set('state', state);
  loginUrl.searchParams.set('redirect', redirectUri);

  // Listen first, THEN open the browser. Otherwise the redirect can
  // race the listener and 502.
  const keyPromise = listenForCallback({ port, expectedState: state, verifier });

  if (opts.noBrowser) {
    process.stdout.write(`Open this URL in your browser:\n  ${c.cyan(loginUrl.toString())}\n\n`);
  } else {
    if (!opts.quiet) {
      process.stdout.write(`Opening browser to ${c.cyan(loginUrl.hostname)}...\n`);
    }
    try {
      await open(loginUrl.toString());
    } catch {
      // Fall through — user can copy the URL manually.
      process.stdout.write(`Could not open browser. Open this URL manually:\n  ${c.cyan(loginUrl.toString())}\n\n`);
    }
  }

  const key = await keyPromise;
  writeKey(key);
  return { key, via: 'browser' };
}

/**
 * Manual paste fallback. Prints the dashboard URL and reads from stdin.
 * Used when --no-browser is set explicitly OR the auto-flow fails and
 * the user wants the legacy path.
 */
export async function loginWithPaste(opts: { apiUrl: string }): Promise<LoginResult> {
  process.stdout.write(
    `Open this URL to mint an API key:\n  ${c.cyan(`${opts.apiUrl}/dashboard/settings/api-keys`)}\n\n` +
      `Paste your key here, then press Enter:\n> `
  );
  const key = await readLine();
  if (!isValidKeyShape(key)) {
    throw new Error(
      `Invalid key format. Expected "ak_" followed by 16+ url-safe chars. ` +
        `Re-copy from the dashboard and try again.`
    );
  }
  writeKey(key);
  return { key, via: 'manual' };
}

// ─── Internals ────────────────────────────────────────────────────────

async function findOpenPort(): Promise<number | null> {
  for (const candidate of PORT_RANGE) {
    if (await tryPort(candidate)) return candidate;
  }
  return null;
}

function tryPort(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

interface ListenArgs {
  port: number;
  expectedState: string;
  verifier: string;
}

function listenForCallback(args: ListenArgs): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(
        new Error(
          `Login timed out after ${TIMEOUT_MS / 1000}s. ` +
            `Try \`sendero auth login --no-browser\` for the manual paste fallback.`
        )
      );
    }, TIMEOUT_MS);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${args.port}`);
      if (url.pathname !== '/cb') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const key = url.searchParams.get('key');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(htmlError(error));
        clearTimeout(timer);
        server.close();
        reject(new Error(`Login failed: ${error}`));
        return;
      }

      if (!key || !state) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(htmlError('missing_params'));
        clearTimeout(timer);
        server.close();
        reject(new Error('Login callback missing key or state.'));
        return;
      }

      if (state !== args.expectedState) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(htmlError('state_mismatch'));
        clearTimeout(timer);
        server.close();
        reject(new Error('State mismatch — possible CSRF. Aborting.'));
        return;
      }

      if (!isValidKeyShape(key)) {
        res.writeHead(400, { 'content-type': 'text/html' });
        res.end(htmlError('invalid_key_shape'));
        clearTimeout(timer);
        server.close();
        reject(new Error(`Server returned a malformed key. Got: ${key.slice(0, 8)}…`));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(htmlSuccess());
      clearTimeout(timer);
      server.close();
      resolve(key);
    });

    server.listen(args.port, '127.0.0.1');
  });
}

function htmlSuccess(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sendero CLI · authenticated</title>
  <style>
    body { font-family: ui-serif, Georgia, serif; background: #f4ead6; color: #2a221b; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { max-width: 28rem; padding: 2rem 2.5rem; background: #fff8e7; border: 1px solid #c0a374; border-radius: 4px; }
    h1 { margin: 0 0 1rem; font-weight: 450; }
    .ok { color: #c44535; font-weight: 600; }
    p { line-height: 1.55; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authenticated <span class="ok">✓</span></h1>
    <p>Your Sendero CLI is now signed in. You can close this tab and return to your terminal.</p>
  </div>
</body>
</html>`;
}

function htmlError(reason: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sendero CLI · login failed</title>
  <style>
    body { font-family: ui-serif, Georgia, serif; background: #f4ead6; color: #2a221b; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    .card { max-width: 28rem; padding: 2rem 2.5rem; background: #fff8e7; border: 1px solid #c0a374; border-radius: 4px; }
    h1 { margin: 0 0 1rem; font-weight: 450; }
    code { background: #ece1c4; padding: 0.1em 0.4em; border-radius: 2px; }
    p { line-height: 1.55; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Login failed</h1>
    <p>Reason: <code>${escapeHtml(reason)}</code></p>
    <p>Return to your terminal to retry. If the problem persists, run <code>sendero auth login --no-browser</code> to use manual paste instead.</p>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch] ?? ch);
}

async function readLine(): Promise<string> {
  return new Promise(resolve => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      const idx = chunk.indexOf('\n');
      if (idx === -1) {
        buf += chunk;
        return;
      }
      buf += chunk.slice(0, idx);
      process.stdin.removeListener('data', onData);
      process.stdin.pause();
      resolve(buf.trim());
    };
    process.stdin.on('data', onData);
    process.stdin.resume();
  });
}

// Re-exports so command code has one import surface for auth concerns.
export { printError, printSuccess } from '../output/print';
