/**
 * Sync every Circle wallet in a wallet set into Sendero's
 * `circle_wallets` table.
 *
 * Background — the bug this fixes (2026-05-02):
 * Circle's wallet sets produce **the same address on every supported
 * chain**, each as its own SCA contract. When tenant onboarding
 * registers the treasury for one chain (e.g. `ARC-TESTNET`) and the
 * operations DCW for another (e.g. `MATIC-AMOY`), Circle silently
 * creates parallel SCAs on every other chain in the set. Those
 * "ghost" addresses receive USDC just like the registered ones, but
 * Sendero queries never enumerate them — funds become unfindable
 * until manually rescued.
 *
 * Concrete loss: $500 USDC testnet stranded for ~10 days at
 * `0xfa5c635c…` on Arc Testnet. The address was registered as
 * `MATIC-AMOY operations` in our DB but Circle's wallet set had
 * also created an `ARC-TESTNET` variant under a different UUID
 * (`96351d09-cadc-5af9-b801-c466b7899a06`). Recovered 2026-05-02
 * via wallet-set enumeration; drain hash `0x6491af34…b7515e`.
 *
 * Algorithm:
 *   1. Call `listWallets({ walletSetId })` to enumerate every Circle
 *      wallet in the set.
 *   2. For each wallet, check if a row already exists for
 *      (tenantId, address, chain). If yes → no-op.
 *   3. Derive `kind` from any other row in this tenant that has the
 *      same address — same logical wallet, different chain. Default
 *      to `'shadow'` if no other row matches.
 *   4. Insert with `kind`. The unique `(tenantId, kind, chain)` index
 *      gates against duplicate inserts on retry; conflicts are
 *      logged and skipped without overwriting.
 *
 * Idempotent end-to-end. Safe to call from provisioning hooks, from a
 * backfill cron, or from the one-shot script.
 */

import { prisma } from '@sendero/database';

export interface SyncWalletSetArgs {
  tenantId: string;
  clerkOrgId?: string | null;
  /** Circle wallet-set UUID. */
  walletSetId: string;
  /** Optional SDK injection — defaults to `getCircle()`. Tests inject a stub. */
  sdk?: SyncCircleSdk;
}

/** Narrow adapter over the Circle DCW SDK methods this helper needs. */
export interface SyncCircleSdk {
  listWallets: (args: { walletSetId: string; pageSize?: number }) => Promise<{
    data?: {
      wallets?: Array<{
        id: string;
        address: string;
        blockchain: string;
        accountType?: 'EOA' | 'SCA';
      }>;
    };
  }>;
}

export interface SyncWalletSetResult {
  /** Total wallets enumerated from Circle. */
  total: number;
  /** Wallets newly persisted on this run. */
  inserted: number;
  /** Wallets already present in the DB (no-ops). */
  skipped: number;
  /** Wallets that conflicted on the unique key (logged + skipped). */
  conflicted: number;
  /** Per-wallet outcomes for forensics. */
  details: Array<{
    walletId: string;
    address: string;
    chain: string;
    outcome: 'inserted' | 'skipped' | 'conflicted';
    kind: string;
    reason?: string;
  }>;
}

export async function syncCircleWalletSet(
  args: SyncWalletSetArgs
): Promise<SyncWalletSetResult> {
  const sdk = args.sdk ?? (await resolveSdk());
  // Circle's API caps `pageSize` at 50. Wallet sets currently hold ≤
  // 10 entries (one per supported chain), so a single page is enough.
  // If we ever exceed 50, this needs cursor pagination.
  const list = await sdk.listWallets({ walletSetId: args.walletSetId, pageSize: 50 });
  const wallets = list?.data?.wallets ?? [];

  // Pull every existing row for this tenant once — saves N round-trips
  // when the wallet set has many entries.
  const existing = await prisma.circleWallet.findMany({
    where: { tenantId: args.tenantId },
    select: { address: true, chain: true, kind: true, circleWalletId: true },
  });
  const existingByKey = new Map<string, (typeof existing)[number]>();
  const kindByAddress = new Map<string, string>();
  for (const row of existing) {
    existingByKey.set(`${row.address.toLowerCase()}|${row.chain}`, row);
    kindByAddress.set(row.address.toLowerCase(), row.kind);
  }

  const result: SyncWalletSetResult = {
    total: wallets.length,
    inserted: 0,
    skipped: 0,
    conflicted: 0,
    details: [],
  };

  for (const w of wallets) {
    const canonicalAddress = canonicalAddress_(w.address, w.blockchain);
    const key = `${canonicalAddress.toLowerCase()}|${w.blockchain}`;

    // Already present — nothing to do.
    if (existingByKey.has(key)) {
      result.skipped++;
      result.details.push({
        walletId: w.id,
        address: canonicalAddress,
        chain: w.blockchain,
        outcome: 'skipped',
        kind: existingByKey.get(key)!.kind,
        reason: 'already-persisted',
      });
      continue;
    }

    // Derive kind from another row with the same address. Mirrors the
    // logical role across chains — if 0xABC… is `operations` on
    // MATIC-AMOY, the same address on ARC-TESTNET is also operations.
    const inheritedKind = kindByAddress.get(canonicalAddress.toLowerCase());
    const kind = inheritedKind ?? 'shadow';

    // Insert path with unique-key conflict recovery. Two addresses can
    // share a (kind, chain) slot if Circle ever created multiple ops
    // wallets on the same chain — falling back to a wallet-id-suffixed
    // kind (e.g. `shadow-8d58fbc3`) preserves the row instead of
    // dropping it on the floor.
    let attemptedKind = kind;
    let inserted = false;
    for (const candidate of [kind, `shadow-${w.id.slice(0, 8)}`]) {
      attemptedKind = candidate;
      try {
        await prisma.circleWallet.create({
          data: {
            tenantId: args.tenantId,
            clerkOrgId: args.clerkOrgId ?? null,
            address: canonicalAddress,
            kind: candidate,
            chain: w.blockchain,
            circleWalletSetId: args.walletSetId,
            circleWalletId: w.id,
          },
        });
        result.inserted++;
        kindByAddress.set(canonicalAddress.toLowerCase(), candidate);
        existingByKey.set(key, {
          address: canonicalAddress,
          chain: w.blockchain,
          kind: candidate,
          circleWalletId: w.id,
        });
        result.details.push({
          walletId: w.id,
          address: canonicalAddress,
          chain: w.blockchain,
          outcome: 'inserted',
          kind: candidate,
        });
        inserted = true;
        break;
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== 'P2002') throw err;
        // try next candidate
      }
    }
    if (!inserted) {
      result.conflicted++;
      result.details.push({
        walletId: w.id,
        address: canonicalAddress,
        chain: w.blockchain,
        outcome: 'conflicted',
        kind: attemptedKind,
        reason: 'unique-conflict-on-tenant-kind-chain',
      });
    }
  }

  return result;
}

function canonicalAddress_(address: string, blockchain: string): string {
  // EVM addresses canonicalize to lowercase. Solana base58 is case-sensitive.
  if (blockchain === 'SOL-DEVNET' || blockchain === 'SOL') return address;
  return address.toLowerCase();
}

async function resolveSdk(): Promise<SyncCircleSdk> {
  try {
    const mod = await import('./wallets');
    if ('getCircle' in mod && typeof (mod as { getCircle?: unknown }).getCircle === 'function') {
      const circle = (mod as { getCircle: () => unknown }).getCircle() as {
        listWallets: SyncCircleSdk['listWallets'];
      };
      return {
        listWallets: a => circle.listWallets(a),
      };
    }
  } catch {
    // fall through
  }
  throw new Error(
    'syncCircleWalletSet: cannot resolve a Circle SDK. Pass `sdk` explicitly or ensure @sendero/circle/wallets exports getCircle().'
  );
}
