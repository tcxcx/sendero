-- Phase 11d — Duffel identity (CustomerUser + CustomerUserGroup)
--
-- Adds a per-User `duffelCustomerUserId` (`icu_…`) and a per-Tenant
-- `duffelCustomerUserGroupId` (`usg_…`). Attaching these to Duffel
-- orders + bookings unlocks Travel Support Assistant access for the
-- end user and scopes support to the tenant's group.
--
-- Also adds a generic `metadata` JSONB on `users` for free-form
-- per-user state (preferred language, locale, etc.).

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "duffelCustomerUserId" TEXT,
  ADD COLUMN "metadata" JSONB;

-- AlterTable
ALTER TABLE "tenants"
  ADD COLUMN "duffelCustomerUserGroupId" TEXT;

-- CreateIndex (unique)
CREATE UNIQUE INDEX "users_duffelCustomerUserId_key" ON "users"("duffelCustomerUserId");
CREATE UNIQUE INDEX "tenants_duffelCustomerUserGroupId_key" ON "tenants"("duffelCustomerUserGroupId");
