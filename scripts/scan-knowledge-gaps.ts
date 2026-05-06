/**
 * Knowledge-gap scanner — `bun gaps:scan`.
 *
 * Pulls open `KnowledgeGap` rows the agent has self-reported, buckets
 * them into a kanban-style markdown board at `docs/agent-gaps/board.md`,
 * and (optionally) auto-resolves stale rows.
 *
 * Pure rendering + arg-parsing helpers live in
 * `scan-knowledge-gaps-render.ts` so the unit suite can exercise them
 * without spinning up Prisma. This file is the DB-coupled CLI shell.
 *
 * Output board structure:
 *   - 🚨 Critical (severity=critical OR blocking + occurrenceCount≥3)
 *   - ⚠️ High
 *   - 🛠 Medium
 *   - 📦 Low
 *   - ✅ Recently resolved (last 14 days)
 *
 * Flags:
 *   --tenant <id>                   Filter to one tenant. Default: all.
 *   --since <YYYY-MM-DD>            Lower bound on lastSeenAt. Default: 30d ago.
 *   --resolve-stale-days <N>        Mark rows resolved when lastSeenAt > N days ago. Default: off.
 *   --output <path>                 Override output path. Default: docs/agent-gaps/board.md.
 *   --dry-run                       Print to stdout, don't touch the file.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@sendero/database';

import {
  parseArgs,
  renderBoard,
  type CliArgs,
  type KnowledgeGapRow,
} from './scan-knowledge-gaps-render';

async function main(args: CliArgs): Promise<void> {
  const tenantFilter = args.tenant ? { tenantId: args.tenant } : {};

  // Auto-resolve stale rows BEFORE rendering so the board reflects
  // the post-sweep state in a single run. Stale = open, not blocking,
  // last seen > N days ago. Blocking rows never auto-resolve — those
  // need a human to confirm the fix shipped.
  let resolvedThisRun: KnowledgeGapRow[] = [];
  if (args.resolveStaleDays !== null) {
    const cutoff = new Date(Date.now() - args.resolveStaleDays * 24 * 60 * 60 * 1000);
    const stale = (await prisma.knowledgeGap.findMany({
      where: {
        ...tenantFilter,
        status: 'open',
        blockingTraveler: false,
        lastSeenAt: { lt: cutoff },
      },
    })) as unknown as KnowledgeGapRow[];
    if (stale.length > 0 && !args.dryRun) {
      await prisma.knowledgeGap.updateMany({
        where: { id: { in: stale.map(s => s.id) } },
        data: {
          status: 'resolved',
          resolvedAt: new Date(),
          resolutionNote: `Auto-resolved by gap-scanner: not seen for ${args.resolveStaleDays}d.`,
        },
      });
      resolvedThisRun = stale;
    } else if (stale.length > 0) {
      console.log(`[dry-run] would auto-resolve ${stale.length} stale rows`);
      resolvedThisRun = stale;
    }
  }

  const open = (await prisma.knowledgeGap.findMany({
    where: {
      ...tenantFilter,
      status: { in: ['open', 'triaged', 'in_progress'] },
      lastSeenAt: { gte: args.since },
    },
    orderBy: [{ severity: 'desc' }, { lastSeenAt: 'desc' }],
  })) as unknown as KnowledgeGapRow[];

  const recentlyResolved = (await prisma.knowledgeGap.findMany({
    where: {
      ...tenantFilter,
      status: 'resolved',
      resolvedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { resolvedAt: 'desc' },
    take: 50,
  })) as unknown as KnowledgeGapRow[];

  const board = renderBoard({
    open,
    recentlyResolved,
    generatedAt: new Date(),
    resolveStaleDays: args.resolveStaleDays,
    resolvedThisRun,
  });

  if (args.dryRun) {
    process.stdout.write(board);
    console.error(`\n[dry-run] would write ${board.length} bytes to ${args.outputPath}`);
    return;
  }

  // Read existing to avoid no-op writes (keeps git diffs clean when
  // nothing changed — important for the watch-cron pattern).
  const existing = existsSync(args.outputPath) ? readFileSync(args.outputPath, 'utf8') : null;
  if (existing === board) {
    console.log(`No changes — ${args.outputPath} unchanged.`);
    return;
  }
  mkdirSync(dirname(args.outputPath), { recursive: true });
  writeFileSync(args.outputPath, board, 'utf8');
  console.log(
    `Wrote ${board.length} bytes to ${args.outputPath} · ${open.length} open · ${resolvedThisRun.length} auto-resolved.`
  );
}

if (import.meta.main) {
  // Self-locate the repo root so the default output path is correct
  // regardless of the cwd the script was invoked from. `import.meta.url`
  // points at this file (`<root>/scripts/scan-knowledge-gaps.ts`), so
  // walking up one directory lands at the repo root. Fixes the
  // workspace-resolution bug where `bun run …/scripts/scan-…` from
  // `apps/app/` defaulted the board to `apps/app/docs/agent-gaps/`.
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const defaultOutputPath = resolve(repoRoot, 'docs/agent-gaps/board.md');
  const args = parseArgs(process.argv.slice(2), defaultOutputPath);
  main(args).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
