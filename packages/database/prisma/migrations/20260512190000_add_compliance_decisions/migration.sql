-- Gateway v5 Step 4 — log-only ComplianceDecision pre-sign gate.
--
-- Provider integration is intentionally deferred. Current writes use
-- provider='none', sanctionsResult='allow', and riskScore=0 while the
-- type/foreign-key contract is threaded through value-moving paths.

-- CreateEnum
CREATE TYPE "ComplianceSanctionsResult" AS ENUM (
  'allow',
  'block',
  'manual_review'
);

-- CreateTable
CREATE TABLE "compliance_decisions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "intentId" UUID,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "recipientAddress" TEXT NOT NULL,
  "recipientChain" TEXT NOT NULL,
  "amountMicroUsdc" BIGINT NOT NULL,
  "sanctionsResult" "ComplianceSanctionsResult" NOT NULL DEFAULT 'allow',
  "riskScore" DECIMAL(5,4) NOT NULL DEFAULT 0,
  "provider" TEXT NOT NULL DEFAULT 'none',
  "providerRequestId" TEXT NOT NULL,
  "decidedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "operatorOverrideId" TEXT,
  "callerSurface" TEXT,
  "callerUserId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "compliance_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "compliance_decisions_amount_positive" CHECK ("amountMicroUsdc" > 0),
  CONSTRAINT "compliance_decisions_risk_score_range" CHECK ("riskScore" >= 0 AND "riskScore" <= 1),
  CONSTRAINT "compliance_decisions_expiry_after_decision" CHECK ("expiresAt" > "decidedAt")
);

-- AddForeignKey
ALTER TABLE "compliance_decisions"
  ADD CONSTRAINT "compliance_decisions_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "gateway_transfer_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "compliance_decisions"
  ADD CONSTRAINT "compliance_decisions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "compliance_decisions"
  ADD CONSTRAINT "compliance_decisions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_complianceDecisionId_fkey"
  FOREIGN KEY ("complianceDecisionId") REFERENCES "compliance_decisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "signing_events"
  ADD CONSTRAINT "signing_events_complianceDecisionId_fkey"
  FOREIGN KEY ("complianceDecisionId") REFERENCES "compliance_decisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX CONCURRENTLY "compliance_decisions_tenantId_decidedAt_idx"
  ON "compliance_decisions"("tenantId", "decidedAt" DESC);

CREATE INDEX CONCURRENTLY "compliance_decisions_tenantId_recipientAddress_decidedAt_idx"
  ON "compliance_decisions"("tenantId", "recipientAddress", "decidedAt" DESC);

CREATE INDEX CONCURRENTLY "compliance_decisions_intentId_idx"
  ON "compliance_decisions"("intentId");

CREATE INDEX CONCURRENTLY "compliance_decisions_expiresAt_idx"
  ON "compliance_decisions"("expiresAt");

CREATE INDEX CONCURRENTLY "compliance_decisions_providerRequestId_idx"
  ON "compliance_decisions"("providerRequestId");

CREATE INDEX CONCURRENTLY "signing_events_complianceDecisionId_idx"
  ON "signing_events"("complianceDecisionId");

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION reject_compliance_decision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'compliance_decisions are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_decisions_immutable
BEFORE UPDATE OR DELETE ON "compliance_decisions"
FOR EACH ROW EXECUTE FUNCTION reject_compliance_decision_mutation();
