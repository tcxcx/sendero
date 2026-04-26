-- Group trips — coordinated multi-passenger journeys.
--
-- A GroupTrip aggregates many travelers under one roof (corporate
-- retreat, family vacation, conference cohort). At booking time it
-- fans out into per-passenger Trip rows, but the GroupTrip itself
-- carries the shared context: name, destination, capacity ceiling.
--
-- Capacity is enforced at the tool layer (`add_passenger_to_group_trip`)
-- against `maxPassengers`. Null = unlimited. The unique constraint on
-- (group_trip_id, user_id) gives idempotent adds — re-adding the same
-- passenger is a no-op.
--
-- Membership rows cascade-delete with both sides. Deleting a User
-- removes their group memberships; deleting a GroupTrip removes all
-- its passenger rows.

CREATE TABLE "group_trips" (
    "id"            TEXT        NOT NULL,
    "tenantId"      TEXT        NOT NULL,
    "name"          TEXT        NOT NULL,
    "destination"   TEXT,
    "maxPassengers" INTEGER,
    "metadata"      JSONB,
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "group_trips_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_trips_tenantId_createdAt_idx" ON "group_trips"("tenantId", "createdAt");

ALTER TABLE "group_trips"
  ADD CONSTRAINT "group_trips_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "group_trip_passengers" (
    "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
    "groupTripId" TEXT         NOT NULL,
    "userId"      TEXT         NOT NULL,
    "role"        TEXT         NOT NULL DEFAULT 'attendee',
    "addedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_trip_passengers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_trip_passengers_groupTripId_userId_key"
  ON "group_trip_passengers"("groupTripId", "userId");

CREATE INDEX "group_trip_passengers_userId_idx" ON "group_trip_passengers"("userId");

ALTER TABLE "group_trip_passengers"
  ADD CONSTRAINT "group_trip_passengers_groupTripId_fkey"
  FOREIGN KEY ("groupTripId") REFERENCES "group_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_trip_passengers"
  ADD CONSTRAINT "group_trip_passengers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
