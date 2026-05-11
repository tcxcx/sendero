-- Phase 1 — B2B2B: CustomerAccount model + SlackInstall.kind discriminator.
-- See memory/customer_account_slack_install.md for the architectural context.
--
-- All new columns are nullable + carry safe defaults so existing rows
-- backfill cleanly (zero downtime, zero data risk). Lefthook
-- migration-lint warns about ADD COLUMN NOT NULL without DEFAULT —
-- this migration uses only nullable adds + a default-true discriminator.

-- CreateEnum
CREATE TYPE "SlackInstallKind" AS ENUM ('tmc_internal', 'customer_account');

-- CreateTable: CustomerAccount — the B2B2B corporate-customer layer.
CREATE TABLE "customer_accounts" (
    "id"                  TEXT NOT NULL,
    "tenantId"            TEXT NOT NULL,
    "displayName"         TEXT NOT NULL,
    "primaryDomain"       TEXT,
    "status"              TEXT NOT NULL DEFAULT 'invited',
    "createdByOperatorId" TEXT NOT NULL,
    "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "customer_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customer_accounts_tenantId_primaryDomain_key"
    ON "customer_accounts"("tenantId", "primaryDomain");

CREATE INDEX "customer_accounts_tenantId_status_idx"
    ON "customer_accounts"("tenantId", "status");

CREATE INDEX "customer_accounts_tenantId_createdAt_idx"
    ON "customer_accounts"("tenantId", "createdAt");

ALTER TABLE "customer_accounts"
    ADD CONSTRAINT "customer_accounts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: slack_installs — add discriminator + customer-account FK.
-- Existing rows backfill to 'tmc_internal' via the column default.
ALTER TABLE "slack_installs"
    ADD COLUMN "kind"              "SlackInstallKind" NOT NULL DEFAULT 'tmc_internal',
    ADD COLUMN "customerAccountId" TEXT;

CREATE INDEX "slack_installs_customerAccountId_idx"
    ON "slack_installs"("customerAccountId");

ALTER TABLE "slack_installs"
    ADD CONSTRAINT "slack_installs_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: users — corporate-employee linkage.
ALTER TABLE "users"
    ADD COLUMN "customerAccountId" TEXT;

ALTER TABLE "users"
    ADD CONSTRAINT "users_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: policies — per-customer-account policy scoping.
ALTER TABLE "policies"
    ADD COLUMN "customerAccountId" TEXT;

CREATE INDEX "policies_customerAccountId_idx"
    ON "policies"("customerAccountId");

ALTER TABLE "policies"
    ADD CONSTRAINT "policies_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: trips — corporate-trip routing + policy scoping.
ALTER TABLE "trips"
    ADD COLUMN "customerAccountId" TEXT;

CREATE INDEX "trips_customerAccountId_status_idx"
    ON "trips"("customerAccountId", "status");

ALTER TABLE "trips"
    ADD CONSTRAINT "trips_customerAccountId_fkey"
    FOREIGN KEY ("customerAccountId") REFERENCES "customer_accounts"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
