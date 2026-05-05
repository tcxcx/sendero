-- Phase B.2 — digital nomad / "trip buddy" model.
--
-- Sendero shifts from "Trip = one round-trip booking" to "Trip = an
-- evolving journey": traveler books a leg, lands somewhere, decides
-- the next leg from there, repeats — until they say "take me home
-- Sendero" and we book the return. To support this:
--
--   1. Trip.kind enum so the lifecycle handler knows whether a Trip
--      should auto-complete after one round-trip (`one_way` /
--      `round_trip`) or stay open until the traveler explicitly heads
--      home (`open_journey`).
--   2. User.homeIata: the canonical "home" airport — the anchor
--      `take_me_home` resolves to. Backfilled at onboarding via the
--      agent prompt when missing.

CREATE TYPE "TripKind" AS ENUM ('one_way', 'round_trip', 'open_journey');

ALTER TABLE "trips"
  ADD COLUMN IF NOT EXISTS "kind" "TripKind" NOT NULL DEFAULT 'one_way';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "homeIata" TEXT;

CREATE INDEX IF NOT EXISTS "trips_tenantId_kind_idx" ON "trips"("tenantId", "kind");
