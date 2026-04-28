import { Command } from 'commander';

import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printJson, printText, printWhatsNext } from '../output/print';

export function createMcpCommand(): Command {
  const mcp = new Command('mcp').description('Wire Sendero into MCP-aware tools (Claude Code, etc.)');

  mcp
    .command('install')
    .description('Show how to install the Sendero Claude Code plugin')
    .action(() => {
      const globals = mcp.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const bundleUrl = `${apiUrl}/downloads/sendero-claude-code-plugin.zip`;
      const installCmd = 'claude --plugin-dir ~/.claude/plugins/sendero';

      if (resolveFormat(globals) === 'json') {
        printJson({
          ok: true,
          method: 'plugin-bundle',
          bundleUrl,
          steps: [
            { step: 1, action: 'download', url: bundleUrl },
            { step: 2, action: 'extract', target: '~/.claude/plugins/sendero' },
            { step: 3, action: 'launch', command: installCmd },
          ],
          notes:
            'Sendero ships a pre-bundled Claude Code plugin (skills, .mcp.json, README). ' +
            'Download + extract beats writing config files because it stays in sync with new ' +
            'skills automatically and never collides with your other MCP servers.',
        });
        return;
      }

      printText(
        `${c.bold('Install the Sendero Claude Code plugin')}\n\n` +
          `The plugin bundle is the one source of truth — skills, .mcp.json, README, all in ` +
          `one zip. Don't write your own .mcp.json against ${apiUrl}/api/mcp; the plugin keeps ` +
          `everything in lockstep with new tool releases.\n\n` +
          `${c.dim('1.')} Download: ${c.cyan(bundleUrl)}\n` +
          `${c.dim('2.')} Extract to ${c.cyan('~/.claude/plugins/sendero')}\n` +
          `${c.dim('3.')} Launch Claude Code with: ${c.cyan(installCmd)}\n`
      );
      printWhatsNext([
        { command: 'sendero tools list', description: 'see what the plugin exposes' },
        { command: 'sendero auth whoami', description: 'confirm your tenant + scopes' },
      ]);
    });

  return mcp;
}
