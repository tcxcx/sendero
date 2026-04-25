-- Discriminate spends from deposits on the same audit trail. Existing
-- rows are all spends → default 'spend'. New tenant pre-fund flow writes
-- 'deposit' rows (recipient = traveler wallet, txHash from kit.depositFor).

ALTER TABLE "transfer_attempts"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'spend';

-- Per-tenant per-kind dashboard scan, e.g. "deposits this month for
-- traveler X". Layers on top of the existing tenantId+status index.
CREATE INDEX "transfer_attempts_tenantId_kind_createdAt_idx"
  ON "transfer_attempts"("tenantId", "kind", "createdAt");
