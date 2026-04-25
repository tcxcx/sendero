-- TransferAttempt — per-attempt log for every Unified Balance Kit /
-- DCW outbound spend. Written by /api/transfer/spend at every branch
-- (passed, blocked, pending, executed, failed) so dashboards + budget
-- guards have a single source of truth.

CREATE TABLE "transfer_attempts" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "travelerId"        TEXT,
    "amountMicroUsdc"   BIGINT NOT NULL,
    "recipient"         TEXT NOT NULL,
    "destinationChain"  TEXT NOT NULL,
    "sourceAllocations" JSONB,
    "status"            TEXT NOT NULL DEFAULT 'passed',
    "txHash"            TEXT,
    "blockReason"       TEXT,
    "policyTrace"       JSONB,
    "metadata"          JSONB,
    "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfer_attempts_pkey" PRIMARY KEY ("id")
);

-- Active-status scan for dashboards (e.g. "executed in last 30d").
CREATE INDEX "transfer_attempts_tenantId_status_createdAt_idx"
  ON "transfer_attempts"("tenantId", "status", "createdAt");

-- Per-traveler aggregation for budget guards reading both meter_events
-- and transfer_attempts in the same window.
CREATE INDEX "transfer_attempts_tenantId_travelerId_createdAt_idx"
  ON "transfer_attempts"("tenantId", "travelerId", "createdAt");

ALTER TABLE "transfer_attempts"
  ADD CONSTRAINT "transfer_attempts_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transfer_attempts"
  ADD CONSTRAINT "transfer_attempts_travelerId_fkey"
  FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
