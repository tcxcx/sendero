-- Phase 12 — passport vault (envelope-encrypted identity documents).
--
-- Two new tables + the pgcrypto extension for pgp_sym_encrypt / _decrypt.
-- @sendero/vault is the only package allowed to touch `ciphertext` — every
-- other consumer reads the sanitized signal columns (nationalityIso3,
-- expiresOn, documentVariant, mrzChecksumValid) which are safe for the
-- LLM and workflow scratchpad.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE "passport_vault" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "ciphertext"         BYTEA NOT NULL,
    "nonce"              BYTEA,
    "keyVersion"         INTEGER NOT NULL DEFAULT 1,
    "nationalityIso3"    TEXT,
    "expiresOn"          DATE,
    "documentVariant"    TEXT NOT NULL,
    "mrzChecksumValid"   BOOLEAN NOT NULL DEFAULT false,
    "extractedBy"        TEXT NOT NULL,
    "extractedAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMPTZ(6) NOT NULL,
    "revokedAt"          TIMESTAMPTZ(6),

    CONSTRAINT "passport_vault_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "passport_vault_tenantId_userId_documentVariant_key"
    ON "passport_vault"("tenantId", "userId", "documentVariant");
CREATE INDEX "passport_vault_tenantId_expiresOn_idx"
    ON "passport_vault"("tenantId", "expiresOn");
CREATE INDEX "passport_vault_userId_idx"
    ON "passport_vault"("userId");

ALTER TABLE "passport_vault" ADD CONSTRAINT "passport_vault_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "passport_vault" ADD CONSTRAINT "passport_vault_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "passport_vault_access_log" (
    "id"        TEXT NOT NULL,
    "vaultId"   TEXT NOT NULL,
    "action"    TEXT NOT NULL,
    "actorRef"  TEXT NOT NULL,
    "source"    TEXT NOT NULL,
    "context"   JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passport_vault_access_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "passport_vault_access_log_vaultId_createdAt_idx"
    ON "passport_vault_access_log"("vaultId", "createdAt");
CREATE INDEX "passport_vault_access_log_action_createdAt_idx"
    ON "passport_vault_access_log"("action", "createdAt");

ALTER TABLE "passport_vault_access_log" ADD CONSTRAINT "passport_vault_access_log_vaultId_fkey"
    FOREIGN KEY ("vaultId") REFERENCES "passport_vault"("id") ON DELETE CASCADE ON UPDATE CASCADE;
