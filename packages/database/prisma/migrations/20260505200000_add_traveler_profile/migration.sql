-- TravelerProfile — per-traveler memory + accumulated preferences.
-- Read once per turn during prefetch_trip; written fire-and-forget by
-- ancillary tools. The backbone of cross-trip "magic".
--
-- Spec: docs/architecture/concierge-magic.md §2.1.

CREATE TABLE "traveler_profiles" (
  "id"               TEXT PRIMARY KEY,
  "userId"           TEXT NOT NULL UNIQUE,
  "tenantId"         TEXT NOT NULL,

  -- Accumulated preferences. Defaults are empty arrays so the row is
  -- safe to read immediately after insert without null-handling at
  -- every consumer.
  "dietary"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "allergies"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pace"             TEXT,
  "voicePreferred"   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Travel patterns. preferredCabin is sticky across trips (most-recent
  -- non-default wins); search defaults read this but never lock.
  "preferredCabin"   TEXT,
  "redEyeOK"         BOOLEAN NOT NULL DEFAULT TRUE,
  "layoverMaxMin"    INTEGER,
  "preferredLang"    TEXT,

  -- Memory. visitedCities JSON shape:
  --   [{ iso2: 'PE', citySlug: 'lima', lastVisitedAt: ISO }]
  "visitedCities"    JSONB NOT NULL DEFAULT '[]'::JSONB,
  "totalTrips"       INTEGER NOT NULL DEFAULT 0,
  "lastTripAt"       TIMESTAMPTZ(6),

  -- Loyalty programmes accumulated from book_flight inputs.
  -- Shape: { airlines: { AA: '12345' }, hotels: { HH: '99' } }.
  "loyaltyAccounts"  JSONB,

  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "traveler_profiles_user_fk" FOREIGN KEY ("userId")
    REFERENCES "users" ("id") ON DELETE CASCADE,
  CONSTRAINT "traveler_profiles_tenant_fk" FOREIGN KEY ("tenantId")
    REFERENCES "tenants" ("id") ON DELETE CASCADE
);

-- Hot read path: prefetch_trip filters by tenant + lastTripAt order.
CREATE INDEX "traveler_profiles_tenant_last_trip_idx"
  ON "traveler_profiles" ("tenantId", "lastTripAt" DESC);
