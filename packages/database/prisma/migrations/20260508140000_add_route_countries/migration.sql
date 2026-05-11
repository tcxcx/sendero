-- Phase E layer 2 — first-class route-country columns on Trip + Booking.
--
-- Lifts originCountry / destinationCountry out of JSON (Trip.intent,
-- Booking.segments) and into top-level scalar columns so the trip-map
-- UI + downstream tools have indexed, queryable, schema-enforced
-- access. Single source for the values: `@sendero/tools/lib/derive-route-countries`.
--
-- Three steps in one transaction (Prisma wraps non-`ALTER TYPE ADD VALUE`
-- DDL automatically):
--   1. ADD COLUMN nullable + ISO-2 CHECK constraint
--   2. Inline backfill from existing JSON (trivial cases only —
--      stragglers with no IATA stay null and need
--      `bun scripts/backfill-route-countries.ts --apply`)
--   3. Index `(tenantId, destinationCountry)` for the upcoming
--      "trips by destination" rollups
--
-- NOT NULL is intentionally NOT applied here. Follow-up migration
-- after backfill verifies zero stragglers.

ALTER TABLE "trips"
  ADD COLUMN "originCountry" CHAR(2),
  ADD COLUMN "destinationCountry" CHAR(2);

ALTER TABLE "trips"
  ADD CONSTRAINT "trips_originCountry_iso2_check"
    CHECK ("originCountry" IS NULL OR "originCountry" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "trips_destinationCountry_iso2_check"
    CHECK ("destinationCountry" IS NULL OR "destinationCountry" ~ '^[A-Z]{2}$');

ALTER TABLE "bookings"
  ADD COLUMN "originCountry" CHAR(2),
  ADD COLUMN "destinationCountry" CHAR(2);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_originCountry_iso2_check"
    CHECK ("originCountry" IS NULL OR "originCountry" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "bookings_destinationCountry_iso2_check"
    CHECK ("destinationCountry" IS NULL OR "destinationCountry" ~ '^[A-Z]{2}$');

-- Inline trivial backfill for Trip from intent JSON. Only handles rows
-- where the JSON already has an explicit ISO-2 — the IATA-fallback
-- path lives in the deriveRouteCountries helper and runs via the
-- backfill script for full coverage.
UPDATE "trips"
   SET "originCountry" = UPPER(intent->>'originIso2')
 WHERE "originCountry" IS NULL
   AND intent->>'originIso2' IS NOT NULL
   AND intent->>'originIso2' ~ '^[A-Za-z]{2}$';

UPDATE "trips"
   SET "destinationCountry" = UPPER(
         CASE
           WHEN jsonb_typeof(intent->'destinationIso2') = 'array'
             THEN intent->'destinationIso2'->>0
           ELSE intent->>'destinationIso2'
         END
       )
 WHERE "destinationCountry" IS NULL
   AND (
         jsonb_typeof(intent->'destinationIso2') = 'array'
         OR jsonb_typeof(intent->'destinationIso2') = 'string'
       );

-- Drop any rows where the JSON contained junk that now violates the
-- CHECK constraint by setting them back to null. Should be a no-op on
-- well-formed data.
UPDATE "trips"
   SET "destinationCountry" = NULL
 WHERE "destinationCountry" IS NOT NULL
   AND "destinationCountry" !~ '^[A-Z]{2}$';

-- Inline trivial backfill for Booking from first segment in segments JSON.
UPDATE "bookings"
   SET "originCountry" = UPPER(segments->0->>'originCountry')
 WHERE "originCountry" IS NULL
   AND jsonb_typeof(segments) = 'array'
   AND segments->0->>'originCountry' IS NOT NULL
   AND segments->0->>'originCountry' ~ '^[A-Za-z]{2}$';

-- Destination = first segment whose destinationCountry differs from
-- origin (handles round-trips); fall through to last segment.
UPDATE "bookings" b
   SET "destinationCountry" = UPPER(seg.dest)
  FROM (
    SELECT
      b2.id,
      COALESCE(
        (
          SELECT s->>'destinationCountry'
            FROM jsonb_array_elements(b2.segments) s
           WHERE s->>'destinationCountry' IS NOT NULL
             AND s->>'destinationCountry' ~ '^[A-Za-z]{2}$'
             AND UPPER(s->>'destinationCountry') <> UPPER(b2.segments->0->>'originCountry')
           LIMIT 1
        ),
        b2.segments->-1->>'destinationCountry'
      ) AS dest
    FROM "bookings" b2
   WHERE b2."destinationCountry" IS NULL
     AND jsonb_typeof(b2.segments) = 'array'
  ) seg
 WHERE b.id = seg.id
   AND seg.dest IS NOT NULL
   AND seg.dest ~ '^[A-Za-z]{2}$';

-- Roll Booking countries up to the parent Trip when Trip's columns
-- are still null (covers trips whose intent had no iso2 but whose
-- bookings did).
UPDATE "trips" t
   SET "originCountry" = b.origin
  FROM (
    SELECT DISTINCT ON ("tripId")
      "tripId",
      "originCountry" AS origin
      FROM "bookings"
     WHERE "originCountry" IS NOT NULL
     ORDER BY "tripId", "createdAt" ASC
  ) b
 WHERE t.id = b."tripId"
   AND t."originCountry" IS NULL;

UPDATE "trips" t
   SET "destinationCountry" = b.dest
  FROM (
    SELECT DISTINCT ON ("tripId")
      "tripId",
      "destinationCountry" AS dest
      FROM "bookings"
     WHERE "destinationCountry" IS NOT NULL
     ORDER BY "tripId", "createdAt" ASC
  ) b
 WHERE t.id = b."tripId"
   AND t."destinationCountry" IS NULL;

CREATE INDEX "trips_tenantId_destinationCountry_idx"
  ON "trips" ("tenantId", "destinationCountry");

CREATE INDEX "bookings_tenantId_destinationCountry_idx"
  ON "bookings" ("tenantId", "destinationCountry");
