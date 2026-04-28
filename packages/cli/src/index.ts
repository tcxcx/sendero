#!/usr/bin/env node
/**
 * @sendero/cli — agent-native entry point for the Sendero travel-ops
 * platform. Designed to be run via `npx @sendero/cli@latest`, no
 * global install needed.
 *
 * v0.1.0 surface:
 *   - `auth login`     → opens browser to mint an API key
 *   - `auth whoami`    → prints current tenant + plan tier
 *   - `mcp install`    → bootstraps the Claude Code plugin into ~/.claude
 *   - `tools list`     → fetches the live tool catalog from /api/openapi.json
 *   - `tools call <tool> [json-args]` → JSON-RPC dispatch through /api/mcp
 *
 * Future commands route through the same `runCommand(argv)` dispatch
 * so we never grow a hand-rolled router. Every result prints both
 * a structured-JSON form (default for agents) and a human table when
 * stdout is a TTY.
 *
 * Auth precedence: env `SENDERO_API_KEY` > `~/.sendero/key` > prompt.
 * Endpoint precedence: env `SENDERO_API_URL` > `https://app.sendero.travel`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERSION = '0.1.0';
const DEFAULT_BASE = process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
const KEY_FILE = join(homedir(), '.sendero', 'key');

type Cmd = (argv: string[]) => Promise<number>;

const commands: Record<string, Cmd> = {
  auth: authCmd,
  mcp: mcpCmd,
  tools: toolsCmd,
  help: helpCmd,
  version: async () => {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  },
};

function readKey(): string | null {
  if (process.env.SENDERO_API_KEY) return process.env.SENDERO_API_KEY;
  if (existsSync(KEY_FILE)) {
    return readFileSync(KEY_FILE, 'utf8').trim() || null;
  }
  return null;
}

function writeKey(key: string): void {
  mkdirSync(join(homedir(), '.sendero'), { recursive: true });
  writeFileSync(KEY_FILE, `${key}\n`, { mode: 0o600 });
}

async function authCmd(argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'whoami';
  if (sub === 'login') {
    process.stdout.write(
      `Open this URL to mint an API key:\n  ${DEFAULT_BASE}/dashboard/settings/api-keys\n`
    );
    process.stdout.write(`\nPaste your key here, then press Enter:\n> `);
    const key = await readLine();
    if (!key.startsWith('ak_')) {
      process.stderr.write('Expected key prefix "ak_"; aborting.\n');
      return 1;
    }
    writeKey(key);
    process.stdout.write(`Saved to ${KEY_FILE}\n`);
    return 0;
  }
  if (sub === 'whoami') {
    const key = readKey();
    if (!key) {
      process.stderr.write('No API key — run `sendero auth login` first.\n');
      return 1;
    }
    const r = await fetch(`${DEFAULT_BASE}/api/auth/whoami`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      process.stderr.write(`whoami failed: ${r.status} ${r.statusText}\n`);
      return 1;
    }
    process.stdout.write(`${await r.text()}\n`);
    return 0;
  }
  if (sub === 'logout') {
    if (existsSync(KEY_FILE)) {
      writeFileSync(KEY_FILE, '');
      process.stdout.write('Logged out.\n');
    }
    return 0;
  }
  process.stderr.write(`Unknown auth subcommand: ${sub}\n`);
  return 1;
}

async function mcpCmd(argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'help';
  if (sub === 'install') {
    process.stdout.write('Sendero plugin install steps:\n');
    process.stdout.write('  1. Mint an API key:    sendero auth login\n');
    process.stdout.write(
      '  2. Clone the repo:     git clone https://github.com/tcxcx/sendero.git\n'
    );
    process.stdout.write(
      '  3. Launch Claude Code: claude --plugin-dir ./sendero/apps/claude-code-plugin\n'
    );
    process.stdout.write('\nFull docs: https://docs.sendero.travel/claude-code-plugin\n');
    return 0;
  }
  process.stderr.write(`Unknown mcp subcommand: ${sub}\n`);
  return 1;
}

async function toolsCmd(argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'list';
  const key = readKey();
  if (!key) {
    process.stderr.write('No API key — run `sendero auth login` first.\n');
    return 1;
  }
  if (sub === 'list') {
    const r = await fetch(`${DEFAULT_BASE}/api/openapi.json`, {
      headers: { authorization: `Bearer ${key}` },
    });
    if (!r.ok) {
      process.stderr.write(`openapi fetch failed: ${r.status} ${r.statusText}\n`);
      return 1;
    }
    const spec = (await r.json()) as { paths?: Record<string, unknown> };
    const tools = Object.keys(spec.paths ?? {})
      .filter(p => p.startsWith('/tools/'))
      .map(p => p.replace('/tools/', ''))
      .sort();
    if (process.stdout.isTTY) {
      process.stdout.write(`${tools.length} tools available:\n`);
      for (const t of tools) process.stdout.write(`  - ${t}\n`);
    } else {
      process.stdout.write(`${JSON.stringify({ tools })}\n`);
    }
    return 0;
  }
  if (sub === 'call') {
    const tool = argv[1];
    const args = argv[2] ? (JSON.parse(argv[2]) as unknown) : {};
    if (!tool) {
      process.stderr.write('usage: sendero tools call <tool> [json-args]\n');
      return 1;
    }
    const r = await fetch(`${DEFAULT_BASE}/api/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }),
    });
    process.stdout.write(`${await r.text()}\n`);
    return r.ok ? 0 : 1;
  }
  process.stderr.write(`Unknown tools subcommand: ${sub}\n`);
  return 1;
}

async function helpCmd(): Promise<number> {
  process.stdout.write(`Sendero CLI v${VERSION}

USAGE
  sendero <command> [subcommand] [args]

COMMANDS
  auth login      Mint and save an API key (browser flow)
  auth whoami     Print the current tenant + plan tier
  auth logout     Forget the saved key
  mcp install     Print Claude Code plugin install steps
  tools list      List the live tool catalog from /api/openapi.json
  tools call      Dispatch a tool over /api/mcp (JSON-RPC)
  version         Print the CLI version
  help            Print this message

ENV
  SENDERO_API_KEY    Override the saved key
  SENDERO_API_URL    Override the API base (default: ${DEFAULT_BASE})

DOCS
  https://docs.sendero.travel
  https://docs.sendero.travel/claude-code-plugin
`);
  return 0;
}

async function readLine(): Promise<string> {
  return await new Promise(resolve => {
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

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.exit(await helpCmd());
  }
  if (cmd === '--version' || cmd === '-v') {
    process.exit(await commands.version([]));
  }
  const handler = commands[cmd];
  if (!handler) {
    process.stderr.write(`Unknown command: ${cmd}\nRun \`sendero help\` for usage.\n`);
    process.exit(1);
  }
  process.exit(await handler(rest));
}

main().catch((err: unknown) => {
  process.stderr.write(`sendero-cli: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
