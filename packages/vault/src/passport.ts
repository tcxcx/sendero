/**
 * Passport vault — encrypted CRUD + append-only access log.
 *
 * This is the ONLY legal entrypoint for PassportVault rows.  API routes,
 * workflows, and tools import from here; they never touch Prisma's
 * PassportVault client directly.  That contract is how we keep the
 * pgcrypto boundary honest — if a caller starts selecting `ciphertext`
 * without going through this module, encryption is decorative.
 *
 * Writes:
 *   - `upsertPassportVault()` — takes the full IdDocumentExtraction, splits
 *     it into {sanitized signals} + {ciphertext}, encrypts via pgcrypto
 *     pgp_sym_encrypt with a tenant-derived DEK, writes the row in a
 *     single parameterized query.
 *
 * Reads:
 *   - `readVaultSignals()` — plaintext columns only (nationalityIso3,
 *     expiresOn, documentVariant, mrzChecksumValid, extractedBy). Safe
 *     for the LLM.
 *   - `decryptVaultPayload()` — full decrypted JSON. Requires a
 *     non-null `actorRef` + `source` because it writes the access log
 *     row before returning. Call only from traveler-self-view routes
 *     or privileged workflow steps.
 *
 * Every read/write logs to `PassportVaultAccessLog`. Tampering the log
 * tampers the audit trail — we append, never update.
 */

import type { Prisma, PrismaClient } from '@sendero/database';

import { CURRENT_KEY_VERSION, dekToPgpPassword, deriveDek, newRowTag } from './envelope';

/** Document variants we recognize on a vault row. */
export type PassportVaultVariant =
  | 'passport'
  | 'national_id'
  | 'drivers_license'
  | 'residence_permit';

/** Allowed extractor sources. Bumps requires a migration + access-log migration. */
export type PassportVaultExtractor = 'mrz_fast' | 'gemini_zdr' | 'manual';

export interface PassportVaultSignals {
  id: string;
  tenantId: string;
  userId: string;
  documentVariant: PassportVaultVariant;
  nationalityIso3: string | null;
  expiresOn: Date | null;
  mrzChecksumValid: boolean;
  extractedBy: PassportVaultExtractor;
  extractedAt: Date;
  revokedAt: Date | null;
  keyVersion: number;
}

/**
 * The full decrypted payload — what's inside `ciphertext`.  Superset of
 * the OCR IdDocumentExtraction plus intake metadata.  NEVER let this
 * object reach the agent, a log line, or an analytics event.
 */
export interface PassportVaultPayload {
  extraction: unknown; // IdDocumentExtraction from @sendero/ocr — keep loose to avoid circular import
  imageSha256: string;
  filename: string | null;
  uploadedAt: string;
}

/**
 * Actor + source tuple required for every access log entry.  Never
 * accept "unknown" — if you don't know who's reading, don't read.
 */
export interface VaultActor {
  /** clerkUserId for self-service, svc:${keyId} for agents, wf:${id}:${step} for workflows. */
  actorRef: string;
  /** Route or workflow that triggered this read. */
  source: string;
  /** Optional free-form audit context (ip, userAgent, tripId). NEVER PII. */
  context?: Prisma.InputJsonValue;
}

export interface UpsertVaultInput {
  tenantId: string;
  userId: string;
  documentVariant: PassportVaultVariant;
  /** Plaintext payload — split between ciphertext and sanitized columns by this call. */
  payload: PassportVaultPayload;
  /** Sanitized signals to surface on plaintext columns. */
  signals: {
    nationalityIso3: string | null;
    expiresOn: Date | null;
    mrzChecksumValid: boolean;
  };
  extractedBy: PassportVaultExtractor;
  actor: VaultActor;
}

/**
 * Encrypt + upsert a vault row.  Returns sanitized signals only — the
 * caller never sees the encrypted blob round-trip.
 */
export async function upsertPassportVault(
  prisma: PrismaClient,
  input: UpsertVaultInput
): Promise<PassportVaultSignals> {
  const keyVersion = CURRENT_KEY_VERSION;
  const dek = deriveDek(input.tenantId, keyVersion);
  const pgpPassword = dekToPgpPassword(dek);
  const plaintext = JSON.stringify(input.payload);
  const rowTag = newRowTag();

  // We write via $queryRaw because Prisma can't emit pgp_sym_encrypt
  // and we refuse to encrypt in Node (see envelope.ts rationale). The
  // parameterized query keeps the plaintext off the logs.
  const rows = await prisma.$queryRaw<Array<{ id: string; extractedAt: Date }>>`
    INSERT INTO "passport_vault" (
      "id",
      "tenantId",
      "userId",
      "ciphertext",
      "nonce",
      "keyVersion",
      "nationalityIso3",
      "expiresOn",
      "documentVariant",
      "mrzChecksumValid",
      "extractedBy",
      "extractedAt",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'pv_' || encode(gen_random_bytes(12), 'hex'),
      ${input.tenantId},
      ${input.userId},
      pgp_sym_encrypt(${plaintext}::text, ${pgpPassword}::text, 'cipher-algo=aes256, compress-algo=1'),
      ${rowTag},
      ${keyVersion},
      ${input.signals.nationalityIso3},
      ${input.signals.expiresOn},
      ${input.documentVariant},
      ${input.signals.mrzChecksumValid},
      ${input.extractedBy},
      now(),
      now(),
      now()
    )
    ON CONFLICT ("tenantId", "userId", "documentVariant") DO UPDATE SET
      "ciphertext"       = EXCLUDED."ciphertext",
      "nonce"            = EXCLUDED."nonce",
      "keyVersion"       = EXCLUDED."keyVersion",
      "nationalityIso3"  = EXCLUDED."nationalityIso3",
      "expiresOn"        = EXCLUDED."expiresOn",
      "mrzChecksumValid" = EXCLUDED."mrzChecksumValid",
      "extractedBy"      = EXCLUDED."extractedBy",
      "extractedAt"      = now(),
      "updatedAt"        = now(),
      "revokedAt"        = NULL
    RETURNING "id", "extractedAt"
  `;

  const vaultId = rows[0]?.id;
  if (!vaultId) throw new Error('passport vault upsert returned no row');
  const extractedAt = rows[0]?.extractedAt ?? new Date();

  await writeAccessLog(prisma, {
    vaultId,
    action: 'upsert',
    actor: input.actor,
  });

  return {
    id: vaultId,
    tenantId: input.tenantId,
    userId: input.userId,
    documentVariant: input.documentVariant,
    nationalityIso3: input.signals.nationalityIso3,
    expiresOn: input.signals.expiresOn,
    mrzChecksumValid: input.signals.mrzChecksumValid,
    extractedBy: input.extractedBy,
    extractedAt,
    revokedAt: null,
    keyVersion,
  };
}

/**
 * Read the sanitized signals for a (tenant, user, variant) tuple.  LLM-safe.
 * Returns null when no row or the row is revoked.
 */
export async function readVaultSignals(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    userId: string;
    documentVariant?: PassportVaultVariant;
    actor: VaultActor;
  }
): Promise<PassportVaultSignals | null> {
  const row = await prisma.passportVault.findFirst({
    where: {
      tenantId: args.tenantId,
      userId: args.userId,
      ...(args.documentVariant ? { documentVariant: args.documentVariant } : {}),
      revokedAt: null,
    },
    orderBy: { extractedAt: 'desc' },
    select: {
      id: true,
      tenantId: true,
      userId: true,
      documentVariant: true,
      nationalityIso3: true,
      expiresOn: true,
      mrzChecksumValid: true,
      extractedBy: true,
      extractedAt: true,
      revokedAt: true,
      keyVersion: true,
    },
  });
  if (!row) return null;
  await writeAccessLog(prisma, {
    vaultId: row.id,
    action: 'signals_read',
    actor: args.actor,
  });
  return {
    ...row,
    documentVariant: row.documentVariant as PassportVaultVariant,
    extractedBy: row.extractedBy as PassportVaultExtractor,
  };
}

/**
 * Decrypt the full payload.  Call ONLY from:
 *   - /dashboard/passport when the signed-in user is the vault owner
 *   - a privileged workflow step running under the vault:decrypt role
 *
 * Logs a `decrypt` access row first, then decrypts.  On a decrypt error
 * (wrong key version, corrupt row) we still log — the access log is
 * about the attempt, not the success.
 */
export async function decryptVaultPayload(
  prisma: PrismaClient,
  args: { vaultId: string; tenantId: string; actor: VaultActor }
): Promise<PassportVaultPayload | null> {
  const shell = await prisma.passportVault.findFirst({
    where: { id: args.vaultId, tenantId: args.tenantId },
    select: { id: true, keyVersion: true, tenantId: true, revokedAt: true },
  });
  if (!shell || shell.revokedAt) {
    const existingContext =
      args.actor.context &&
      typeof args.actor.context === 'object' &&
      !Array.isArray(args.actor.context)
        ? (args.actor.context as Record<string, unknown>)
        : {};
    await writeAccessLog(prisma, {
      vaultId: args.vaultId,
      action: 'decrypt',
      actor: {
        ...args.actor,
        context: { ...existingContext, outcome: 'revoked_or_missing' } as Prisma.InputJsonValue,
      },
    });
    return null;
  }
  const dek = deriveDek(shell.tenantId, shell.keyVersion);
  const pgpPassword = dekToPgpPassword(dek);
  await writeAccessLog(prisma, {
    vaultId: args.vaultId,
    action: 'decrypt',
    actor: args.actor,
  });
  const rows = await prisma.$queryRaw<Array<{ plaintext: string }>>`
    SELECT pgp_sym_decrypt("ciphertext", ${pgpPassword}::text)::text AS plaintext
    FROM "passport_vault"
    WHERE "id" = ${args.vaultId}
    LIMIT 1
  `;
  const plaintext = rows[0]?.plaintext;
  if (!plaintext) return null;
  return JSON.parse(plaintext) as PassportVaultPayload;
}

/**
 * Ticketing record — the controlled PII read path.
 *
 * Airline ticketing (Duffel create order), TSA Secure Flight, and
 * visa-ancillary submissions all need the traveler's full legal name,
 * DOB, and passport number.  These live inside `ciphertext`; they are
 * NOT in any plaintext column and they are NEVER exposed to the LLM,
 * the agent tool surface, or the workflow scratchpad.
 *
 * This function decrypts ONLY the ticketing-critical fields and
 * writes a `ticketing_read` access-log row distinct from `decrypt` so
 * compliance can audit "passport# left the vault for legitimate
 * booking reasons" separately from "owner viewed their own data".
 *
 * Callers:
 *   - book_flight workflow step (Duffel passenger builder)
 *   - visa ancillary submission (Sherpa eVisa apply)
 *
 * Not for:
 *   - the agent tool surface (use readVaultSignals instead)
 *   - chat / inbox / any UI surface outside /dashboard/passport
 */
export interface VaultTicketingRecord {
  fullName: string;
  dateOfBirth: string;
  passportNumber: string;
  nationality: string;
  expiresOn: string;
  issuingState: string;
  documentVariant: PassportVaultVariant;
}

export async function readVaultTicketingRecord(
  prisma: PrismaClient,
  args: { vaultId: string; tenantId: string; actor: VaultActor }
): Promise<VaultTicketingRecord | null> {
  const payload = await decryptVaultPayload(prisma, {
    vaultId: args.vaultId,
    tenantId: args.tenantId,
    actor: {
      ...args.actor,
      source: `ticketing:${args.actor.source}`,
    },
  });
  if (!payload) return null;

  // Write a separate `ticketing_read` audit row so compliance can
  // distinguish ticketing decrypts from owner-self-view decrypts.
  await writeAccessLog(prisma, {
    vaultId: args.vaultId,
    action: 'ticketing_read',
    actor: args.actor,
  });

  const extraction = (payload.extraction ?? {}) as Record<string, unknown>;
  const fullName = [extraction.given_names, extraction.surname].filter(Boolean).join(' ').trim();
  const variant = await prisma.passportVault.findUnique({
    where: { id: args.vaultId },
    select: { documentVariant: true },
  });
  return {
    fullName: fullName || '',
    dateOfBirth: typeof extraction.date_of_birth === 'string' ? extraction.date_of_birth : '',
    passportNumber:
      typeof extraction.document_number === 'string' ? (extraction.document_number as string) : '',
    nationality:
      typeof extraction.nationality === 'string' ? (extraction.nationality as string) : '',
    expiresOn:
      typeof extraction.date_of_expiry === 'string'
        ? (extraction.date_of_expiry as string)
        : typeof extraction.expiration_date === 'string'
          ? (extraction.expiration_date as string)
          : '',
    issuingState:
      typeof extraction.issuing_country === 'string'
        ? (extraction.issuing_country as string)
        : typeof extraction.issuing_state === 'string'
          ? (extraction.issuing_state as string)
          : '',
    documentVariant: (variant?.documentVariant ?? 'passport') as PassportVaultVariant,
  };
}

/**
 * Mark a vault row revoked.  We do NOT delete — we keep the row so the
 * access log remains joinable, but set revokedAt and zero the
 * ciphertext bytea.
 */
export async function revokeVault(
  prisma: PrismaClient,
  args: { vaultId: string; tenantId: string; actor: VaultActor }
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "passport_vault"
    SET "ciphertext" = decode('', 'hex'),
        "revokedAt"  = now(),
        "updatedAt"  = now()
    WHERE "id" = ${args.vaultId} AND "tenantId" = ${args.tenantId}
  `;
  await writeAccessLog(prisma, {
    vaultId: args.vaultId,
    action: 'revoke',
    actor: args.actor,
  });
}

type VaultAction = 'upsert' | 'signals_read' | 'decrypt' | 'revoke' | 'verify' | 'ticketing_read';

async function writeAccessLog(
  prisma: PrismaClient,
  args: {
    vaultId: string;
    action: VaultAction;
    actor: VaultActor;
  }
): Promise<void> {
  await prisma.passportVaultAccessLog.create({
    data: {
      vaultId: args.vaultId,
      action: args.action,
      actorRef: args.actor.actorRef,
      source: args.actor.source,
      context: args.actor.context ?? undefined,
    },
  });
}
