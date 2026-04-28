#!/usr/bin/env node
/**
 * @sendero/cli — agent-friendly CLI for the Sendero travel-ops platform.
 *
 *   npx @sendero/cli@latest auth login    # OAuth via browser, ~30 sec TTHW
 *   npx @sendero/cli@latest tools list    # see what you can call
 *   npx @sendero/cli@latest mcp install   # wire into Claude Code
 *
 * Architecture:
 *   index.ts             — commander entry, global flags, status-aware default
 *   commands/auth.ts     — login / logout / whoami (PKCE + paste fallback)
 *   commands/mcp.ts      — install (recommends plugin bundle)
 *   commands/tools.ts    — list / call / schema (raw MCP surface)
 *   client/auth.ts       — local-port listener + browser open + key capture
 *   client/api.ts        — Bearer-auth fetch wrapper
 *   client/pkce.ts       — RFC 7636 verifier + challenge
 *   config/store.ts      — ~/.sendero/key file + prefs
 *   output/{formatter,print}.ts — json/table/agent + NO_COLOR + spinner mute
 *   ui/spinner.ts        — ora wrapper (muted in agent/quiet/non-TTY mode)
 *
 * Auth precedence: env SENDERO_API_KEY > ~/.sendero/key > prompt.
 * Endpoint precedence: --api-url flag > env SENDERO_API_URL > app.sendero.travel.
 */

import { Command, Option } from 'commander';

import { createAuthCommand } from './commands/auth';
import { createChannelsCommand } from './commands/channels';
import { createMcpCommand } from './commands/mcp';
import { createProfilesCommand } from './commands/profiles';
import { createToolsCommand } from './commands/tools';
import { createWorkflowCommands } from './commands/workflows';
import { readKey } from './config/store';
import { resolveFormat, type GlobalFlags } from './output/formatter';
import { c, printJson, printText } from './output/print';
import { makeClient, whoami, type WhoamiResponse } from './client/api';

const VERSION = '0.2.0';

export function createProgram(): Command {
  const program = new Command('sendero')
    .version(VERSION, '-v, --version', 'Print the CLI version')
    .description('Sendero CLI — agent-friendly travel-ops surface');

  program
    .addOption(new Option('--json', 'Output as JSON (default when piped)').conflicts('table'))
    .addOption(new Option('--table', 'Output as table (default when TTY)').conflicts('json'))
    .addOption(new Option('--agent', 'Agent mode: JSON output, no prompts, no spinners'))
    .addOption(new Option('-q, --quiet', 'Suppress progress output'))
    .addOption(new Option('--no-input', 'Disable interactive prompts'))
    .addOption(new Option('-y, --yes', 'Skip confirmations'))
    .addOption(new Option('-n, --dry-run', 'Preview destructive actions without executing'))
    .addOption(new Option('--api-url <url>', 'Override the API base URL'))
    .addOption(new Option('--debug', 'Verbose HTTP logging to stderr'));

  program.addCommand(createAuthCommand());
  program.addCommand(createMcpCommand());
  program.addCommand(createToolsCommand());
  program.addCommand(createProfilesCommand());
  program.addCommand(createChannelsCommand());
  for (const cmd of createWorkflowCommands()) program.addCommand(cmd);

  // Status-aware default: `sendero` with no args shows current state +
  // the next thing to do. Caught by the design + DX review lenses as a
  // missing piece — the difference between "I'm lost" and "I know what
  // to type next" is one helpful default.
  program.action(async () => {
    const globals = program.opts() as GlobalFlags;
    await renderStatus(globals);
  });

  return program;
}

async function renderStatus(globals: GlobalFlags): Promise<void> {
  const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
  const key = readKey();
  const isJson = resolveFormat(globals) === 'json';

  if (!key) {
    if (isJson) {
      printJson({ authenticated: false, next: 'sendero auth login' });
      return;
    }
    printText(
      `${c.bold('Sendero CLI')} ${c.dim(`v${VERSION}`)}\n\n` +
        `${c.yellow('●')} Not signed in.\n\n` +
        `${c.dim('Get started:')}\n` +
        `  ${c.cyan('sendero auth login')}      ${c.dim('OAuth via browser')}\n` +
        `  ${c.cyan('sendero help')}            ${c.dim('see all commands')}\n`
    );
    return;
  }

  // Probe whoami so the status is real, not just "key file exists".
  const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });
  let me: WhoamiResponse | null = null;
  try {
    me = await whoami(client);
  } catch {
    // Stored key is invalid or network is down. Show a degraded status
    // rather than silently lying.
    if (isJson) {
      printJson({ authenticated: false, error: 'stored_key_invalid', next: 'sendero auth login' });
      return;
    }
    printText(
      `${c.bold('Sendero CLI')} ${c.dim(`v${VERSION}`)}\n\n` +
        `${c.red('●')} Stored key is invalid or expired.\n\n` +
        `${c.dim('Fix:')}\n` +
        `  ${c.cyan('sendero auth login')}      ${c.dim('re-authenticate')}\n`
    );
    return;
  }

  if (isJson) {
    printJson({ authenticated: true, ...me, next: 'sendero tools list' });
    return;
  }

  printText(
    `${c.bold('Sendero CLI')} ${c.dim(`v${VERSION}`)}\n\n` +
      `${c.green('●')} Signed in as ${c.bold(me.tenantId)} ${c.dim(`(${me.effectiveKeyType})`)}\n\n` +
      `${c.dim('Try:')}\n` +
      `  ${c.cyan('sendero tools list')}             ${c.dim('see what you can call')}\n` +
      `  ${c.cyan('sendero mcp install')}            ${c.dim('wire into Claude Code')}\n` +
      `  ${c.cyan('sendero tools call check_treasury')} ${c.dim('quick test')}\n`
  );
}

const program = createProgram();
program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(
    `${c.red('✘')} ${c.bold('sendero')}: ${err instanceof Error ? err.message : String(err)}\n`
  );
  process.exit(1);
});
