-- CreateTable
CREATE TABLE "ancillary_selections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "userId" TEXT,
    "offerId" TEXT NOT NULL,
    "bookingId" TEXT,
    "workflowRunId" TEXT,
    "services" JSONB NOT NULL,
    "totalAmount" DECIMAL(12,2),
    "totalCurrency" CHAR(3),
    "bookedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ancillary_selections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disruption_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "bookingId" TEXT,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "workflowRunId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" JSONB,
    "resolvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "disruption_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_in_nudges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "bookingId" TEXT,
    "scheduledAt" TIMESTAMPTZ(6) NOT NULL,
    "firedAt" TIMESTAMPTZ(6),
    "actionedAt" TIMESTAMPTZ(6),
    "channel" TEXT NOT NULL,
    "leaveByIso" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "check_in_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "safety_briefs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT,
    "userId" TEXT,
    "destination" JSONB NOT NULL,
    "workflowRunId" TEXT,
    "weather" JSONB,
    "airQuality" JSONB,
    "timezone" JSONB,
    "elevation" JSONB,
    "travelSafety" JSONB,
    "riskLevel" TEXT NOT NULL DEFAULT 'low',
    "computedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "arrival_playbook_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "bookingId" TEXT,
    "airportIata" CHAR(3) NOT NULL,
    "transferOptionId" TEXT,
    "restaurantIds" JSONB NOT NULL DEFAULT '[]',
    "routeMapCid" TEXT,
    "playbook" JSONB NOT NULL,
    "workflowRunId" TEXT,
    "actionedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "arrival_playbook_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_turns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "tripId" TEXT,
    "bookingId" TEXT,
    "duffelSupportId" TEXT,
    "turnSummary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "nanopayEventId" TEXT,
    "rawIo" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_turns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ancillary_selections_tenantId_tripId_createdAt_idx" ON "ancillary_selections"("tenantId", "tripId", "createdAt");

-- CreateIndex
CREATE INDEX "ancillary_selections_offerId_idx" ON "ancillary_selections"("offerId");

-- CreateIndex
CREATE INDEX "ancillary_selections_bookingId_idx" ON "ancillary_selections"("bookingId");

-- CreateIndex
CREATE INDEX "disruption_runs_tenantId_tripId_createdAt_idx" ON "disruption_runs"("tenantId", "tripId", "createdAt");

-- CreateIndex
CREATE INDEX "disruption_runs_tenantId_status_idx" ON "disruption_runs"("tenantId", "status");

-- CreateIndex
CREATE INDEX "disruption_runs_bookingId_idx" ON "disruption_runs"("bookingId");

-- CreateIndex
CREATE INDEX "check_in_nudges_tenantId_tripId_scheduledAt_idx" ON "check_in_nudges"("tenantId", "tripId", "scheduledAt");

-- CreateIndex
CREATE INDEX "check_in_nudges_scheduledAt_firedAt_idx" ON "check_in_nudges"("scheduledAt", "firedAt");

-- CreateIndex
CREATE INDEX "safety_briefs_tenantId_tripId_computedAt_idx" ON "safety_briefs"("tenantId", "tripId", "computedAt");

-- CreateIndex
CREATE INDEX "safety_briefs_tenantId_riskLevel_idx" ON "safety_briefs"("tenantId", "riskLevel");

-- CreateIndex
CREATE INDEX "arrival_playbook_runs_tenantId_tripId_createdAt_idx" ON "arrival_playbook_runs"("tenantId", "tripId", "createdAt");

-- CreateIndex
CREATE INDEX "arrival_playbook_runs_bookingId_idx" ON "arrival_playbook_runs"("bookingId");

-- CreateIndex
CREATE INDEX "support_turns_tenantId_tripId_createdAt_idx" ON "support_turns"("tenantId", "tripId", "createdAt");

-- CreateIndex
CREATE INDEX "support_turns_tenantId_outcome_idx" ON "support_turns"("tenantId", "outcome");

-- CreateIndex
CREATE INDEX "support_turns_userId_idx" ON "support_turns"("userId");

-- AddForeignKey
ALTER TABLE "ancillary_selections" ADD CONSTRAINT "ancillary_selections_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disruption_runs" ADD CONSTRAINT "disruption_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_in_nudges" ADD CONSTRAINT "check_in_nudges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "safety_briefs" ADD CONSTRAINT "safety_briefs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "arrival_playbook_runs" ADD CONSTRAINT "arrival_playbook_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_turns" ADD CONSTRAINT "support_turns_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
