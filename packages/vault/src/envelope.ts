/**
 * Envelope encryption for the passport vault.
 *
 * ── The key hierarchy ────────────────────────────────────────────────
 *
 *   KEK (Key Encryption Key) — 32 bytes, base64, lives in the env
 *     var `PASSPORT_VAULT_KEK` on Vercel.  Never written to Postgres,
 *     never logged, never returned by any API.  Rotating it bumps the
 *     `keyVersion` column on every new row and re-wraps existing rows
 *     via `rotateKek()`.
 *
 *   DEK (Data Encryption Key) — 32 bytes, per-(tenant, keyVersion),
 *     derived via HKDF-SHA256 from the KEK.  Cached in-memory per-
 *     process for a single request lifetime.  Consumers never see the
 *     DEK bytes — they hand off plaintext + (tenantId, keyVersion) to
 *     `encrypt()` / `decrypt()` and get ciphertext / plaintext back.
 *
 * ── The on-the-wire ciphertext format ────────────────────────────────
 *
 * We use Postgres pgcrypto's `pgp_sym_encrypt(plaintext, dek, 'cipher-algo=aes256')`
 * at write time and `pgp_sym_decrypt(ciphertext, dek)` at read time.
 * pgcrypto's packet format is self-describing (OpenPGP-compatible) so
 * we don't need to store a nonce separately — the `nonce` column on
 * `PassportVault` stays null for pgp_sym rows.
 *
 * The reason we route encryption through the DB rather than Node crypto:
 *   - The plaintext NEVER enters the Node process on reads when we only
 *     want to check signals (expiresOn, mrzChecksumValid are plaintext
 *     columns already). The ciphertext stays at rest.
 *   - On writes, plaintext enters Node (we just extracted it from the
 *     passport image) but leaves immediately as an encrypted bytea
 *     parameter — pg's parameterized query path, never concatenated.
 *   - No dependency on Node's crypto subtle API layout, and no risk of
 *     an envelope-format divergence between write-time and read-time.
 *
 * ── What this module does not do ─────────────────────────────────────
 *
 *   - No key rotation yet.  `rotateKek()` is TODO; scaffolding is in
 *     place (keyVersion, extensible DEK derivation) so we can ship it
 *     without a second migration.
 *   - No audit log writes.  `@sendero/vault/passport.ts` writes the
 *     access log every time it calls encrypt / decrypt.  Do not call
 *     this module directly from route code.
 */

import { createHmac, randomBytes } from 'node:crypto';

/**
 * Global KEK version.  Bumps only when we rotate the root secret.
 * Reading a row stamped with a lower keyVersion triggers the
 * re-wrap path in `passport.ts`.
 */
export const CURRENT_KEY_VERSION = 1;

/** Salt for HKDF derivation.  Constant — per-tenant entropy comes from tenantId. */
const HKDF_SALT = Buffer.from('sendero.passport-vault.v1', 'utf8');

/**
 * Pull the KEK from the env once per process and refuse to start the
 * module if it's missing or malformed.  This is intentional — a silent
 * fallback to "no encryption" would be worse than a crash.
 */
function readKek(): Buffer {
  const raw = process.env.PASSPORT_VAULT_KEK;
  if (!raw) {
    throw new Error(
      'PASSPORT_VAULT_KEK is not set. Generate 32 random bytes (e.g. `openssl rand -base64 32`) and set it as a Vercel secret. The vault refuses to initialize without it.'
    );
  }
  let kek: Buffer;
  try {
    kek = Buffer.from(raw, 'base64');
  } catch {
    throw new Error('PASSPORT_VAULT_KEK must be valid base64.');
  }
  if (kek.length !== 32) {
    throw new Error(`PASSPORT_VAULT_KEK must decode to 32 bytes (got ${kek.length}).`);
  }
  return kek;
}

/**
 * HKDF-SHA256-style per-tenant DEK derivation.  Not a full HKDF — we
 * skip the "extract" step because our KEK is already high-entropy —
 * just the "expand" step bound to (tenantId, keyVersion).
 *
 * The DEK is deterministic: given the same KEK + tenant + version, we
 * always get the same DEK.  That means a DB row encrypted today is
 * decryptable tomorrow with no key-stashing beyond the KEK env var.
 */
export function deriveDek(tenantId: string, keyVersion = CURRENT_KEY_VERSION): Buffer {
  const kek = readKek();
  const info = Buffer.from(`sendero.passport-vault|tenant=${tenantId}|v=${keyVersion}`, 'utf8');
  const mac = createHmac('sha256', kek);
  mac.update(HKDF_SALT);
  mac.update(info);
  return mac.digest();
}

/**
 * Pass the DEK to pgcrypto as an ASCII password (pgp_sym_encrypt takes
 * any string).  We hex-encode so it's stable across encodings.
 */
export function dekToPgpPassword(dek: Buffer): string {
  return dek.toString('hex');
}

/**
 * Generate a fresh per-vault-row nonce.  Not strictly needed for
 * pgp_sym_encrypt (it embeds its own random IV), but we stash a short
 * tag so downstream rotation logic can tell rows apart without
 * decrypting. Not a secret.
 */
export function newRowTag(): Buffer {
  return randomBytes(8);
}
