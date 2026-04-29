/**
 * Per-tenant Gateway signer — the keystone of Phase 1.
 *
 * Provides each tenant a self-custody EOA that signs Circle Gateway
 * burn intents and deposit authorizations. Replaces the platform-level
 * `TREASURY_PRIVATE_KEY` for Gateway flows specifically; everything
 * else (nanopay batch, App Kit, settle_split outside Gateway routing)
 * keeps its existing signing path.
 *
 * ── Why per-tenant EOAs instead of Circle DCW ────────────────────────
 *
 * Circle's `/v1/w3s/developer/sign/typedData` forces `chainId` into the
 * EIP-712 domain, but Circle Gateway's on-chain DOMAIN_SEPARATOR has
 * NO `chainId`. Any DCW-signed burn intent therefore recovers to the
 * wrong address and Gateway's `/transfer` rejects with "recovered
 * signer does not match sourceSigner". A throwaway viem EOA (no
 * chainId in domain) signs cleanly. desk-v1 verified this live
 * 2026-04-18.
 *
 * Per-tenant EOAs also bound the custody blast radius — a leaked KEK
 * for one tenant doesn't compromise others, and the Gateway-only scope
 * means the signer can't be coerced into payroll, App Kit, or any other
 * non-Gateway operation.
 *
 * ── Hot-path caching ─────────────────────────────────────────────────
 *
 * Decryption hits node:crypto for an HKDF derive + AES-256-GCM round
 * trip. Cheap, but on a busy Vercel function we'd hit it once per
 * Gateway request per tenant. The `signerCache` keeps decrypted
 * accounts in-memory for `SIGNER_CACHE_TTL_MS` (60s default) so a
 * burst of transfers in the same Vercel instance reuses the account.
 *
 * The cache is process-local — Vercel cold starts re-decrypt, which is
 * fine. Cache eviction is best-effort: a setTimeout drops the entry
 * after the TTL but we don't ride a precise clock; if the process
 * stays warm forever, entries stay forever (intentional for hot paths).
 *
 * Phase 5 will switch the env-loaded KEK for a Google Cloud KMS oracle.
 * The cache TTL gets more important then because each cache miss costs
 * a network round trip.
 */

import { prisma } from '@sendero/database';
import { decrypt, encrypt } from '@sendero/encryption';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex, PrivateKeyAccount } from 'viem';

// ── Types ─────────────────────────────────────────────────────────────

/** Resolved Gateway signer — address + viem account ready to sign. */
export interface TenantGatewaySigner {
  /** Lowercased 0x… EOA address. Stable across calls for the same tenant. */
  address: Hex;
  /** viem account that signs EIP-712 burn intents and EIP-3009 auths. */
  account: PrivateKeyAccount;
  /** KEK version the underlying ciphertext was decrypted under. Useful
   *  for the rotation path that re-encrypts to the latest KEK on read. */
  kekVersion: number;
}

// ── Cache ─────────────────────────────────────────────────────────────

interface CacheEntry {
  signer: TenantGatewaySigner;
  expiresAt: number;
}

const SIGNER_CACHE_TTL_MS = 60_000;
const signerCache = new Map<string, CacheEntry>();

function cacheGet(tenantId: string): TenantGatewaySigner | null {
  const entry = signerCache.get(tenantId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    signerCache.delete(tenantId);
    return null;
  }
  return entry.signer;
}

function cacheSet(tenantId: string, signer: TenantGatewaySigner): void {
  signerCache.set(tenantId, { signer, expiresAt: Date.now() + SIGNER_CACHE_TTL_MS });
}

/**
 * Drop a tenant's cache entry — call after rotating the row, after
 * a `kekVersion` bump, or in test teardown.
 */
export function invalidateGatewaySignerCache(tenantId: string): void {
  signerCache.delete(tenantId);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Returns the tenant's Gateway EOA, generating a fresh one on first call.
 *
 * Idempotent on `tenantId`. Concurrent first-time calls race on the
 * `prisma.tenantGatewaySigner.create` unique constraint — the loser
 * catches the constraint error and re-reads. Either way both callers
 * get the same address.
 *
 * Throws if:
 *   - Tenant does not exist (foreign-key violation surfaces).
 *   - Decryption fails (corrupted ciphertext, KEK rotation gap, or
 *     KEK env missing).
 *   - Decrypted key derives a different address than the one stored
 *     (tampering or KEK mismatch).
 */
export async function getOrCreateGatewaySigner(tenantId: string): Promise<TenantGatewaySigner> {
  if (!tenantId) {
    throw new Error('getOrCreateGatewaySigner: tenantId required');
  }

  const cached = cacheGet(tenantId);
  if (cached) return cached;

  const existing = await prisma.tenantGatewaySigner.findUnique({
    where: { tenantId },
  });

  if (existing) {
    const signer = decryptSigner({
      tenantId,
      address: existing.address,
      encryptedPrivateKey: existing.encryptedPrivateKey,
      kekVersion: existing.kekVersion,
    });
    cacheSet(tenantId, signer);
    return signer;
  }

  // First-time provisioning — generate, encrypt, persist.
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const lowerAddress = account.address.toLowerCase();
  const { ciphertext, kekVersion } = encrypt({
    plaintext: privateKey,
    purpose: 'gateway-signer',
    contextId: tenantId,
  });

  try {
    await prisma.tenantGatewaySigner.create({
      data: {
        tenantId,
        address: lowerAddress,
        encryptedPrivateKey: ciphertext,
        kekVersion,
      },
    });
  } catch (err) {
    // Concurrent provisioning race — another caller won. Re-read and
    // return their result. Any other error is fatal and bubbles up.
    if (isUniqueConstraintError(err)) {
      const winner = await prisma.tenantGatewaySigner.findUnique({
        where: { tenantId },
      });
      if (winner) {
        const signer = decryptSigner({
          tenantId,
          address: winner.address,
          encryptedPrivateKey: winner.encryptedPrivateKey,
          kekVersion: winner.kekVersion,
        });
        cacheSet(tenantId, signer);
        return signer;
      }
    }
    throw err;
  }

  const signer: TenantGatewaySigner = {
    address: lowerAddress as Hex,
    account,
    kekVersion,
  };
  cacheSet(tenantId, signer);
  return signer;
}

/**
 * Read-only variant — returns null if no signer exists yet. Use this
 * in routes that should fail closed (e.g. balance lookups before
 * provisioning has run) instead of provisioning on read.
 */
export async function getGatewaySigner(tenantId: string): Promise<TenantGatewaySigner | null> {
  if (!tenantId) {
    throw new Error('getGatewaySigner: tenantId required');
  }

  const cached = cacheGet(tenantId);
  if (cached) return cached;

  const row = await prisma.tenantGatewaySigner.findUnique({
    where: { tenantId },
  });
  if (!row) return null;

  const signer = decryptSigner({
    tenantId,
    address: row.address,
    encryptedPrivateKey: row.encryptedPrivateKey,
    kekVersion: row.kekVersion,
  });
  cacheSet(tenantId, signer);
  return signer;
}

// ── Internals ─────────────────────────────────────────────────────────

interface DecryptArgs {
  tenantId: string;
  address: string;
  encryptedPrivateKey: string;
  kekVersion: number;
}

/**
 * Decrypt a stored ciphertext, derive the address from the resulting
 * key, and verify it matches the stored address. Mismatch = corruption
 * or KEK error — fail loudly rather than sign with a wrong key.
 */
function decryptSigner(args: DecryptArgs): TenantGatewaySigner {
  const plaintext = decrypt({
    ciphertext: args.encryptedPrivateKey,
    purpose: 'gateway-signer',
    contextId: args.tenantId,
    kekVersion: args.kekVersion,
  });

  const account = privateKeyToAccount(plaintext as Hex);
  if (account.address.toLowerCase() !== args.address.toLowerCase()) {
    throw new Error(
      `Gateway signer key mismatch for tenant ${args.tenantId}: stored address ` +
        `${args.address} but decrypted key derives ${account.address}. ` +
        `KEK rotation gap or row tamper — refusing to sign with the wrong key.`
    );
  }

  return {
    address: account.address.toLowerCase() as Hex,
    account,
    kekVersion: args.kekVersion,
  };
}

/**
 * Best-effort detection for Prisma's P2002 (unique constraint) error
 * without hard-coupling to the Prisma error class shape.
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown };
  return e.code === 'P2002';
}
