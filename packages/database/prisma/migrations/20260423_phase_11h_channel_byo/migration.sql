-- Phase 11h — Channel BYO (bring-your-own WhatsApp + Slack).
--
-- Adds:
--   * whatsapp_installs: per-tenant Kapso WhatsApp connection.
--   * trips.channelBindings: per-trip channel routing override (JSONB).
--
-- Slack already has tenant-level install via slack_installs (Phase 2).
-- No model rename needed.

-- AlterTable
ALTER TABLE "trips" ADD COLUMN "channelBindings" JSONB;

-- CreateTable
CREATE TABLE "whatsapp_installs" (
    "id" UUID NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kapsoCustomerId" TEXT NOT NULL,
    "kapsoConnectionId" TEXT,
    "businessDisplayName" TEXT,
    "phoneNumberId" TEXT,
    "businessAccountId" TEXT,
    "displayPhoneNumber" TEXT,
    "webhookSecret" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "lastErrorMessage" TEXT,
    "connectedByUserId" TEXT,
    "lastHealthyAt" TIMESTAMPTZ(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_installs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_tenantId_key" ON "whatsapp_installs"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_kapsoCustomerId_key" ON "whatsapp_installs"("kapsoCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_kapsoConnectionId_key" ON "whatsapp_installs"("kapsoConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_installs_phoneNumberId_key" ON "whatsapp_installs"("phoneNumberId");

-- CreateIndex
CREATE INDEX "whatsapp_installs_tenantId_status_idx" ON "whatsapp_installs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "whatsapp_installs_phoneNumberId_idx" ON "whatsapp_installs"("phoneNumberId");

-- AddForeignKey
ALTER TABLE "whatsapp_installs" ADD CONSTRAINT "whatsapp_installs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
