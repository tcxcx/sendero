-- Esim — travel data plans purchased via book_esim.
-- See `model Esim` in prisma/schema.prisma for column docs.
CREATE TABLE "esims" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "travelerId" TEXT,
    "tripId" TEXT,
    "provider" TEXT NOT NULL,
    "providerOrderId" TEXT NOT NULL,
    "iccid" TEXT,
    "activationCode" TEXT NOT NULL,
    "lpaCode" TEXT NOT NULL,
    "qrTokenHash" TEXT,
    "destinationCountries" JSONB NOT NULL,
    "dataMb" INTEGER NOT NULL,
    "validityDays" INTEGER NOT NULL,
    "wholesaleMicroUsdc" BIGINT NOT NULL,
    "markupMicroUsdc" BIGINT NOT NULL DEFAULT 0,
    "senderoTakeMicroUsdc" BIGINT NOT NULL DEFAULT 0,
    "retailMicroUsdc" BIGINT NOT NULL,
    "provisionedBy" "MeterPayerType",
    "payerWalletId" TEXT,
    "payerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ordered',
    "installedAt" TIMESTAMPTZ(6),
    "activatedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "usageMb" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "esims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "esims_iccid_key" ON "esims"("iccid");
CREATE UNIQUE INDEX "esims_provider_providerOrderId_key" ON "esims"("provider", "providerOrderId");
CREATE INDEX "esims_tenantId_createdAt_idx" ON "esims"("tenantId", "createdAt" DESC);
CREATE INDEX "esims_tripId_idx" ON "esims"("tripId");
CREATE INDEX "esims_travelerId_idx" ON "esims"("travelerId");
CREATE INDEX "esims_status_idx" ON "esims"("status");
CREATE INDEX "esims_provisionedBy_idx" ON "esims"("provisionedBy");
