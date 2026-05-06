-- Anticipation taste graph — three tables that anchor HP1 (Hobby-Aware
-- Concierge), HP2 (Monocle-Level Taste Engine), HP3 (Romantic Concierge),
-- and the cross-cutting B10 anticipation safety / opt-out / observability.
--
-- Spec: docs/specs/anticipatory-concierge.md §4.0 + Appendix A.

-- ── BucketListItemStatus enum ───────────────────────────────────────

CREATE TYPE "BucketListItemStatus" AS ENUM (
  'want_to_visit',
  'visited',
  'loved',
  'skip',
  'revisit'
);

-- ── traveler_taste_entries ──────────────────────────────────────────
-- Row-per-hobby. Recommended over a JSON column for queryability,
-- audit, and per-hobby back-out. Composes existing
-- save-traveler-preference + visited-cities trail into a structured
-- taste graph the agent reads at every turn.

CREATE TABLE "traveler_taste_entries" (
  "id"                       TEXT PRIMARY KEY,
  "userId"                   TEXT NOT NULL,
  "tenantId"                 TEXT NOT NULL,

  -- Hobby key. Spec lists canonical values; custom strings allowed
  -- for traveler-defined hobbies.
  "key"                      TEXT NOT NULL,

  "priority"                 TEXT NOT NULL DEFAULT 'medium',
  "notes"                    TEXT,
  "avoid"                    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "preferred_time_of_day"    TEXT,
  "preferred_budget"         TEXT,

  "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"               TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "traveler_taste_entries_user_fk" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE,

  CONSTRAINT "traveler_taste_entries_tenant_fk" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "traveler_taste_entries_user_key_unique"
  ON "traveler_taste_entries" ("userId", "key");

CREATE INDEX "traveler_taste_entries_tenant_key_idx"
  ON "traveler_taste_entries" ("tenantId", "key");

-- ── city_bucket_list_items ──────────────────────────────────────────
-- Save / love / skip / revisit / recommend-to-friend feedback loop.
-- Every action improves future ranking via the taste graph.

CREATE TABLE "city_bucket_list_items" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,

  "city"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT NOT NULL,
  "place_id"    TEXT,
  "url"         TEXT,

  "status"      "BucketListItemStatus" NOT NULL DEFAULT 'want_to_visit',

  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "city_bucket_list_items_user_fk" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE,

  CONSTRAINT "city_bucket_list_items_tenant_fk" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "city_bucket_list_items_user_city_idx"
  ON "city_bucket_list_items" ("userId", "city");

CREATE INDEX "city_bucket_list_items_tenant_status_idx"
  ON "city_bucket_list_items" ("tenantId", "status");

-- ── anticipation_events ─────────────────────────────────────────────
-- Append-only log of every fired anticipation trigger.
-- Powers operator-strip counters + frequency-cap quota in B10.

CREATE TABLE "anticipation_events" (
  "id"                  TEXT PRIMARY KEY,
  "tenantId"            TEXT NOT NULL,
  "traveler_user_id"    TEXT,

  "kind"                TEXT NOT NULL,
  "status"              TEXT NOT NULL DEFAULT 'fired',

  "fired_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "payload"             JSONB,

  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "anticipation_events_tenant_fk" FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "anticipation_events_tenant_fired_idx"
  ON "anticipation_events" ("tenantId", "fired_at" DESC);

CREATE INDEX "anticipation_events_tenant_kind_fired_idx"
  ON "anticipation_events" ("tenantId", "kind", "fired_at" DESC);
