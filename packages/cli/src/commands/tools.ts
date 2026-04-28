import { Command } from 'commander';

import { makeClient, mcpCall, openapi, type OpenApiSpec } from '../client/api';
import { resolveFormat, type GlobalFlags } from '../output/formatter';
import { c, printError, printJson, printText } from '../output/print';
import { withSpinner } from '../ui/spinner';

export function createToolsCommand(): Command {
  const tools = new Command('tools').description('Discover + invoke Sendero tools (MCP surface)');

  tools
    .command('list')
    .description('List the live tool catalog (from /api/openapi.json)')
    .option('--category <name>', 'Filter to one tool category (e.g. flights, treasury)')
    .action(async (opts: { category?: string }) => {
      const globals = tools.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

      try {
        const spec = await withSpinner(
          'Fetching catalog...',
          () => openapi(client),
          { quiet: globals.quiet, agent: globals.agent }
        );
        const allTools = extractTools(spec);
        const filtered = opts.category
          ? allTools.filter(t => t.startsWith(`${opts.category}_`))
          : allTools;

        if (resolveFormat(globals) === 'json') {
          printJson({ tools: filtered, count: filtered.length });
          return;
        }

        if (filtered.length === 0) {
          printText(c.dim('No tools available.'));
          return;
        }

        printText(`${c.bold(String(filtered.length))} tools available${opts.category ? ` in ${opts.category}` : ''}:`);
        for (const t of filtered) {
          printText(`  ${c.cyan(t)}`);
        }
      } catch (err) {
        const e = err as { status?: number; message?: string };
        printError({
          problem: 'Could not fetch tool catalog',
          cause: e.message ?? 'unknown',
          fix: e.status === 401 ? 'Run `sendero auth login` first' : 'Check your network and try again',
        });
        process.exit(1);
      }
    });

  tools
    .command('call <tool>')
    .description('Dispatch a tool over /api/mcp (JSON-RPC)')
    .argument('[args]', 'JSON-encoded arguments object')
    .addHelpText(
      'after',
      `
Examples:
  sendero tools call check_treasury
  sendero tools call check_treasury '{"verify":true}'
  sendero tools call search_flights '{"origin":"SFO","destination":"LHR"}'`
    )
    .action(async (tool: string, argsJson?: string) => {
      const globals = tools.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

      let args: Record<string, unknown> = {};
      if (argsJson) {
        try {
          args = JSON.parse(argsJson) as Record<string, unknown>;
        } catch (e) {
          printError({
            problem: 'Invalid JSON arguments',
            cause: e instanceof Error ? e.message : String(e),
            fix: `Wrap in single quotes: sendero tools call ${tool} '{"key":"value"}'`,
          });
          process.exit(1);
        }
      }

      try {
        const result = await withSpinner(
          `Calling ${tool}...`,
          () => mcpCall(client, tool, args),
          { quiet: globals.quiet, agent: globals.agent }
        );
        printJson(result);
        if (result.error) process.exit(1);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        printError({
          problem: `Tool call failed: ${tool}`,
          cause: e.message ?? 'unknown',
          fix: e.status === 401 ? 'Run `sendero auth login` first' : 'See `sendero tools list` for available tools',
        });
        process.exit(1);
      }
    });

  tools
    .command('schema <tool>')
    .description('Show the input schema for a tool (from /api/openapi.json)')
    .action(async (tool: string) => {
      const globals = tools.parent?.opts() as GlobalFlags;
      const apiUrl = globals.apiUrl ?? process.env.SENDERO_API_URL ?? 'https://app.sendero.travel';
      const client = makeClient({ baseUrl: apiUrl, debug: globals.debug });

      try {
        const spec = await withSpinner(
          'Fetching schema...',
          () => openapi(client),
          { quiet: globals.quiet, agent: globals.agent }
        );
        const schema = extractToolSchema(spec, tool);
        if (!schema) {
          printError({
            problem: `Tool "${tool}" not found`,
            fix: 'Run `sendero tools list` to see available tools',
          });
          process.exit(1);
        }
        printJson(schema);
      } catch (err) {
        const e = err as { status?: number; message?: string };
        printError({ problem: 'schema fetch failed', cause: e.message });
        process.exit(1);
      }
    });

  return tools;
}

// ─── Spec helpers ─────────────────────────────────────────────────────

function extractTools(spec: OpenApiSpec): string[] {
  const paths = spec.paths ?? {};
  return Object.keys(paths)
    .filter(p => p.startsWith('/tools/'))
    .map(p => p.replace('/tools/', '').replace(/\/$/, ''))
    .sort();
}

function extractToolSchema(spec: OpenApiSpec, tool: string): unknown {
  const path = spec.paths?.[`/tools/${tool}`] as Record<string, unknown> | undefined;
  if (!path) return null;
  // Look for the request body schema on the POST operation.
  const post = path.post as
    | { requestBody?: { content?: Record<string, { schema?: unknown }> } }
    | undefined;
  return post?.requestBody?.content?.['application/json']?.schema ?? path;
}
