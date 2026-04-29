/**
 * @sendero/encryption — authenticated symmetric encryption.
 *
 * AES-256-GCM with HKDF-derived per-context DEKs (data encryption keys)
 * from a single root KEK (key encryption key). Designed for storing
 * sensitive material (private keys, secrets) at rest in Postgres while
 * letting the server process work with plaintext in memory at hot-path
 * time.
 *
 * ── Key hierarchy ────────────────────────────────────────────────────
 *
 *   KEK — 32 bytes, base64. Phase 1: loaded from `SENDERO_KEK` env on
 *     Vercel. Phase 5: backed by Google Cloud KMS via `Encrypt`/`Decrypt`
 *     RPCs (the `KEK_PROVIDER` interface lets us swap without touching
 *     callers).
 *
 *   DEK — 32 bytes, derived via HMAC-SHA256(KEK, "context|version") for
 *     each (purpose, version, contextId) tuple. Stateless — given the
 *     same KEK + same context inputs, we always get the same DEK. So a
 *     ciphertext written today decrypts tomorrow with zero key-stashing
 *     beyond the KEK.
 *
 * ── Wire format ──────────────────────────────────────────────────────
 *
 *   `<base64(iv:12 || ciphertext || tag:16)>`
 *
 *   Single base64 string per encrypted payload. The IV is randomly
 *   generated per encryption and prepended; the GCM auth tag is appended.
 *   No external metadata — the caller stores `kekVersion` separately on
 *   the row so rotation works.
 *
 * ── Why not @sendero/vault ───────────────────────────────────────────
 *
 *   `@sendero/vault` routes encryption through pgcrypto (`pgp_sym_encrypt`)
 *   so plaintext never enters Node on reads — that's correct for passport
 *   data which is touched once per check-in. Gateway signers need
 *   plaintext in Node every transfer (viem signs with the raw key). AES-256-GCM
 *   in-process is the right primitive here.
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────

/** Latest KEK version — bumped on rotation. Persisted on rows so old
 *  ciphertexts decrypt under their own version. */
export const CURRENT_KEK_VERSION = 1;

/**
 * A namespace for a class of secrets — keeps DEKs from one purpose
 * (Gateway signers) cryptographically isolated from another (e.g. future
 * Slack OAuth refresh tokens).
 */
export type EncryptionPurpose = 'gateway-signer' | 'slack-oauth' | 'whatsapp-creds';

export interface EncryptArgs {
  /** Plaintext to encrypt. UTF-8 string for keys/secrets. */
  plaintext: string;
  /** What kind of secret this is — namespaces the DEK derivation. */
  purpose: EncryptionPurpose;
  /** Identifier that scopes the DEK (e.g. tenantId). Required so two
   *  tenants with the same purpose get different DEKs. */
  contextId: string;
  /** Optional explicit KEK version — defaults to the latest. */
  kekVersion?: number;
}

export interface DecryptArgs {
  /** Base64 ciphertext envelope from `encrypt()`. */
  ciphertext: string;
  /** Must match the purpose used at encrypt time. */
  purpose: EncryptionPurpose;
  /** Must match the contextId used at encrypt time. */
  contextId: string;
  /** KEK version the row was encrypted under (stored separately). */
  kekVersion: number;
}

// ── Constants ─────────────────────────────────────────────────────────

const IV_LEN = 12; // GCM standard
const TAG_LEN = 16; // GCM auth tag
const KEY_LEN = 32; // AES-256
const HKDF_SALT = Buffer.from('sendero.encryption.v1', 'utf8');

// ── KEK loading ───────────────────────────────────────────────────────

/**
 * Process-scoped KEK cache. Both env-mode and KMS-mode populate this.
 * Vercel cold starts re-decrypt; warm functions reuse the cached KEK.
 *
 * For KMS mode this matters more — decrypting via Google Cloud KMS is
 * a network round trip (~50-200ms). Without the cache, every signer
 * decrypt would burn one. With it, the cost is paid once per cold start.
 */
const kekCache = new Map<number, Buffer>();

/**
 * Phase 5 P5.2 — KMS-backed KEK with env fallback.
 *
 * Two modes selected by `SENDERO_KEK_PROVIDER` env:
 *
 *   - `'env'` (default): read raw KEK from `SENDERO_KEK` (v1) or
 *     `SENDERO_KEK_V<N>` (rotation). Plaintext base64-encoded 32 bytes.
 *     Dev workflow stays the same — no GCP setup needed locally.
 *
 *   - `'gcp-kms'`: read base64-encoded KMS ciphertext from
 *     `SENDERO_KEK_CIPHERTEXT` (v1) or `SENDERO_KEK_CIPHERTEXT_V<N>`,
 *     decrypt via Google Cloud KMS using the resource path in
 *     `SENDERO_KEK_KMS_RESOURCE`. The plaintext KEK never appears in
 *     env or DB; only KMS ever sees it post-encryption.
 *
 * In both modes the resolved 32-byte KEK is cached per version.
 *
 * Phase 5+ rotation playbook:
 *   1. Generate new KEK (`openssl rand -base64 32`)
 *   2. Encrypt with KMS via `bun run packages/encryption/bin/wrap-kek.ts`
 *      (script lands with the GCP KMS docs in PHASE_5 runbook)
 *   3. Set `SENDERO_KEK_CIPHERTEXT_V<N+1>` on Vercel
 *   4. Bump `CURRENT_KEK_VERSION` in code, deploy
 *   5. Lazy re-encrypt: existing rows re-wrap on next read via the
 *      kekVersion column (handled by callers, not this module)
 */
async function loadKek(version: number): Promise<Buffer> {
  const cached = kekCache.get(version);
  if (cached) return cached;

  const provider = process.env.SENDERO_KEK_PROVIDER ?? 'env';
  const kek = provider === 'gcp-kms' ? await loadKekFromKms(version) : loadKekFromEnv(version);

  kekCache.set(version, kek);
  return kek;
}

function loadKekFromEnv(version: number): Buffer {
  const envKey = version === 1 ? 'SENDERO_KEK' : `SENDERO_KEK_V${version}`;
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(
      `${envKey} is not set. Generate 32 random bytes (\`openssl rand -base64 32\`) ` +
        `and set it on Vercel. The encryption module refuses to operate without it ` +
        `to avoid silent fallback to "no encryption."`
    );
  }
  let kek: Buffer;
  try {
    kek = Buffer.from(raw, 'base64');
  } catch {
    throw new Error(`${envKey} must be valid base64.`);
  }
  if (kek.length !== KEY_LEN) {
    throw new Error(`${envKey} must decode to ${KEY_LEN} bytes (got ${kek.length}).`);
  }
  return kek;
}

/**
 * KMS-backed KEK loader. Fetches the KMS-encrypted ciphertext from env,
 * asks Google Cloud KMS to decrypt, returns the plaintext KEK.
 *
 * Lazy import keeps the @google-cloud/kms SDK out of cold-start cost
 * for env-mode (the default). Only KMS-mode pays the import cost.
 *
 * Auth: standard Google Cloud auth resolution. Sendero already wires
 * GOOGLE_APPLICATION_CREDENTIALS_JSON for Vertex AI; same path applies.
 */
async function loadKekFromKms(version: number): Promise<Buffer> {
  const ciphertextEnv =
    version === 1 ? 'SENDERO_KEK_CIPHERTEXT' : `SENDERO_KEK_CIPHERTEXT_V${version}`;
  const resourceEnv = 'SENDERO_KEK_KMS_RESOURCE';

  const ciphertext = process.env[ciphertextEnv];
  if (!ciphertext) {
    throw new Error(
      `${ciphertextEnv} is not set. SENDERO_KEK_PROVIDER=gcp-kms requires the ` +
        `KMS-encrypted KEK ciphertext (base64). See PHASE_5_PRODUCTION_HARDENING_RUNBOOK.md ` +
        `for the wrap-kek script.`
    );
  }
  const resource = process.env[resourceEnv];
  if (!resource) {
    throw new Error(
      `${resourceEnv} is not set. Format: ` +
        `projects/<project>/locations/<region>/keyRings/<ring>/cryptoKeys/<key>`
    );
  }

  const { KeyManagementServiceClient } = await import('@google-cloud/kms');
  const client = new KeyManagementServiceClient();
  const [response] = await client.decrypt({
    name: resource,
    ciphertext: Buffer.from(ciphertext, 'base64'),
  });

  if (!response.plaintext) {
    throw new Error(`KMS decrypt returned no plaintext for ${ciphertextEnv}`);
  }
  // KMS returns Uint8Array | string; normalize to Buffer.
  const kek =
    typeof response.plaintext === 'string'
      ? Buffer.from(response.plaintext, 'base64')
      : Buffer.from(response.plaintext);

  if (kek.length !== KEY_LEN) {
    throw new Error(
      `KMS-decrypted KEK is ${kek.length} bytes, expected ${KEY_LEN}. ` +
        `The wrapped ciphertext is wrong — re-run the wrap-kek script.`
    );
  }
  return kek;
}

/**
 * Test helper: clear the KEK cache so consecutive tests don't share
 * cached values across env-var swaps. Production code never calls this.
 */
export function _clearKekCache(): void {
  kekCache.clear();
}

// ── DEK derivation ────────────────────────────────────────────────────

/**
 * HMAC-SHA256-based per-context DEK derivation. Skips the HKDF "extract"
 * step because the KEK is already high-entropy — the "expand" step alone
 * is sufficient and matches the pattern in @sendero/vault/envelope.
 *
 * Deterministic: same KEK + same purpose + same contextId + same version
 * → same DEK. That's what makes ciphertexts portable across processes.
 *
 * Async because Phase 5 KMS-mode does a network round-trip on cold
 * start. Cached after first call (per process, per kekVersion) so
 * subsequent calls are sync-fast. Env-mode is sync at the bottom but
 * still wrapped in async for API uniformity.
 */
export async function deriveDek(
  purpose: EncryptionPurpose,
  contextId: string,
  kekVersion = CURRENT_KEK_VERSION
): Promise<Buffer> {
  if (!contextId) {
    throw new Error('deriveDek: contextId required');
  }
  const kek = await loadKek(kekVersion);
  const info = Buffer.from(
    `sendero.encryption|purpose=${purpose}|context=${contextId}|v=${kekVersion}`,
    'utf8'
  );
  const mac = createHmac('sha256', kek);
  mac.update(HKDF_SALT);
  mac.update(info);
  return mac.digest();
}

// ── Encrypt / decrypt ─────────────────────────────────────────────────

/**
 * Encrypt plaintext under a derived DEK. Returns a single base64 string
 * containing `iv || ciphertext || tag`. Caller persists this string +
 * the `kekVersion` value used.
 *
 * Async because the underlying `deriveDek` is async (KMS round-trip on
 * cold start). Cached KEK makes subsequent calls fast.
 */
export async function encrypt(
  args: EncryptArgs
): Promise<{ ciphertext: string; kekVersion: number }> {
  const kekVersion = args.kekVersion ?? CURRENT_KEK_VERSION;
  const dek = await deriveDek(args.purpose, args.contextId, kekVersion);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(args.plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, encrypted, tag]);
  return { ciphertext: envelope.toString('base64'), kekVersion };
}

/**
 * Decrypt a base58 envelope back to plaintext. Throws if the auth tag
 * fails (tampered ciphertext, wrong contextId, wrong purpose, wrong
 * KEK version — all surface as the same `Authentication failed` error
 * to avoid leaking which input was wrong).
 */
export async function decrypt(args: DecryptArgs): Promise<string> {
  const dek = await deriveDek(args.purpose, args.contextId, args.kekVersion);
  let envelope: Buffer;
  try {
    envelope = Buffer.from(args.ciphertext, 'base64');
  } catch {
    throw new Error('decrypt: invalid base64 ciphertext');
  }
  if (envelope.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('decrypt: ciphertext too short');
  }
  const iv = envelope.subarray(0, IV_LEN);
  const tag = envelope.subarray(envelope.length - TAG_LEN);
  const ct = envelope.subarray(IV_LEN, envelope.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', dek, iv);
  decipher.setAuthTag(tag);
  try {
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    // Don't leak which input failed — surface a uniform error.
    throw new Error('decrypt: authentication failed (tampered ciphertext or wrong context)');
  }
}
