-- TransferAttempt idempotency for booking settlements.
--
-- A booking can only have one in-flight (pending) or successful
-- (executed / passed) TransferAttempt. The settle-action handler does
-- a TOCTOU check via findFirst, but two concurrent operator clicks
-- (or a webhook retry vs. a manual button click) can both pass the
-- check before either has written. Closing the race at the DB layer
-- means the second writer crashes with `unique_violation` and the
-- first row is the canonical settlement record.
--
-- bookingId lives at metadata.bookingId (JSONB path), so the index is
-- a functional expression. CONCURRENTLY so the build doesn't block
-- the high-traffic insert path.
--
-- Partial filter — failed / blocked / rejected rows are recyclable;
-- the next attempt for the same booking must be free to run.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  "transfer_attempts_booking_idempotency_key"
  ON "transfer_attempts" ("tenantId", ("metadata" ->> 'bookingId'))
  WHERE
    "metadata" ->> 'bookingId' IS NOT NULL
    AND "status" IN ('executed', 'passed', 'pending');
