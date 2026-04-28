/**
 * First-class workflow command wraps for the top-5 most-used tools.
 *
 * Why thin wrappers and not generic `tools call`: discoverability. A new
 * developer typing `sendero --help` should see `flights`, `treasury`,
 * `settle`, `gateway` instead of "use tools call with the right name."
 * Each subcommand maps to a single MCP tool but with typed flags + help
 * text + sane defaults.
 *
 * Backed by the same `/api/mcp` JSON-RPC endpoint — no parallel surface.
 * If the underlying tool's schema changes, the wrapper still works
 * (extra fields ignored); we just don't surface new flags until we
 * regenerate the wrapper.
 */

import { Command } from 'commander';

import { makeClient, mcpCall } from '../client/api';
import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printError, printJson, printSuccess, printText } from '../output/print';
import { withSpinner } from '../ui/spinner';

interface ParentOpts {
  globals: GlobalFlags;
  apiUrl: string;
}

function getParent(cmd: Command): ParentOpts {
  const root = cmd.parent?.parent ?? cmd.parent;
  const globals = (root?.opts() ?? {}) as GlobalFlags;
  const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
  return { globals, apiUrl };
}

async function callTool(
  cmd: Command,
  toolName: string,
  args: Record<string, unknown>,
  opts: { successText?: (result: unknown) => string } = {}
): Promise<void> {
  const { globals, apiUrl } = getParent(cmd);
  const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

  try {
    const result = await withSpinner(
      `Running ${toolName}...`,
      () => mcpCall(client, toolName, args),
      { quiet: globals.quiet, agent: globals.agent }
    );

    if (result.error) {
      printError({
        problem: `${toolName} returned an error`,
        cause: result.error.message,
        fix: 'Run `sendero tools schema ' + toolName + '` to inspect the input shape',
      });
      process.exit(1);
    }

    if (resolveFormat(globals) === 'json') {
      printJson(result.result);
      return;
    }

    if (opts.successText) {
      printSuccess(opts.successText(result.result));
      printText(JSON.stringify(result.result, null, 2));
    } else {
      printJson(result.result);
    }
  } catch (err) {
    const e = err as { status?: number; message?: string };
    printError({
      problem: `${toolName} failed`,
      cause: e.message ?? 'unknown',
      fix: e.status === 401 ? 'Run `sendero auth login` first' : 'Check `sendero auth whoami` and your network',
    });
    process.exit(1);
  }
}

// ─── flights ───────────────────────────────────────────────────────────

function createFlightsCommand(): Command {
  const flights = new Command('flights').description('Search and book flights');

  flights
    .command('search <origin> <destination>')
    .description('Search flights between two airports')
    .option('--depart <date>', 'Departure date (YYYY-MM-DD)')
    .option('--return <date>', 'Return date (YYYY-MM-DD) for round trips')
    .option('--cabin <class>', 'Cabin class: economy, premium, business, first', 'economy')
    .option('--passengers <n>', 'Number of passengers', '1')
    .action(async function (this: Command, origin: string, destination: string, opts: Record<string, string>) {
      const args: Record<string, unknown> = {
        origin: origin.toUpperCase(),
        destination: destination.toUpperCase(),
        cabin: opts.cabin,
        passengers: Number(opts.passengers),
      };
      if (opts.depart) args.departureDate = opts.depart;
      if (opts.return) args.returnDate = opts.return;
      await callTool(this, 'search_flights', args);
    });

  flights
    .command('book <offerId>')
    .description('Book a previously searched flight offer')
    .option('--passenger <json>', 'Passenger details as JSON')
    .action(async function (this: Command, offerId: string, opts: { passenger?: string }) {
      const args: Record<string, unknown> = { offerId };
      if (opts.passenger) {
        try {
          args.passenger = JSON.parse(opts.passenger);
        } catch (e) {
          printError({
            problem: 'Invalid --passenger JSON',
            cause: e instanceof Error ? e.message : String(e),
          });
          process.exit(1);
        }
      }
      await callTool(this, 'book_flight', args, {
        successText: () => 'Flight booked',
      });
    });

  return flights;
}

// ─── treasury ──────────────────────────────────────────────────────────

function createTreasuryCommand(): Command {
  const treasury = new Command('treasury').description('Read tenant treasury balances');

  treasury
    .command('check')
    .description("Show your tenant's USDC + EURC balance on Arc")
    .option('--verify', 'Round-trip Circle live before returning (slower, ground truth)')
    .action(async function (this: Command, opts: { verify?: boolean }) {
      await callTool(this, 'check_treasury', { verify: Boolean(opts.verify) });
    });

  return treasury;
}

// ─── settle ────────────────────────────────────────────────────────────

function createSettleCommand(): Command {
  const settle = new Command('settle').description('Execute on-chain commission splits');

  settle
    .command('split <gross> <supplier>')
    .description('Canonical 4-way split: supplier net + agency + Sendero rail + validator')
    .option('--commission-bps <n>', 'Agency commission basis points (default 1000 = 10%)', '1000')
    .option('--sendero-fee-bps <n>', 'Sendero rail basis points (default 100 = 1%)', '100')
    .option('--dry-run', 'Print the split without firing the on-chain transaction')
    .action(async function (this: Command, gross: string, supplier: string, opts: Record<string, string | boolean>) {
      const { globals } = getParent(this);
      // Treat --dry-run as a global flag too — already in commander program opts.
      const dryRun = Boolean(opts.dryRun) || Boolean(globals.dryRun);

      if (dryRun) {
        const grossNum = Number(gross);
        const commissionBps = Number(opts.commissionBps);
        const senderoFeeBps = Number(opts.senderoFeeBps);
        const commission = (grossNum * commissionBps) / 10_000;
        const rail = (grossNum * senderoFeeBps) / 10_000;
        const validator = 0.02;
        const net = grossNum - commission - rail - validator;
        printText(c.bold('Dry run — no on-chain transaction:'));
        printText(`  ${c.dim('supplier')} ${supplier} → ${net.toFixed(6)} USDC`);
        printText(`  ${c.dim('agency  ')} ${commission.toFixed(6)} USDC`);
        printText(`  ${c.dim('sendero ')} ${rail.toFixed(6)} USDC`);
        printText(`  ${c.dim('validator')} ${validator.toFixed(6)} USDC`);
        return;
      }

      await callTool(this, 'settle_split', {
        gross,
        supplier,
        commissionBps: Number(opts.commissionBps),
        senderoFeeBps: Number(opts.senderoFeeBps),
      }, {
        successText: () => `Settlement complete`,
      });
    });

  return settle;
}

// ─── gateway ───────────────────────────────────────────────────────────

function createGatewayCommand(): Command {
  const gateway = new Command('gateway').description('Circle Gateway — cross-chain USDC liquidity');

  gateway
    .command('balance')
    .description('Unified USDC balance across every Gateway-supported testnet')
    .action(async function (this: Command) {
      await callTool(this, 'gateway_balance', {});
    });

  return gateway;
}

// ─── exports ───────────────────────────────────────────────────────────

export function createWorkflowCommands(): Command[] {
  return [
    createFlightsCommand(),
    createTreasuryCommand(),
    createSettleCommand(),
    createGatewayCommand(),
  ];
}
