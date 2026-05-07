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
import {
  AGENT_REGISTRY_PROGRAM_ID,
  describeTenantAgentRegistration,
} from '@sendero/metaplex';
import { prisma } from '@sendero/database';
import type { Address } from 'viem';

const ARC_TESTNET_CHAIN_ID = 5042002;
/// Phase 4.x — sentinel chainId for Solana rows. Solana has no
/// numeric chainId; we use 0 as a marker rather than overloading
/// 5042002. The `chain` enum is the authoritative discriminator.
const SOLANA_CHAIN_ID = 0;

/// After this many consecutive failed mint attempts, the sweeper resets
/// the row back to a fresh pending attempt. 12 attempts × 5min cron =
/// ~1 hour before it starts a new retry window.
const MAX_ATTEMPTS = 12;

/// Stable, public URL the contract stores via tokenURI(). The page is
/// served by `apps/app/app/agents/[kind]/[id]/metadata.json` and
/// returns ERC-8004 agent metadata JSON. URL is keyed on the Sendero
/// id (tenantId/userId), not the on-chain agentId, so it survives any
/// future re-mint without breaking the on-chain pointer.
function metadataUriFor(kind: 'org' | 'user', subjectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? '';
  if (!base) {
    throw new Error('NEXT_PUBLIC_APP_URL not set — cannot build identity metadata URI');
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
 * Provision an ERC-8004 identity for an organization. The org's treasury
 * `CircleWallet` (kind='treasury', chain='ARC-TESTNET') becomes the agent
 * NFT owner. Re-running after a successful mint returns the cached row
 * with `status='cached'`.
 *
 * Returns `status='pending'` when the wallet exists but the on-chain
 * mint hasn't completed yet — the sweeper will retry. Throws on
 * preconditions (no treasury wallet, no APP URL).
 */
export async function ensureOrgIdentity(args: {
  tenantId: string;
}): Promise<ProvisionIdentityResult> {
  const { tenantId } = args;

  // Phase 4.x — read tenant.primaryChain to decide which registry
  // to register against. Arc → ERC-8004 IdentityRegistry (existing
  // path). Sol → Metaplex Agent Registry (intent-only in v1; real
  // submit lands when the @metaplex-foundation/mpl-agent-identity
  // SDK pins to a stable release).
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { primaryChain: true, displayName: true },
  });
  if (!tenant) {
    throw new Error(`Cannot mint org identity — no Tenant row for id ${tenantId}`);
  }
  if (tenant.primaryChain === 'sol') {
    return ensureOrgIdentitySolanaIntent({
      tenantId,
      displayName: tenant.displayName ?? `Tenant ${tenantId}`,
    });
  }

  const existing = await prisma.onchainIdentity.findFirst({
    where: { kind: 'org', tenantId, chain: 'arc' },
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
 * Phase 4.x.y — Solana org identity. Writes an `OnchainIdentity` row
 * with `chain='sol'`, `status='intent'`, and the tenant's REAL
 * just-provisioned Solana DCW treasury as `holderAddress`.
 *
 * Resolution chain:
 *   1. CircleWallet (kind='treasury', chain='SOL-DEVNET' | 'SOL') —
 *      the per-tenant Circle DCW EOA programmatically created via
 *      `provisionTenantSolanaTreasury` in the Clerk webhook.
 *   2. Throws if no Solana treasury exists yet — caller must
 *      provision the wallet first (mirrors the Arc throw shape).
 *
 * `status='intent'` is intentional. The on-chain Agent Registry
 * submit via @metaplex-foundation/mpl-agent-identity lands in
 * Phase 4.x.y.z once that SDK pins to a stable release. Intent
 * rows let the cross-chain reputation mirror (Phase 5) know the
 * tenant has a real Solana holder and is awaiting registry submit.
 *
 * Re-running after the row exists returns the cached row with
 * `status='pending'` (mirrors the Arc cached-but-not-minted shape).
 */
async function ensureOrgIdentitySolanaIntent(args: {
  tenantId: string;
  displayName: string;
}): Promise<ProvisionIdentityResult> {
  const existing = await prisma.onchainIdentity.findFirst({
    where: { kind: 'org', tenantId: args.tenantId, chain: 'sol' },
  });
  if (existing) {
    return {
      status: existing.status === 'minted' ? 'cached' : 'pending',
      identityId: existing.id,
      agentId: existing.agentId,
      contract: existing.contract,
      holderAddress: existing.holderAddress,
      txHash: existing.mintTxHash,
    };
  }

  // Resolve the real holder — the tenant's Solana DCW treasury.
  const treasury = await prisma.circleWallet.findFirst({
    where: {
      tenantId: args.tenantId,
      kind: 'treasury',
      chain: { in: ['SOL-DEVNET', 'SOL'] },
    },
    select: { address: true, chain: true },
  });
  if (!treasury) {
    throw new Error(
      `Cannot mint sol org identity for tenant ${args.tenantId} — no treasury CircleWallet on SOL-DEVNET. Provision the wallet first via provisionTenantSolanaTreasury.`
    );
  }

  const metadataUri = metadataUriFor('org', args.tenantId);

  // Validates inputs + returns a structured intent descriptor. The
  // describe... helper now sees the real treasury pubkey and
  // validates it as base58 — catches a corrupt CircleWallet row at
  // identity-write time rather than at on-chain submit time.
  const intent = describeTenantAgentRegistration({
    tenantId: args.tenantId,
    treasuryPubkey: treasury.address,
    name: args.displayName,
    identityUri: metadataUri,
  });

  const row = await prisma.onchainIdentity.create({
    data: {
      kind: 'org',
      tenantId: args.tenantId,
      userId: null,
      chain: 'sol',
      chainId: SOLANA_CHAIN_ID,
      contract: AGENT_REGISTRY_PROGRAM_ID,
      holderAddress: treasury.address,
      metadataUri: intent.identityUri,
      status: 'intent',
      attemptCount: 0,
      lastAttemptAt: new Date(),
    },
  });

  return {
    status: 'pending',
    identityId: row.id,
    agentId: null,
    contract: row.contract,
    holderAddress: row.holderAddress,
    txHash: null,
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
