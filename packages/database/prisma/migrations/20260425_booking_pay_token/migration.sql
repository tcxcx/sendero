-- Magic-link auth for off-app travelers (agency / B2C). One row per
-- pre-fund-and-invite cycle; rows are short-lived (typically 30 min),
-- single-use, and bound to a specific booking. Consumption flips
-- consumedAt and stamps attemptId for audit reconciliation.

CREATE TABLE "booking_pay_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "attemptId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_pay_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "booking_pay_tokens_token_key" ON "booking_pay_tokens"("token");
CREATE INDEX "booking_pay_tokens_tenantId_bookingId_idx" ON "booking_pay_tokens"("tenantId", "bookingId");
CREATE INDEX "booking_pay_tokens_expiresAt_idx" ON "booking_pay_tokens"("expiresAt");

ALTER TABLE "booking_pay_tokens"
    ADD CONSTRAINT "booking_pay_tokens_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_pay_tokens"
    ADD CONSTRAINT "booking_pay_tokens_bookingId_fkey"
    FOREIGN KEY ("bookingId") REFERENCES "bookings"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
