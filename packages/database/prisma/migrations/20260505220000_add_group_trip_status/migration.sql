-- GroupTripStatus + GroupTripPassengerStatus — lifecycle enums for
-- the group-trip funnel. See packages/tools/src/group-trips.ts and
-- the bucket-analysis closure plan #2.

CREATE TYPE "GroupTripStatus" AS ENUM (
  'draft',
  'inviting',
  'active',
  'completed',
  'canceled'
);

CREATE TYPE "GroupTripPassengerStatus" AS ENUM (
  'invited',
  'claimed',
  'declined',
  'canceled'
);

-- Trip column. Backfill existing rows to 'inviting' — that mirrors
-- present-day behavior (every existing GroupTrip is implicitly
-- accepting claims). Default for new rows is 'draft' from this point
-- forward.
ALTER TABLE "group_trips"
  ADD COLUMN "status" "GroupTripStatus" NOT NULL DEFAULT 'inviting';

ALTER TABLE "group_trips"
  ALTER COLUMN "status" SET DEFAULT 'draft';

-- Passenger column. Existing rows are by definition already 'claimed'
-- (the m:n row exists only if a passenger was attached). Default for
-- new rows is also 'claimed' — operator pre-allocations explicitly
-- override to 'invited' at insert time.
ALTER TABLE "group_trip_passengers"
  ADD COLUMN "status" "GroupTripPassengerStatus" NOT NULL DEFAULT 'claimed';

-- Hot read paths.
CREATE INDEX "group_trips_tenant_status_idx"
  ON "group_trips" ("tenantId", "status");

CREATE INDEX "group_trip_passengers_trip_status_idx"
  ON "group_trip_passengers" ("groupTripId", "status");
