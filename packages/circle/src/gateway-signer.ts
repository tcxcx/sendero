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
import bs58 from 'bs58';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { Hex, PrivateKeyAccount } from 'viem';

/**
 * Phase 5 P5.3 — caller context for the audit trail. Routes / crons /
 * webhooks / tools pass this so WalletAccessLog rows record who touched
 * the key on every cache miss. Cache hits don't decrypt and don't log.
 *
 * Surface = where the call came from. userId = Clerk userId when
 * available (route, sometimes tool). context = free-form trace data
 * (route path, cron name, notification.id) for forensics.
 *
 * Backwards-compat: callers that don't pass `caller` log with
 * surface='unknown'. Plumbing it through every call site is Phase 5+
 * follow-up work; the audit row still exists so we can grep by tenant
 * if needed.
 */
export interface GatewaySignerCallerContext {
  surface: 'route' | 'cron' | 'webhook' | 'tool' | 'cli' | 'unknown';
  userId?: string;
  context?: string;
}

export interface GetGatewaySignerOptions {
  caller?: GatewaySignerCallerContext;
}

// ── Types ─────────────────────────────────────────────────────────────

/** Resolved Gateway signer — address + viem account ready to sign. */
export interface TenantGatewaySigner {
  /** Lowercased 0x… EOA address. Stable across calls for the same tenant. */
  address: Hex;
  /** viem account that signs EIP-712 burn intents and EIP-3009 auths. */
  account: PrivateKeyAccount;
  /** Raw private key — server-only, never serialized to client. Used by
   *  App Kit viem adapter (createViemAdapterFromPrivateKey) for swap/send/bridge. */
  privateKey: Hex;
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
const userSignerCache = new Map<string, CacheEntry>();

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

function userCacheGet(userId: string): TenantGatewaySigner | null {
  const entry = userSignerCache.get(userId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    userSignerCache.delete(userId);
    return null;
  }
  return entry.signer;
}

function userCacheSet(userId: string, signer: TenantGatewaySigner): void {
  userSignerCache.set(userId, { signer, expiresAt: Date.now() + SIGNER_CACHE_TTL_MS });
}

/**
 * Drop a tenant's cache entry — call after rotating the row, after
 * a `kekVersion` bump, or in test teardown.
 */
export function invalidateGatewaySignerCache(tenantId: string): void {
  signerCache.delete(tenantId);
}

export function invalidateUserGatewaySignerCache(userId: string): void {
  userSignerCache.delete(userId);
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
export async function getOrCreateGatewaySigner(
  tenantId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantGatewaySigner> {
  if (!tenantId) {
    throw new Error('getOrCreateGatewaySigner: tenantId required');
  }

  const cached = cacheGet(tenantId);
  if (cached) return cached;

  const existing = await prisma.tenantGatewaySigner.findUnique({
    where: { tenantId },
  });

  if (existing) {
    const signer = await decryptSigner({
      contextLabel: `tenant:${tenantId}`,
      contextId: tenantId,
      address: existing.address,
      encryptedPrivateKey: existing.encryptedPrivateKey,
      kekVersion: existing.kekVersion,
      caller: options?.caller,
    });
    cacheSet(tenantId, signer);
    return signer;
  }

  // First-time provisioning — generate, encrypt, persist.
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const lowerAddress = account.address.toLowerCase();
  const { ciphertext, kekVersion } = await encrypt({
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
        const signer = await decryptSigner({
          contextLabel: `tenant:${tenantId}`,
          contextId: tenantId,
          address: winner.address,
          encryptedPrivateKey: winner.encryptedPrivateKey,
          kekVersion: winner.kekVersion,
          caller: options?.caller,
        });
        cacheSet(tenantId, signer);
        return signer;
      }
    }
    throw err;
  }

  // First-time provisioning: write an audit row tagged 'create' so the
  // initial signer's existence is forensic-traceable. Subsequent
  // decrypts log via decryptSigner.
  void writeAuditLog({
    tenantId,
    userId: null,
    kekVersion,
    caller: options?.caller,
    contextSuffix: 'create',
  });

  const signer: TenantGatewaySigner = {
    address: lowerAddress as Hex,
    account,
    privateKey,
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
export async function getGatewaySigner(
  tenantId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantGatewaySigner | null> {
  if (!tenantId) {
    throw new Error('getGatewaySigner: tenantId required');
  }

  const cached = cacheGet(tenantId);
  if (cached) return cached;

  const row = await prisma.tenantGatewaySigner.findUnique({
    where: { tenantId },
  });
  if (!row) return null;

  const signer = await decryptSigner({
    contextLabel: `tenant:${tenantId}`,
    contextId: tenantId,
    address: row.address,
    encryptedPrivateKey: row.encryptedPrivateKey,
    kekVersion: row.kekVersion,
    caller: options?.caller,
  });
  cacheSet(tenantId, signer);
  return signer;
}

/**
 * Per-user variant. Returns the user's Gateway depositor EOA, generating
 * a fresh one on first call. Same shape as the tenant variant; cached
 * separately so a misbehaving user doesn't poison the tenant cache.
 *
 * Idempotent on `userId`. Concurrent first-time calls race on the
 * `prisma.userGatewaySigner.create` unique constraint — the loser
 * catches the constraint error and re-reads.
 */
export async function getOrCreateUserGatewaySigner(
  userId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantGatewaySigner> {
  if (!userId) {
    throw new Error('getOrCreateUserGatewaySigner: userId required');
  }

  const cached = userCacheGet(userId);
  if (cached) return cached;

  const existing = await prisma.userGatewaySigner.findUnique({
    where: { userId },
  });

  if (existing) {
    const signer = await decryptSigner({
      contextLabel: `user:${userId}`,
      contextId: userId,
      address: existing.address,
      encryptedPrivateKey: existing.encryptedPrivateKey,
      kekVersion: existing.kekVersion,
      caller: options?.caller,
    });
    userCacheSet(userId, signer);
    return signer;
  }

  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const lowerAddress = account.address.toLowerCase();
  const { ciphertext, kekVersion } = await encrypt({
    plaintext: privateKey,
    purpose: 'gateway-signer',
    contextId: userId,
  });

  try {
    await prisma.userGatewaySigner.create({
      data: {
        userId,
        address: lowerAddress,
        encryptedPrivateKey: ciphertext,
        kekVersion,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const winner = await prisma.userGatewaySigner.findUnique({
        where: { userId },
      });
      if (winner) {
        const signer = await decryptSigner({
          contextLabel: `user:${userId}`,
          contextId: userId,
          address: winner.address,
          encryptedPrivateKey: winner.encryptedPrivateKey,
          kekVersion: winner.kekVersion,
          caller: options?.caller,
        });
        userCacheSet(userId, signer);
        return signer;
      }
    }
    throw err;
  }

  void writeAuditLog({
    tenantId: null,
    userId,
    kekVersion,
    caller: options?.caller,
    contextSuffix: 'create:user',
  });

  const signer: TenantGatewaySigner = {
    address: lowerAddress as Hex,
    account,
    privateKey,
    kekVersion,
  };
  userCacheSet(userId, signer);
  return signer;
}

/**
 * Read-only variant for the user signer — null if not yet provisioned.
 */
export async function getUserGatewaySigner(
  userId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantGatewaySigner | null> {
  if (!userId) {
    throw new Error('getUserGatewaySigner: userId required');
  }

  const cached = userCacheGet(userId);
  if (cached) return cached;

  const row = await prisma.userGatewaySigner.findUnique({
    where: { userId },
  });
  if (!row) return null;

  const signer = await decryptSigner({
    contextLabel: `user:${userId}`,
    contextId: userId,
    address: row.address,
    encryptedPrivateKey: row.encryptedPrivateKey,
    kekVersion: row.kekVersion,
    caller: options?.caller,
  });
  userCacheSet(userId, signer);
  return signer;
}

// ── Internals ─────────────────────────────────────────────────────────

interface DecryptArgs {
  /** Either tenant:<id> or user:<id> for log lines. */
  contextLabel: string;
  /** Encryption contextId — tenantId or userId. */
  contextId: string;
  address: string;
  encryptedPrivateKey: string;
  kekVersion: number;
  caller?: GatewaySignerCallerContext;
}

/**
 * Decrypt a stored ciphertext, derive the address from the resulting
 * key, and verify it matches the stored address. Mismatch = corruption
 * or KEK error — fail loudly rather than sign with a wrong key.
 *
 * Phase 5: writes a WalletAccessLog row on every successful decrypt
 * (best-effort, fire-and-forget). The decrypt is the cold path —
 * callers that hit the in-memory cache (cacheGet) skip this function
 * entirely, so audit volume is bounded by cold starts × tenant ops.
 */
async function decryptSigner(args: DecryptArgs): Promise<TenantGatewaySigner> {
  const plaintext = await decrypt({
    ciphertext: args.encryptedPrivateKey,
    purpose: 'gateway-signer',
    contextId: args.contextId,
    kekVersion: args.kekVersion,
  });

  const account = privateKeyToAccount(plaintext as Hex);
  if (account.address.toLowerCase() !== args.address.toLowerCase()) {
    throw new Error(
      `Gateway signer key mismatch for ${args.contextLabel}: stored address ` +
        `${args.address} but decrypted key derives ${account.address}. ` +
        `KEK rotation gap or row tamper — refusing to sign with the wrong key.`
    );
  }

  // Audit the decrypt event. Fire-and-forget — don't gate the hot path
  // on the audit DB. Tenant-scoped only for now (WalletAccessLog FK
  // requires tenantId); user-scoped signer decrypts skip the audit row.
  if (args.contextLabel.startsWith('tenant:')) {
    void writeAuditLog({
      tenantId: args.contextId,
      userId: null,
      kekVersion: args.kekVersion,
      caller: args.caller,
      contextSuffix: 'decrypt',
    });
  }

  return {
    address: account.address.toLowerCase() as Hex,
    account,
    privateKey: plaintext as Hex,
    kekVersion: args.kekVersion,
  };
}

/**
 * Best-effort audit log write. Async but never awaited — the caller
 * uses `void writeAuditLog(...)` so a slow / failed write doesn't
 * extend the hot path. On error, log a warning so misconfig is
 * visible but signing still proceeds.
 */
async function writeAuditLog(args: {
  tenantId: string | null;
  /** Reserved for future user-scope audit. Currently no-op when set. */
  userId: string | null;
  kekVersion: number;
  caller: GatewaySignerCallerContext | undefined;
  contextSuffix: string;
}): Promise<void> {
  if (!args.tenantId) {
    // User-scope audit not yet supported by WalletAccessLog (FK requires
    // tenantId). The decrypt is logged via console.warn at the call site
    // if it fails; routine successes go unrecorded for now.
    return;
  }
  try {
    const callerSurface = args.caller?.surface ?? 'unknown';
    const callerUserId = args.caller?.userId ?? args.userId ?? null;
    // Truncate context to ~200 chars so adversarial / accidental long
    // strings don't bloat the table.
    const callerContext = args.caller?.context
      ? `${args.contextSuffix}:${args.caller.context}`.slice(0, 200)
      : args.contextSuffix;
    await prisma.walletAccessLog.create({
      data: {
        tenantId: args.tenantId,
        callerSurface,
        callerUserId,
        kekVersion: args.kekVersion,
        context: callerContext,
      },
    });
  } catch (err) {
    console.warn('[gateway-signer] audit log write failed (non-fatal)', {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
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

// ── Solana self-custody signer ────────────────────────────────────────

/**
 * Per-tenant self-custody Solana keypair used as the Gateway depositor +
 * burn-intent signer on Solana.
 *
 * Why self-custody on Sol when EVM is also self-custody, and Circle DCWs
 * exist for everything else? Because Circle's Wallets API only exposes
 * `signTransactions` for Sol DCWs — not raw `signMessage`/`signMessages`/
 * `secretKey`. App Kit's `gateway.v1.signBurnIntents` step signs raw
 * burn-intent bytes off-chain, hits the Sol adapter, and bails with
 * "Signer does not support any known signing method". A `@solana/kit`
 * `KeyPairSigner` derived from a stored private key exposes
 * `signMessages` natively, which App Kit's `signSolanaIntentGroup`
 * happily consumes.
 *
 * Trade-offs: lose Circle custody for Sol gateway funds (matches the EVM
 * self-custody pattern we already run for `TenantGatewaySigner`) and
 * lose Circle Gas Station on Sol (never available there — we already
 * JIT-drip via `ensureSolanaGas` from the platform hot wallet).
 */
export interface TenantSolanaGatewaySigner {
  /** Base58 Solana pubkey. Stable across calls for the same tenant. */
  address: string;
  /** Base58 64-byte secret key — feeds `createSolanaKitAdapterFromPrivateKey`. */
  privateKey: string;
  /** KEK version the underlying ciphertext was decrypted under. */
  kekVersion: number;
}

interface SolanaCacheEntry {
  signer: TenantSolanaGatewaySigner;
  expiresAt: number;
}

const solanaSignerCache = new Map<string, SolanaCacheEntry>();

function solanaCacheGet(tenantId: string): TenantSolanaGatewaySigner | null {
  const entry = solanaSignerCache.get(tenantId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    solanaSignerCache.delete(tenantId);
    return null;
  }
  return entry.signer;
}

function solanaCacheSet(tenantId: string, signer: TenantSolanaGatewaySigner): void {
  solanaSignerCache.set(tenantId, { signer, expiresAt: Date.now() + SIGNER_CACHE_TTL_MS });
}

export function invalidateTenantSolanaSignerCache(tenantId: string): void {
  solanaSignerCache.delete(tenantId);
}

/**
 * Generate a fresh Solana keypair via `@solana/web3.js`, return both the
 * base58 pubkey and the base58 secret key. Done in a helper so the import
 * stays lazy (web3.js is heavy and only the cold path needs it).
 */
async function generateSolanaKeypair(): Promise<{ address: string; privateKey: string }> {
  const { Keypair } = await import('@solana/web3.js');
  const kp = Keypair.generate();
  return {
    address: kp.publicKey.toBase58(),
    privateKey: bs58.encode(kp.secretKey),
  };
}

/**
 * Verify a decrypted base58 secret key derives the stored pubkey.
 * Fails loudly on mismatch — KEK drift or row tamper.
 */
async function deriveSolanaAddress(privateKeyBase58: string): Promise<string> {
  const { Keypair } = await import('@solana/web3.js');
  const secret = bs58.decode(privateKeyBase58);
  if (secret.length !== 64) {
    throw new Error(
      `Solana secret key length mismatch — expected 64 bytes, got ${secret.length}`
    );
  }
  const kp = Keypair.fromSecretKey(secret);
  return kp.publicKey.toBase58();
}

interface DecryptSolanaArgs {
  tenantId: string;
  address: string;
  encryptedPrivateKey: string;
  kekVersion: number;
  caller?: GatewaySignerCallerContext;
}

async function decryptSolanaSigner(
  args: DecryptSolanaArgs
): Promise<TenantSolanaGatewaySigner> {
  const plaintext = await decrypt({
    ciphertext: args.encryptedPrivateKey,
    purpose: 'gateway-signer',
    contextId: `sol:${args.tenantId}`,
    kekVersion: args.kekVersion,
  });
  const derivedAddress = await deriveSolanaAddress(plaintext);
  if (derivedAddress !== args.address) {
    throw new Error(
      `Solana gateway signer key mismatch for tenant:${args.tenantId}: stored address ` +
        `${args.address} but decrypted key derives ${derivedAddress}. ` +
        `KEK rotation gap or row tamper — refusing to sign with the wrong key.`
    );
  }
  void writeAuditLog({
    tenantId: args.tenantId,
    userId: null,
    kekVersion: args.kekVersion,
    caller: args.caller,
    contextSuffix: 'decrypt:solana',
  });
  return {
    address: args.address,
    privateKey: plaintext,
    kekVersion: args.kekVersion,
  };
}

/**
 * Returns the tenant's Solana Gateway keypair, generating a fresh one
 * on first call. Idempotent on `tenantId`; concurrent first-time calls
 * race on the unique constraint and the loser re-reads.
 */
export async function getOrCreateTenantSolanaSigner(
  tenantId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantSolanaGatewaySigner> {
  if (!tenantId) {
    throw new Error('getOrCreateTenantSolanaSigner: tenantId required');
  }

  const cached = solanaCacheGet(tenantId);
  if (cached) return cached;

  const existing = await prisma.tenantSolanaGatewaySigner.findUnique({
    where: { tenantId },
  });
  if (existing) {
    const signer = await decryptSolanaSigner({
      tenantId,
      address: existing.address,
      encryptedPrivateKey: existing.encryptedPrivateKey,
      kekVersion: existing.kekVersion,
      caller: options?.caller,
    });
    solanaCacheSet(tenantId, signer);
    return signer;
  }

  const { address, privateKey } = await generateSolanaKeypair();
  const { ciphertext, kekVersion } = await encrypt({
    plaintext: privateKey,
    purpose: 'gateway-signer',
    contextId: `sol:${tenantId}`,
  });

  try {
    await prisma.tenantSolanaGatewaySigner.create({
      data: {
        tenantId,
        address,
        encryptedPrivateKey: ciphertext,
        kekVersion,
      },
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      const winner = await prisma.tenantSolanaGatewaySigner.findUnique({
        where: { tenantId },
      });
      if (winner) {
        const signer = await decryptSolanaSigner({
          tenantId,
          address: winner.address,
          encryptedPrivateKey: winner.encryptedPrivateKey,
          kekVersion: winner.kekVersion,
          caller: options?.caller,
        });
        solanaCacheSet(tenantId, signer);
        return signer;
      }
    }
    throw err;
  }

  void writeAuditLog({
    tenantId,
    userId: null,
    kekVersion,
    caller: options?.caller,
    contextSuffix: 'create:solana',
  });

  const signer: TenantSolanaGatewaySigner = { address, privateKey, kekVersion };
  solanaCacheSet(tenantId, signer);
  return signer;
}

/**
 * Read-only variant — null if the Sol signer has not been provisioned
 * yet. Use in code paths that should fail closed (e.g. balance reads
 * before any Sol op has run).
 */
export async function getTenantSolanaSigner(
  tenantId: string,
  options?: GetGatewaySignerOptions
): Promise<TenantSolanaGatewaySigner | null> {
  if (!tenantId) {
    throw new Error('getTenantSolanaSigner: tenantId required');
  }
  const cached = solanaCacheGet(tenantId);
  if (cached) return cached;
  const row = await prisma.tenantSolanaGatewaySigner.findUnique({
    where: { tenantId },
  });
  if (!row) return null;
  const signer = await decryptSolanaSigner({
    tenantId,
    address: row.address,
    encryptedPrivateKey: row.encryptedPrivateKey,
    kekVersion: row.kekVersion,
    caller: options?.caller,
  });
  solanaCacheSet(tenantId, signer);
  return signer;
}
