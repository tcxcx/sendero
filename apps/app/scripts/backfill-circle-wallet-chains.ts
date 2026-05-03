/**
 * Backfill script — enumerate every Circle wallet set referenced by
 * `circle_wallets` and persist any missing per-chain rows.
 *
 * Why this exists: see `packages/circle/src/sync-wallet-set.ts`.
 * tl;dr — Circle wallet sets create the same address on every supported
 * chain as separate SCAs. Sendero historically only persisted the chain
 * we explicitly asked for, leaving "ghost" addresses on every other
 * chain that received funds (and lost track of $500 USDC testnet for
 * 10 days as a result).
 *
 * Usage:
 *
 *   bun run scripts/backfill-circle-wallet-chains.ts        # dry-run (default)
 *   bun run scripts/backfill-circle-wallet-chains.ts --apply
 *
 * Idempotent — re-running after `--apply` is a no-op for already-synced
 * tenants. Per-tenant errors are logged and don't stop the loop.
 */

import { prisma } from '@sendero/database';
import { syncCircleWalletSet } from '@sendero/circle/sync-wallet-set';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  console.log(`[backfill-circle-wallet-chains] mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  // Distinct wallet sets per tenant — one wallet set may underpin
  // multiple `circle_wallets` rows (treasury + per-chain ops).
  const rows = await prisma.circleWallet.findMany({
    where: { circleWalletSetId: { not: null } },
    select: { tenantId: true, clerkOrgId: true, circleWalletSetId: true },
    distinct: ['tenantId', 'circleWalletSetId'],
  });

  console.log(`  ${rows.length} (tenant, wallet-set) pairs to inspect`);

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalConflicts = 0;

  for (const row of rows) {
    if (!row.circleWalletSetId) continue;
    try {
      if (!apply) {
        // Dry-run: still call the sync so callers see what *would*
        // happen, but wrap in a Prisma transaction we roll back.
        const result = await prisma.$transaction(async () => {
          const r = await syncCircleWalletSet({
            tenantId: row.tenantId,
            clerkOrgId: row.clerkOrgId,
            walletSetId: row.circleWalletSetId!,
          });
          // Force rollback by throwing a known sentinel.
          throw new DryRunRollback(r);
        }).catch(err => {
          if (err instanceof DryRunRollback) return err.result;
          throw err;
        });
        printResult(row.tenantId, row.circleWalletSetId, result);
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalConflicts += result.conflicted;
      } else {
        const result = await syncCircleWalletSet({
          tenantId: row.tenantId,
          clerkOrgId: row.clerkOrgId,
          walletSetId: row.circleWalletSetId,
        });
        printResult(row.tenantId, row.circleWalletSetId, result);
        totalInserted += result.inserted;
        totalSkipped += result.skipped;
        totalConflicts += result.conflicted;
      }
    } catch (err) {
      console.error(
        `[backfill-circle-wallet-chains] tenant=${row.tenantId} walletSet=${row.circleWalletSetId} FAILED`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log('---');
  console.log(`  TOTAL inserted: ${totalInserted}`);
  console.log(`  TOTAL skipped:  ${totalSkipped}`);
  console.log(`  TOTAL conflicted: ${totalConflicts}`);
  if (!apply) {
    console.log('  (dry-run — re-run with --apply to persist)');
  }

  await prisma.$disconnect();
}

type SyncResult = Awaited<ReturnType<typeof syncCircleWalletSet>>;

class DryRunRollback extends Error {
  constructor(public result: SyncResult) {
    super('dry-run rollback');
  }
}

function printResult(tenantId: string, walletSetId: string, result: SyncResult): void {
  const tag = `[${tenantId.slice(0, 12)}…|${walletSetId.slice(0, 12)}…]`;
  console.log(
    `${tag} total=${result.total} inserted=${result.inserted} skipped=${result.skipped} conflicted=${result.conflicted}`
  );
  for (const d of result.details) {
    if (d.outcome === 'inserted') {
      console.log(`  + ${d.kind.padEnd(10)} ${d.chain.padEnd(15)} ${d.address}`);
    } else if (d.outcome === 'conflicted') {
      console.log(`  ! ${d.kind.padEnd(10)} ${d.chain.padEnd(15)} ${d.address}  (${d.reason})`);
    }
  }
}

main().catch(err => {
  console.error('[backfill-circle-wallet-chains] FATAL', err);
  process.exit(1);
});
