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
 * Load a versioned KEK from the env. Phase 1: `SENDERO_KEK` (always v1)
 * + `SENDERO_KEK_V2`, `SENDERO_KEK_V3`, … for rotation. Phase 5 swaps
 * this for a KMS-backed implementation that returns decryption oracles
 * instead of raw KEK bytes (callers will use the same `deriveDek()` API
 * — only this loader changes).
 */
function loadKek(version: number): Buffer {
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

// ── DEK derivation ────────────────────────────────────────────────────

/**
 * HMAC-SHA256-based per-context DEK derivation. Skips the HKDF "extract"
 * step because the KEK is already high-entropy — the "expand" step alone
 * is sufficient and matches the pattern in @sendero/vault/envelope.
 *
 * Deterministic: same KEK + same purpose + same contextId + same version
 * → same DEK. That's what makes ciphertexts portable across processes.
 */
export function deriveDek(
  purpose: EncryptionPurpose,
  contextId: string,
  kekVersion = CURRENT_KEK_VERSION
): Buffer {
  if (!contextId) {
    throw new Error('deriveDek: contextId required');
  }
  const kek = loadKek(kekVersion);
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
 */
export function encrypt(args: EncryptArgs): { ciphertext: string; kekVersion: number } {
  const kekVersion = args.kekVersion ?? CURRENT_KEK_VERSION;
  const dek = deriveDek(args.purpose, args.contextId, kekVersion);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', dek, iv);
  const encrypted = Buffer.concat([cipher.update(args.plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([iv, encrypted, tag]);
  return { ciphertext: envelope.toString('base64'), kekVersion };
}

/**
 * Decrypt a base64 envelope back to plaintext. Throws if the auth tag
 * fails (tampered ciphertext, wrong contextId, wrong purpose, wrong
 * KEK version — all surface as the same `Authentication failed` error
 * to avoid leaking which input was wrong).
 */
export function decrypt(args: DecryptArgs): string {
  const dek = deriveDek(args.purpose, args.contextId, args.kekVersion);
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
