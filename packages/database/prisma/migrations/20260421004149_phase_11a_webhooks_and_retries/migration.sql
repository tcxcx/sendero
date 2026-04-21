-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "appliedPolicyId" TEXT,
ADD COLUMN     "appliedPolicyVersion" INTEGER,
ADD COLUMN     "duffelOrderId" TEXT,
ADD COLUMN     "policyCheckResult" TEXT,
ADD COLUMN     "policyViolations" JSONB;

-- AlterTable
ALTER TABLE "meter_events" ADD COLUMN     "idempotencyKey" TEXT;

-- AlterTable
ALTER TABLE "nanopay_batches" ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "subjectKey" TEXT;

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(6),
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processingError" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_events_provider_processedAt_idx" ON "webhook_events"("provider", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_externalId_key" ON "webhook_events"("provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_duffelOrderId_key" ON "bookings"("duffelOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "meter_events_tenantId_idempotencyKey_key" ON "meter_events"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tenantId_subjectKey_key" ON "sessions"("tenantId", "subjectKey");

