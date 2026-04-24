-- Trip Eligibility Runs — async visa verification via Sherpa + curated fallback.
-- Booking UI never blocks on the external call; frontend subscribes to
-- pg_notify('trip_eligibility_run:${id}', …) and flips the verdict when ready.

CREATE TABLE "trip_eligibility_runs" (
    "id"               TEXT NOT NULL,
    "tenantId"         TEXT NOT NULL,
    "tripId"           TEXT,
    "travelerId"       TEXT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'pending',
    "source"           TEXT,
    "sherpaTripId"     TEXT,
    "originIso3"       TEXT NOT NULL,
    "destinationIso3"  TEXT NOT NULL,
    "departureDate"    DATE NOT NULL,
    "returnDate"       DATE,
    "purpose"          TEXT NOT NULL DEFAULT 'business',
    "verdict"          JSONB,
    "providerRaw"      JSONB,
    "failureReason"    TEXT,
    "trigger"          TEXT NOT NULL DEFAULT 'manual',
    "requestedByActor" TEXT,
    "requestedAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt"        TIMESTAMPTZ(6),
    "completedAt"      TIMESTAMPTZ(6),

    CONSTRAINT "trip_eligibility_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trip_eligibility_runs_tenantId_tripId_idx"
    ON "trip_eligibility_runs"("tenantId", "tripId");
CREATE INDEX "trip_eligibility_runs_travelerId_requestedAt_idx"
    ON "trip_eligibility_runs"("travelerId", "requestedAt");
CREATE INDEX "trip_eligibility_runs_status_requestedAt_idx"
    ON "trip_eligibility_runs"("status", "requestedAt");

ALTER TABLE "trip_eligibility_runs" ADD CONSTRAINT "trip_eligibility_runs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "trip_eligibility_runs" ADD CONSTRAINT "trip_eligibility_runs_travelerId_fkey"
    FOREIGN KEY ("travelerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
