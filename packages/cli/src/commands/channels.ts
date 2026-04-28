import { Command } from 'commander';
import open from 'open';

import { makeClient, request, whoami } from '../client/api';
import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printError, printJson, printSuccess, printText, printWhatsNext } from '../output/print';
import { withSpinner } from '../ui/spinner';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

interface PollResponse {
  installed: boolean;
  teamName?: string;
  installedAt?: string;
}

export function createChannelsCommand(): Command {
  const channels = new Command('channels').description(
    'Connect external messaging channels (Slack, WhatsApp) to your tenant'
  );

  channels
    .command('connect <channel>')
    .description('Open the install flow for a channel and wait for completion')
    .option('--no-browser', 'Print the install URL instead of opening it')
    .addHelpText(
      'after',
      `
Channels:
  slack       Workspace bot install via OAuth
  whatsapp    Number provisioning via Kapso wizard

Examples:
  sendero channels connect slack
  sendero channels connect whatsapp --no-browser`
    )
    .action(async (channel: string, opts: { browser?: boolean }) => {
      const globals = channels.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

      const supported = ['slack', 'whatsapp'];
      if (!supported.includes(channel)) {
        printError({
          problem: `Unknown channel "${channel}"`,
          fix: `Use one of: ${supported.join(', ')}`,
        });
        process.exit(1);
      }

      // Resolve tenant from the API key — we need the slug for the per-tenant
      // install URL pattern (`/install/slack?tenant=<slug>`).
      let tenantId: string;
      try {
        const me = await whoami(client);
        tenantId = me.tenantId;
      } catch (err) {
        const e = err as { status?: number; message?: string };
        printError({
          problem: 'Could not resolve tenant from your API key',
          cause: e.message,
          fix: 'Run `sendero auth login` first',
        });
        process.exit(1);
      }

      const installUrl = buildInstallUrl(apiUrl, channel, tenantId);

      if (opts.browser === false) {
        printText(`Open this URL to install ${channel}:\n  ${c.cyan(installUrl)}\n`);
      } else {
        if (!globals.quiet) printText(`Opening ${channel} install flow...`);
        try {
          await open(installUrl);
        } catch {
          printText(`Could not open browser. Open manually:\n  ${c.cyan(installUrl)}\n`);
        }
      }

      // Poll the new /api/cli/channels/poll endpoint for completion.
      try {
        const result = await withSpinner(
          `Waiting for ${channel} install to complete (up to ${POLL_TIMEOUT_MS / 60000} min)...`,
          () => pollUntilInstalled(client, channel, tenantId),
          { quiet: globals.quiet, agent: globals.agent }
        );

        if (resolveFormat(globals) === 'json') {
          printJson({ ok: true, channel, ...result });
          return;
        }

        printSuccess(`${channel} connected${result.teamName ? `: ${c.bold(result.teamName)}` : ''}`);
        printWhatsNext([
          { command: `sendero tools call check_treasury`, description: 'verify the agent surface still works' },
          { command: `sendero channels status`, description: 'see all connected channels' },
        ]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        printError({
          problem: `${channel} install did not complete`,
          cause: message,
          fix: `Re-run \`sendero channels connect ${channel}\` and complete the install in browser within ${POLL_TIMEOUT_MS / 60000} min.`,
        });
        process.exit(1);
      }
    });

  channels
    .command('status')
    .description('Show connected channels for the active tenant')
    .action(async () => {
      const globals = channels.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

      try {
        const me = await whoami(client);
        const status = await request<{
          slack: PollResponse;
          whatsapp: PollResponse;
        }>(client, `/api/cli/channels/status?tenantId=${encodeURIComponent(me.tenantId)}`);

        if (resolveFormat(globals) === 'json') {
          printJson({ tenantId: me.tenantId, ...status });
          return;
        }

        const fmt = (label: string, p: PollResponse): string => {
          const dot = p.installed ? c.green('●') : c.dim('○');
          const detail = p.installed && p.teamName ? ` ${c.dim(`(${p.teamName})`)}` : '';
          return `  ${dot} ${label}${detail}`;
        };

        printText(`${c.bold('Channels for')} ${c.bold(me.tenantId)}:`);
        printText(fmt('Slack', status.slack));
        printText(fmt('WhatsApp', status.whatsapp));
      } catch (err) {
        const e = err as { status?: number; message?: string };
        if (e.status === 404) {
          printError({
            problem: 'Channel status endpoint not yet available',
            fix: 'The /api/cli/channels/* endpoints are part of P1. Update your Sendero deployment.',
          });
        } else {
          printError({
            problem: 'Could not fetch channel status',
            cause: e.message,
          });
        }
        process.exit(1);
      }
    });

  return channels;
}

function buildInstallUrl(apiUrl: string, channel: string, tenantId: string): string {
  // The tenantId vs slug ambiguity: the existing /install/slack pattern uses
  // the slug, but the CLI knows the tenantId from whoami. We pass tenantId
  // and let the install page resolve to the slug server-side.
  const url = new URL(`${apiUrl}/install/${channel}`);
  url.searchParams.set('tenantId', tenantId);
  url.searchParams.set('source', 'cli');
  return url.toString();
}

async function pollUntilInstalled(
  client: ReturnType<typeof makeClient>,
  channel: string,
  tenantId: string
): Promise<PollResponse> {
  const start = Date.now();
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    try {
      const res = await request<PollResponse>(
        client,
        `/api/cli/channels/poll?tenantId=${encodeURIComponent(tenantId)}&channel=${channel}`
      );
      if (res.installed) return res;
    } catch {
      // Network blip — keep polling. Real failures (401, 403) will surface
      // when the timeout fires below.
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Install poll timed out after ${POLL_TIMEOUT_MS / 60000} min.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
