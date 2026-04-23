-- Phase 11e — AirlineCredit cache table
--
-- Mirrors the Duffel airline credit wire type so `list_airline_credits`
-- + book_flight don't have to hit Duffel on every traveler session. A
-- webhook hydrates the row on `air.airline_credit.created` / `.spent`
-- / `.invalidated`, and the ensure path writes through on first sight.

CREATE TABLE "airline_credits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "duffelUserId" TEXT,
    "airlineIataCode" CHAR(2) NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "amount" DECIMAL(18,6) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "issuedOn" DATE,
    "expiresAt" TIMESTAMPTZ(6),
    "spentAt" TIMESTAMPTZ(6),
    "invalidatedAt" TIMESTAMPTZ(6),
    "givenName" TEXT,
    "familyName" TEXT,
    "passengerId" TEXT,
    "orderId" TEXT,
    "state" TEXT NOT NULL DEFAULT 'available',
    "liveMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "airline_credits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "airline_credits_userId_state_expiresAt_idx"
    ON "airline_credits"("userId", "state", "expiresAt");
CREATE INDEX "airline_credits_tenantId_state_idx"
    ON "airline_credits"("tenantId", "state");
CREATE INDEX "airline_credits_duffelUserId_state_idx"
    ON "airline_credits"("duffelUserId", "state");

ALTER TABLE "airline_credits"
    ADD CONSTRAINT "airline_credits_userId_fkey"
    FOREIGN KEY ("userId")
    REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
