-- TransferPolicy — composable policy guard rows for `@sendero/transfer-policy`.
-- One row = one guard. Compose multiple rows into a PolicyChain at runtime
-- via apps/app/lib/transfer-policy/load.ts::loadPolicyChain().
--
-- Polymorphic by design — `guardKind` discriminates the `config` JSONB shape.
-- Validation lives in the runtime adapter so a typo in this table can't
-- silently break agent dispatch — guards either parse cleanly or are skipped
-- with a logged warning.

CREATE TABLE "transfer_policies" (
    "id"              TEXT NOT NULL,
    "tenantId"        TEXT NOT NULL,
    "scope"           TEXT NOT NULL,
    "travelerId"      TEXT,
    "toolName"        TEXT,
    "guardKind"       TEXT NOT NULL,
    "config"          JSONB NOT NULL,
    "hardCap"         BOOLEAN NOT NULL DEFAULT TRUE,
    "alertWebhookUrl" TEXT,
    "enabled"         BOOLEAN NOT NULL DEFAULT TRUE,
    "priority"        INTEGER NOT NULL DEFAULT 100,
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transfer_policies_pkey" PRIMARY KEY ("id")
);

-- Active-policies-by-scope lookup. Used by loadPolicyChain() once per
-- dispatch / spend.
CREATE INDEX "transfer_policies_tenantId_scope_enabled_idx"
  ON "transfer_policies"("tenantId", "scope", "enabled");

-- Per-traveler scan for the editor at /dashboard/passport/[id]/policy.
CREATE INDEX "transfer_policies_tenantId_travelerId_enabled_idx"
  ON "transfer_policies"("tenantId", "travelerId", "enabled");

-- Per-tool scan for ToolBars + the per-tool editor.
CREATE INDEX "transfer_policies_tenantId_toolName_enabled_idx"
  ON "transfer_policies"("tenantId", "toolName", "enabled");

ALTER TABLE "transfer_policies"
  ADD CONSTRAINT "transfer_policies_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "transfer_policies"
  ADD CONSTRAINT "transfer_policies_travelerId_fkey"
  FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
