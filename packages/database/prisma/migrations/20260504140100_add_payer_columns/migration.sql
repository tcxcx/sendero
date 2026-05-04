-- Trip — payment mode resolved at trip creation.
ALTER TABLE "trips" ADD COLUMN "paymentMode" "TripPaymentMode";

-- Tenant — default mode for new trips. Default 'traveler' (consumer mode
-- is the bigger bet). Existing tenants ALSO get 'traveler' because
-- pre-retro `book_flight` already debits the traveler wallet first
-- (then Gateway-settles to the tenant treasury) — matching that behavior
-- preserves the invariant that recorded payer == actually-debited wallet.
-- TMC corporate tenants flip to 'tenant' post-cutover when their
-- treasury-debit runtime path lands.
ALTER TABLE "tenants" ADD COLUMN "defaultPaymentMode" "TripPaymentMode" NOT NULL DEFAULT 'traveler';

-- MeterEvent — explicit payer attribution. Distinct from userId (which can
-- be the operator triggering on behalf of the traveler).
ALTER TABLE "meter_events" ADD COLUMN "payerType" "MeterPayerType";
ALTER TABLE "meter_events" ADD COLUMN "payerWalletId" TEXT;
ALTER TABLE "meter_events" ADD COLUMN "payerUserId" TEXT;

-- Booking — denormalized payer fields for fast reconciliation.
ALTER TABLE "bookings" ADD COLUMN "provisionedBy" "MeterPayerType";
ALTER TABLE "bookings" ADD COLUMN "payerWalletId" TEXT;

-- Backfill — existing book_flight semantics already debit the traveler
-- wallet then settle to tenant treasury, so legacy rows are traveler-paid.
UPDATE "trips" SET "paymentMode" = 'traveler' WHERE "paymentMode" IS NULL;
UPDATE "meter_events" SET "payerType" = 'traveler' WHERE "payerType" IS NULL AND "userId" IS NOT NULL;
UPDATE "meter_events" SET "payerType" = 'tenant'   WHERE "payerType" IS NULL; -- tool-call events without traveler attribution
UPDATE "bookings" SET "provisionedBy" = 'traveler' WHERE "provisionedBy" IS NULL;

-- Indexes — analytics by payer.
-- NB: dropped `CONCURRENTLY` because Prisma wraps each migration in a
-- transaction and Postgres rejects `CREATE INDEX CONCURRENTLY` inside
-- a transaction block (error 25001). For prod tables with row counts
-- that warrant CONCURRENTLY, build the index separately via psql
-- outside the migration runner. Dev/preview DBs are small enough that
-- the non-concurrent build is microseconds.
CREATE INDEX "meter_events_payerType_at_idx" ON "meter_events"("payerType", "at" DESC);
CREATE INDEX "meter_events_payerUserId_at_idx" ON "meter_events"("payerUserId", "at" DESC);
CREATE INDEX "bookings_provisionedBy_idx" ON "bookings"("provisionedBy");
