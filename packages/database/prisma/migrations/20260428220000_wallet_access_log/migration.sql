-- Phase 5 P5.1 — wallet_access_logs audit table.
--
-- Append-only audit of every Gateway signer key-material access (cache
-- miss / decrypt event). Critical for compliance + forensics.
--
-- Cache hits don't log — they don't decrypt the key. Only the cold path
-- through getOrCreateGatewaySigner / getGatewaySigner records here, so
-- table growth is bounded by (cold starts × tenants × ops per cold start)
-- not (queries × tenants).
--
-- Indexed by (tenantId, occurredAt) for per-tenant timeline queries +
-- (occurredAt) for cross-tenant time-range scans during incident
-- response.

CREATE TABLE "wallet_access_logs" (
  "id"            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"      TEXT        NOT NULL,
  "callerSurface" TEXT        NOT NULL,
  "callerUserId"  TEXT,
  "kekVersion"    INTEGER     NOT NULL,
  "context"       TEXT,
  "occurredAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_access_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "wallet_access_logs_tenantId_occurredAt_idx"
  ON "wallet_access_logs" ("tenantId", "occurredAt" DESC);

CREATE INDEX "wallet_access_logs_occurredAt_idx"
  ON "wallet_access_logs" ("occurredAt" DESC);
