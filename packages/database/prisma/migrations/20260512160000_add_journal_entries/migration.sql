-- Gateway v5 Step 1 — immutable double-entry journal.
--
-- Shadow-written first. A deferred constraint trigger verifies every
-- logical transaction balances at COMMIT so multi-leg writes can happen
-- in one DB transaction without transient failures between legs.

-- CreateEnum
CREATE TYPE "JournalDirection" AS ENUM ('debit', 'credit');

-- CreateEnum
CREATE TYPE "JournalAsset" AS ENUM ('USDC', 'EURC');

-- CreateTable
CREATE TABLE "journal_entries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "transactionId" UUID NOT NULL,
  "legIndex" INTEGER NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT,
  "complianceDecisionId" UUID,
  "account" TEXT NOT NULL,
  "direction" "JournalDirection" NOT NULL,
  "amountMicroUsdc" BIGINT NOT NULL,
  "asset" "JournalAsset" NOT NULL DEFAULT 'USDC',
  "contextKind" TEXT NOT NULL,
  "contextRef" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "journal_entries_amount_positive" CHECK ("amountMicroUsdc" > 0),
  CONSTRAINT "journal_entries_account_shape" CHECK (
    "account" ~ '^(asset:(gateway|dcw):[A-Za-z0-9_-]+|liability:(user|tenant):[A-Za-z0-9_-]+|revenue:fee|expense:gas)$'
  )
);

-- Foreign keys use RESTRICT: financial audit rows must survive tenant
-- offboarding and user deletion workflows.
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX CONCURRENTLY "journal_entries_transactionId_legIndex_key"
  ON "journal_entries"("transactionId", "legIndex");

CREATE INDEX CONCURRENTLY "journal_entries_tenantId_createdAt_idx"
  ON "journal_entries"("tenantId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY "journal_entries_tenantId_account_createdAt_idx"
  ON "journal_entries"("tenantId", "account", "createdAt" DESC);

CREATE INDEX CONCURRENTLY "journal_entries_transactionId_idx"
  ON "journal_entries"("transactionId");

CREATE INDEX CONCURRENTLY "journal_entries_contextKind_contextRef_idx"
  ON "journal_entries"("contextKind", "contextRef");

CREATE INDEX CONCURRENTLY "journal_entries_complianceDecisionId_idx"
  ON "journal_entries"("complianceDecisionId");

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION reject_journal_entry_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'journal_entries are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER journal_entries_immutable
BEFORE UPDATE OR DELETE ON "journal_entries"
FOR EACH ROW EXECUTE FUNCTION reject_journal_entry_mutation();

-- Deferred balance enforcement. This deliberately re-queries the whole
-- transaction group so INSERTs of 2+ legs in one statement or one
-- explicit DB transaction pass, while partial writes fail at COMMIT.
CREATE OR REPLACE FUNCTION assert_journal_transaction_balanced()
RETURNS trigger AS $$
DECLARE
  tid uuid := COALESCE(NEW."transactionId", OLD."transactionId");
  debit_sum numeric;
  credit_sum numeric;
  leg_count integer;
BEGIN
  SELECT
    COALESCE(SUM(CASE WHEN "direction" = 'debit' THEN "amountMicroUsdc" ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN "direction" = 'credit' THEN "amountMicroUsdc" ELSE 0 END), 0),
    COUNT(*)
  INTO debit_sum, credit_sum, leg_count
  FROM "journal_entries"
  WHERE "transactionId" = tid;

  IF leg_count < 2 OR debit_sum <> credit_sum THEN
    RAISE EXCEPTION 'unbalanced journal transaction %: debit %, credit %, legs %',
      tid, debit_sum, credit_sum, leg_count;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entries_balanced
AFTER INSERT OR UPDATE OR DELETE ON "journal_entries"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION assert_journal_transaction_balanced();
