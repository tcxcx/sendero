-- Phase 1 — Gateway loop on Arc.
--
-- Scope:
--   - Per-tenant Gateway signer (self-custody EOA, encrypted at rest)
--   - Per-tenant Gateway config (enabled domains, depositor addresses, sweep policy)
--   - Append-only deposit + transfer logs (idempotent on webhook_event_id / circle_transfer_id)
--   - Add scaDeployedAt cache to circle_wallets (used by Phase 2 ensureScaDeployed)
--   - New (tenant, kind, chain) index on circle_wallets to support per-chain ops DCWs
--
-- Why per-tenant signers instead of reusing TREASURY_PRIVATE_KEY:
--   Circle's signTypedData injects chainId into the EIP-712 domain, but
--   Gateway DOMAIN_SEPARATOR has no chainId — DCW-signed burn intents
--   recover to the wrong address and Gateway rejects with "recovered
--   signer does not match sourceSigner". Verified by desk-v1 live
--   2026-04-18. Per-tenant viem EOAs are the canonical workaround.
--
-- Safe to run on a populated DB:
--   - All new tables (no ALTER on existing rows beyond two ADD COLUMNs).
--   - circle_wallets gets scaDeployedAt (nullable) — no backfill needed.
--   - New (tenantId, kind, chain) index on circle_wallets is non-unique;
--     existing rows already satisfy it because every row has those three
--     columns populated.

-- ──────────────────────────────────────────────────────────────────────
-- circle_wallets: SCA deploy cache + per-chain index
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE "circle_wallets"
  ADD COLUMN IF NOT EXISTS "scaDeployedAt" TIMESTAMPTZ(6);

CREATE INDEX IF NOT EXISTS "circle_wallets_tenantId_kind_chain_idx"
  ON "circle_wallets" ("tenantId", "kind", "chain");

-- ──────────────────────────────────────────────────────────────────────
-- tenant_gateway_signers — per-tenant EOA, encrypted at rest
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE "tenant_gateway_signers" (
  "tenantId"            TEXT        PRIMARY KEY,
  "address"             TEXT        NOT NULL,
  "encryptedPrivateKey" TEXT        NOT NULL,
  "kekVersion"          INTEGER     NOT NULL DEFAULT 1,
  "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tenant_gateway_signers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "tenant_gateway_signers_address_key"
    UNIQUE ("address")
);

-- ──────────────────────────────────────────────────────────────────────
-- tenant_gateway_configs — enabled domains, depositors, sweep policy
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE "tenant_gateway_configs" (
  "tenantId"               TEXT        PRIMARY KEY,
  "evmDepositorAddress"    TEXT        NOT NULL,
  "solanaDepositorAddress" TEXT,
  "enabledDomains"         INTEGER[]   NOT NULL DEFAULT ARRAY[26]::INTEGER[],
  "sweepPolicy"            JSONB,
  "createdAt"              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "tenant_gateway_configs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

-- ──────────────────────────────────────────────────────────────────────
-- gateway_deposit_logs — auto-sweep audit trail
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE "gateway_deposit_logs" (
  "id"              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"        TEXT        NOT NULL,
  "chain"           TEXT        NOT NULL,
  "domain"          INTEGER     NOT NULL,
  "amountMicroUsdc" BIGINT      NOT NULL,
  "depositTxHash"   TEXT,
  "approveTxHash"   TEXT,
  "status"          TEXT        NOT NULL DEFAULT 'pending',
  "retryCount"      INTEGER     NOT NULL DEFAULT 0,
  "webhookEventId"  TEXT,
  "triggeredBy"     TEXT        NOT NULL DEFAULT 'auto',
  "errorMessage"    TEXT,
  "confirmedAt"     TIMESTAMPTZ(6),
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "gateway_deposit_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "gateway_deposit_logs_webhookEventId_key"
    UNIQUE ("webhookEventId")
);

CREATE INDEX "gateway_deposit_logs_tenantId_chain_status_idx"
  ON "gateway_deposit_logs" ("tenantId", "chain", "status");

CREATE INDEX "gateway_deposit_logs_tenantId_createdAt_idx"
  ON "gateway_deposit_logs" ("tenantId", "createdAt" DESC);

CREATE INDEX "gateway_deposit_logs_status_createdAt_idx"
  ON "gateway_deposit_logs" ("status", "createdAt" DESC);

-- ──────────────────────────────────────────────────────────────────────
-- gateway_transfer_logs — outbound burn-mint audit trail
-- ──────────────────────────────────────────────────────────────────────

CREATE TABLE "gateway_transfer_logs" (
  "id"                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"                TEXT        NOT NULL,
  "sourceDomain"            INTEGER,
  "destinationDomain"       INTEGER     NOT NULL,
  "destinationChain"        TEXT        NOT NULL,
  "amountMicroUsdc"         BIGINT      NOT NULL,
  "recipientAddress"        TEXT        NOT NULL,
  "burnSignature"           TEXT,
  "attestation"             TEXT,
  "circleTransferId"        TEXT,
  "mintTxHash"              TEXT,
  "circleDestinationTxHash" TEXT,
  "forwardingEnabled"       BOOLEAN     NOT NULL DEFAULT TRUE,
  "forwardingFailureReason" TEXT,
  "feesTotalMicroUsdc"      BIGINT,
  "feesForwardingMicroUsdc" BIGINT,
  "feesPerIntent"           JSONB,
  "status"                  TEXT        NOT NULL DEFAULT 'attesting',
  "lastReconciledAt"        TIMESTAMPTZ(6),
  "initiatedByUserId"       TEXT,
  "triggeredBy"             TEXT        NOT NULL,
  "errorMessage"            TEXT,
  "createdAt"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt"             TIMESTAMPTZ(6),
  "updatedAt"               TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "gateway_transfer_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "gateway_transfer_logs_circleTransferId_key"
    UNIQUE ("circleTransferId")
);

CREATE INDEX "gateway_transfer_logs_tenantId_status_idx"
  ON "gateway_transfer_logs" ("tenantId", "status");

CREATE INDEX "gateway_transfer_logs_tenantId_createdAt_idx"
  ON "gateway_transfer_logs" ("tenantId", "createdAt" DESC);

CREATE INDEX "gateway_transfer_logs_status_createdAt_idx"
  ON "gateway_transfer_logs" ("status", "createdAt" DESC);
