/**
 * Atomic ERC-8004 identity provisioning for Sendero subjects (Tenant orgs
 * and User travelers). Mirrors the `mintStampTool` state machine: a row
 * lives at `status='pending'` while the on-chain mint is in flight, gets
 * stamped with the assigned `agentId` from the Transfer event on success,
 * and is left `pending` on transient failure (the cron sweeper retries).
 * Rows that previously reached `failed` are not terminal; the sweeper
 * can reset and retry them after the provisioning dependency is fixed.
 *
 * Wallet provisioning succeeds independently of identity provisioning
 * (try/catch in the caller). The wallet is the source of truth — the
 * identity is a nice-to-have that catches up later via the sweeper. This
 * matches the user's principle: a traveler who hasn't yet made a trip
 * doesn't need an on-chain identity, but one is provisioned eagerly when
 * the wallet lands so reputation can accumulate from day one.
 *
 * Idempotency: `(kind, tenantId)` and `(kind, userId)` are UNIQUE in
 * Postgres. Re-running `ensureOrgIdentity({ tenantId })` after a
 * successful mint short-circuits and returns the cached row. The
 * `(contract, agentId)` UNIQUE catches the (extremely rare) case of
 * Sendero handing the same agentId to two subjects via misconfigured
 * Circle response — fail loudly rather than silently corrupt.
 */

import { IDENTITY_REGISTRY, registerAgent } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

// `@sendero/metaplex` is dynamically imported inside the Sol branch
// of ensureOrgIdentity to keep @metaplex-foundation/umi +
// @solana/web3.js + bs58 out of every route bundle that consumes
// `@sendero/tools`. Eagerly importing the package at module-load
// pushed the Vercel Turbopack build past 16GB OOM. The Sol identity
// mint is a leaf path that runs once per tenant, so the lazy-load
// cost is negligible.

const ARC_TESTNET_CHAIN_ID = 5042002;
// Solana devnet chain id sentinel — Solana doesn't have an EVM-style
// chain id, so we use the same `5` constant the rest of the codebase
// uses (see packages/tools/src/gateway-balance.ts, moonpay-topup.ts,
// ensure-traveler-wallet.ts). Stored on OnchainIdentity.chainId for
// Sol rows; the discriminator that actually matters is `chain='sol'`.
const SOL_DEVNET_CHAIN_ID = 5;

/// After this many consecutive failed mint attempts, the sweeper resets
/// the row back to a fresh pending attempt. 12 attempts × 5min cron =
/// ~1 hour before it starts a new retry window.
const MAX_ATTEMPTS = 12;

/// Stable, public URL the contract stores via tokenURI(). The page is
/// served by `apps/app/app/agents/[kind]/[id]/metadata.json` and
/// returns ERC-8004 agent metadata JSON. URL is keyed on the Sendero
/// id (tenantId/userId), not the on-chain agentId, so it survives any
/// future re-mint without breaking the on-chain pointer.
///
/// Resolution priority:
///   1. `SENDERO_IDENTITY_METADATA_BASE_URL` — explicit public base.
///      Set this in local dev when the app runs on `http://localhost:*`,
///      otherwise the Metaplex Agent API can't fetch the URI to validate
///      it ("Invalid input data" at mint time). Dev + prod share the
///      same Neon DB, so pointing local dev at the prod app URL Just
///      Works for shared records.
///   2. `NEXT_PUBLIC_APP_URL` — canonical app origin for prod deploys.
function metadataUriFor(kind: 'org' | 'user', subjectId: string): string {
  const base =
    process.env.SENDERO_IDENTITY_METADATA_BASE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';
  if (!base) {
    throw new Error(
      'No metadata base URL — set SENDERO_IDENTITY_METADATA_BASE_URL or NEXT_PUBLIC_APP_URL.'
    );
  }
  return `${base.replace(/\/$/, '')}/agents/${kind}/${subjectId}/metadata.json`;
}

export interface ProvisionIdentityResult {
  status: 'minted' | 'pending' | 'cached';
  identityId: string;
  agentId: string | null;
  contract: string;
  holderAddress: string;
  txHash: string | null;
}

/**
 * Provision an on-chain identity for an organization. Routes on
 * `tenant.primaryChain`:
 *   - 'arc' → ERC-8004 IdentityRegistry mint via @sendero/arc/identity.
 *             Treasury CircleWallet (chain='ARC-TESTNET') becomes the
 *             NFT owner.
 *   - 'sol' → Metaplex Agent Registry mint via @sendero/metaplex.
 *             Treasury CircleWallet (chain='SOL-DEVNET', a Squads V4
 *             vault pubkey) is the agent attestation subject; the
 *             on-chain owner is the Sendero platform key (Squads
 *             vault PDAs cannot sign API-built txns).
 *
 * Re-running after a successful mint returns `status='cached'`.
 * Pre-cascade-aware code threw "no treasury CircleWallet on
 * ARC-TESTNET" for every Sol org because the lookup was hardcoded.
 */
export async function ensureOrgIdentity(args: {
  tenantId: string;
}): Promise<ProvisionIdentityResult> {
  const { tenantId } = args;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true, displayName: true },
  });
  if (!tenant) {
    throw new Error(`Cannot mint org identity — Tenant ${tenantId} not found.`);
  }
  const chain: 'arc' | 'sol' = tenant.primaryChain === 'sol' ? 'sol' : 'arc';

  const existing = await prisma.onchainIdentity.findFirst({
    where: { kind: 'org', tenantId, chain },
  });
  if (existing && existing.status === 'minted' && existing.agentId) {
    return {
      status: 'cached',
      identityId: existing.id,
      agentId: existing.agentId,
      contract: existing.contract,
      holderAddress: existing.holderAddress,
      txHash: existing.mintTxHash,
    };
  }

  if (chain === 'sol') {
    return ensureOrgIdentitySol({
      tenantId,
      displayName: tenant.displayName,
      existingId: existing?.id ?? null,
    });
  }

  // --- Arc path (default) ---
  const treasury = await prisma.circleWallet.findFirst({
    where: { tenantId, kind: 'treasury', chain: 'ARC-TESTNET' },
    select: { address: true, circleWalletId: true },
  });
  if (!treasury) {
    throw new Error(
      `Cannot mint org identity for tenant ${tenantId} — no treasury CircleWallet on ARC-TESTNET. Provision the wallet first via provisionTenantWallet.`
    );
  }
  if (!treasury.circleWalletId) {
    throw new Error(
      `Cannot mint org identity for tenant ${tenantId} — treasury CircleWallet has no circleWalletId (UUID). Re-provision via the Clerk org webhook.`
    );
  }

  const holderAddress = treasury.address.toLowerCase();
  const metadataUri = metadataUriFor('org', tenantId);

  return mintAndPersist({
    kind: 'org',
    tenantId,
    userId: null,
    holderAddress,
    walletUuid: treasury.circleWalletId,
    metadataUri,
    existingId: existing?.id ?? null,
  });
}

/**
 * Solana org-identity branch. Mints a Metaplex Core asset registered
 * with the Agent Registry. The on-chain owner is the Sendero platform
 * key (the Metaplex Agent API requires a wallet that can sign the
 * API-built tx; Squads V4 vault PDAs cannot). The tenant's Squads vault
 * pubkey is recorded as `holderAddress` so DB queries find the tenant
 * by treasury — same shape as Arc, different chain.
 */
async function ensureOrgIdentitySol(args: {
  tenantId: string;
  displayName: string;
  existingId: string | null;
}): Promise<ProvisionIdentityResult> {
  const { tenantId, displayName, existingId } = args;

  const treasury = await prisma.circleWallet.findFirst({
    where: { tenantId, kind: 'treasury', chain: 'SOL-DEVNET' },
    select: { address: true },
  });
  if (!treasury) {
    throw new Error(
      `Cannot mint org identity for tenant ${tenantId} — no treasury CircleWallet on SOL-DEVNET. Provision the wallet first via provisionTenantSolanaTreasury.`
    );
  }

  const metadataUri = metadataUriFor('org', tenantId);

  // Insert/update the pending row before the network round-trip so a
  // crash mid-mint is reasoned-about. Same idempotency contract as
  // mintAndPersist for the Arc path.
  const pending = existingId
    ? await prisma.onchainIdentity.update({
        where: { id: existingId },
        data: {
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          status: 'pending',
        },
      })
    : await prisma.onchainIdentity.create({
        data: {
          kind: 'org',
          tenantId,
          userId: null,
          chain: 'sol',
          chainId: SOL_DEVNET_CHAIN_ID,
          // Final `contract` is overwritten with the Metaplex Agent
          // Registry program id once the mint lands. Placeholder until
          // then so the row is queryable while pending.
          contract: 'metaplex-agent-registry',
          holderAddress: treasury.address,
          metadataUri,
          status: 'pending',
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });

  // Dynamic import — see file-top comment for why. The first call pays
  // the load cost (umi + mpl-agent-registry + web3.js); subsequent
  // calls in the same function instance hit the V8 module cache.
  const { mintAndRegisterAgentIdentity } = await import('@sendero/metaplex');
  let result: Awaited<ReturnType<typeof mintAndRegisterAgentIdentity>>;
  try {
    result = await mintAndRegisterAgentIdentity({
      tenantId,
      name: displayName || `Sendero tenant ${tenantId.slice(0, 8)}`,
      ownerPubkey: treasury.address,
      identityUri: metadataUri,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_metaplex_error';
    await prisma.onchainIdentity.update({
      where: { id: pending.id },
      data: { lastError: message.slice(0, 500) },
    });
    throw err;
  }

  const minted = await prisma.onchainIdentity.update({
    where: { id: pending.id },
    data: {
      agentId: result.assetAddress,
      mintTxHash: result.signature,
      // Agent Registry program id from the result (we don't know it
      // statically — Metaplex resolves it from the network). Stored
      // here for explorer linking.
      contract: 'metaplex-agent-registry',
      mintedAt: new Date(),
      status: 'minted',
      lastError: null,
    },
  });

  return {
    status: 'minted',
    identityId: minted.id,
    agentId: minted.agentId,
    contract: minted.contract,
    holderAddress: minted.holderAddress,
    txHash: minted.mintTxHash,
  };
}

/**
 * Provision an ERC-8004 identity for a user traveler. The user's DCW
 * `Wallet` (provisioner='dcw', chainId=5042002) becomes the agent NFT
 * owner. Re-running after a successful mint returns the cached row.
 *
 * Returns `status='pending'` when the wallet exists but the on-chain
 * mint hasn't completed yet — the sweeper will retry.
 */
export async function ensureUserIdentity(args: {
  userId: string;
}): Promise<ProvisionIdentityResult> {
  const { userId } = args;

  const existing = await prisma.onchainIdentity.findFirst({
    where: { kind: 'user', userId },
  });
  if (existing && existing.status === 'minted' && existing.agentId) {
    return {
      status: 'cached',
      identityId: existing.id,
      agentId: existing.agentId,
      contract: existing.contract,
      holderAddress: existing.holderAddress,
      txHash: existing.mintTxHash,
    };
  }
  const wallet = await prisma.wallet.findFirst({
    where: { userId, provisioner: 'dcw', chainId: ARC_TESTNET_CHAIN_ID },
    select: { address: true, circleWalletId: true },
  });
  if (!wallet) {
    throw new Error(
      `Cannot mint user identity for user ${userId} — no DCW Wallet on ARC-TESTNET. Provision the wallet first via ensureTravelerWallet.`
    );
  }
  if (!wallet.circleWalletId) {
    throw new Error(
      `Cannot mint user identity for user ${userId} — DCW Wallet has no circleWalletId (UUID). Re-run ensureTravelerWallet.`
    );
  }

  const holderAddress = wallet.address.toLowerCase();
  const metadataUri = metadataUriFor('user', userId);

  return mintAndPersist({
    kind: 'user',
    tenantId: null,
    userId,
    holderAddress,
    walletUuid: wallet.circleWalletId,
    metadataUri,
    existingId: existing?.id ?? null,
  });
}

/**
 * Shared mint-and-persist path for both org and user provisioning. Inserts
 * (or reuses) a `pending` row, calls `registerAgent`, and updates the
 * row with the assigned `agentId` + `mintTxHash`. On Circle exception
 * the row stays `pending` and `attemptCount`/`lastError` are bumped so
 * the sweeper can decide when to give up.
 */
async function mintAndPersist(args: {
  kind: 'org' | 'user';
  tenantId: string | null;
  userId: string | null;
  holderAddress: string;
  /**
   * Circle DCW wallet UUID (e.g. `4cbcd349-…`). Routed into Circle's
   * `walletId` field on the contract execution. NOT the same as
   * `holderAddress` — that's the on-chain 0x address that becomes the
   * agent NFT owner.
   */
  walletUuid: string;
  metadataUri: string;
  existingId: string | null;
}): Promise<ProvisionIdentityResult> {
  // Upsert the pending row first so a crash mid-mint can be reasoned
  // about. The (kind, tenantId) / (kind, userId) UNIQUE constraints
  // prevent concurrent provisioners from racing — the second insert
  // throws and the loser falls through to the existing row on retry.
  const pending = args.existingId
    ? await prisma.onchainIdentity.update({
        where: { id: args.existingId },
        data: {
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          status: 'pending',
        },
      })
    : await prisma.onchainIdentity.create({
        data: {
          kind: args.kind,
          tenantId: args.tenantId,
          userId: args.userId,
          chainId: ARC_TESTNET_CHAIN_ID,
          contract: IDENTITY_REGISTRY,
          holderAddress: args.holderAddress,
          metadataUri: args.metadataUri,
          status: 'pending',
          attemptCount: 1,
          lastAttemptAt: new Date(),
        },
      });

  let result: { agentId: bigint; txHash: `0x${string}` };
  try {
    result = await registerAgent({
      ownerWalletAddress: args.walletUuid,
      ownerAddress: args.holderAddress as Address,
      metadataURI: args.metadataUri,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_register_error';
    await prisma.onchainIdentity.update({
      where: { id: pending.id },
      data: { lastError: message.slice(0, 500) },
    });
    // Bubble — the caller (provisioning hook) decides whether to retry
    // synchronously or hand off to the sweeper.
    throw err;
  }

  const minted = await prisma.onchainIdentity.update({
    where: { id: pending.id },
    data: {
      agentId: result.agentId.toString(),
      mintTxHash: result.txHash,
      mintedAt: new Date(),
      status: 'minted',
      lastError: null,
    },
  });

  return {
    status: 'minted',
    identityId: minted.id,
    agentId: minted.agentId,
    contract: minted.contract,
    holderAddress: minted.holderAddress,
    txHash: minted.mintTxHash,
  };
}

/**
 * Cron sweeper entrypoint. Picks `MAX_PER_RUN` pending rows older than
 * `STALE_AFTER_MS` and retries each. Rows that exceed `MAX_ATTEMPTS`
 * flip to `failed`. Returns a small report for the cron route to log.
 */
const SWEEP_MAX_PER_RUN = 50;
const SWEEP_STALE_AFTER_MS = 60 * 1000;

export async function sweepPendingIdentities(): Promise<{
  picked: number;
  backfilled: number;
  minted: number;
  stillPending: number;
  failed: number;
}> {
  const cutoff = new Date(Date.now() - SWEEP_STALE_AFTER_MS);
  const pendingRows = await prisma.onchainIdentity.findMany({
    where: { status: { in: ['pending', 'failed'] }, updatedAt: { lt: cutoff } },
    take: SWEEP_MAX_PER_RUN,
    orderBy: { createdAt: 'asc' },
  });

  const existingOrgTenantIds = new Set(
    (
      await prisma.onchainIdentity.findMany({
        where: { kind: 'org', tenantId: { not: null } },
        select: { tenantId: true },
      })
    )
      .map(row => row.tenantId)
      .filter((tenantId): tenantId is string => Boolean(tenantId))
  );
  const missingOrgTenants = await prisma.tenant.findMany({
    where: {
      id: { notIn: [...existingOrgTenantIds] },
      circleWallets: {
        some: {
          kind: 'treasury',
          chain: 'ARC-TESTNET',
          circleWalletId: { not: null },
        },
      },
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: Math.max(0, SWEEP_MAX_PER_RUN - pendingRows.length),
  });

  const rows = [
    ...pendingRows,
    ...missingOrgTenants.map(tenant => ({
      kind: 'org',
      tenantId: tenant.id,
      userId: null,
      id: `missing-org:${tenant.id}`,
      attemptCount: 0,
    })),
  ];

  let backfilled = 0;
  let minted = 0;
  let stillPending = 0;
  const failed = 0;

  for (const row of rows) {
    const isMissingOrg = row.id.startsWith('missing-org:');
    if (row.attemptCount >= MAX_ATTEMPTS) {
      await prisma.onchainIdentity.update({
        where: { id: row.id },
        data: { status: 'pending', attemptCount: 0, lastError: null },
      });
    }

    try {
      const result =
        row.kind === 'org' && row.tenantId
          ? await ensureOrgIdentity({ tenantId: row.tenantId })
          : row.kind === 'user' && row.userId
            ? await ensureUserIdentity({ userId: row.userId })
            : null;
      if (result?.status === 'minted' || result?.status === 'cached') {
        minted += 1;
        if (isMissingOrg) backfilled += 1;
      } else {
        stillPending += 1;
      }
    } catch (err) {
      console.warn('[provision-identity] identity sweep failed for row', row.id, err);
      stillPending += 1;
    }
  }

  return { picked: rows.length, backfilled, minted, stillPending, failed };
}
