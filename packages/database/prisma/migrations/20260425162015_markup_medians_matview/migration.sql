-- Markup recommendation pipeline (Track E4) — materialized view + indices.
--
-- Surfaces a per-tenant per-kind median markup over the rolling 90-day
-- window. The agent-facing `get_tenant_pricing_policy` MCP tool reads
-- from this view to produce the `recommendation` field; the activation
-- wizard sidebar reads it for the "Your historical median: hotels 11.4%"
-- panel; the cron at /api/cron/refresh-markup-medians refreshes nightly.
--
-- Why a materialized view (vs. live SQL on every read):
--   - Median computation is O(N log N) per tenant per kind. With 10k
--     tenants × 5 kinds = 50k computations / day if the cron is daily.
--   - Recomputing on every API call would burn DB cycles for what is
--     effectively a snapshot that drifts slowly (median over 90 days
--     barely moves day-to-day).
--   - A matview lets us refresh CONCURRENTLY so reads never block.
--
-- Why 90 days:
--   - Long enough to smooth seasonal noise (Christmas / summer travel
--     shapes the per-kind medians markedly).
--   - Short enough to let a tenant who deliberately changes pricing
--     see their median move within a quarter.
--   - Matches the rolling window used by the GMV dashboard (D4).
--
-- Eligibility threshold (sample_count >= 100 for the recommendation to
-- surface) is enforced at the QUERY layer, not in the matview, so we
-- can tweak it without re-DDL'ing the schema.

BEGIN;

-- A unique index on the matview is REQUIRED for `REFRESH MATERIALIZED
-- VIEW CONCURRENTLY`. Without it, refresh would lock readers — the
-- whole point of the matview is read availability.
CREATE MATERIALIZED VIEW "tenant_markup_medians" AS
SELECT
  "tenantId",
  "kind"::text AS "kind",
  -- PERCENTILE_CONT returns a double for an integer column; round to int.
  -- A bps value is always integer, so 0.5 fractional differences are
  -- noise. Cast to integer once here so downstream consumers don't.
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "markupBps"::numeric))::integer AS "median_bps",
  COUNT(*)::integer AS "sample_count",
  MAX("createdAt")    AS "latest_booking_at",
  MIN("createdAt")    AS "earliest_booking_at",
  NOW()               AS "computed_at"
FROM "bookings"
WHERE
  "markupBps" IS NOT NULL
  -- Exclude the v1 backfilled rows (they're sold cost-plus-only,
  -- markupBps is null on those — but defense in depth).
  AND "markupBps" > 0
  AND "createdAt" >= NOW() - INTERVAL '90 days'
GROUP BY "tenantId", "kind"::text;

-- Required for CONCURRENT refresh.
CREATE UNIQUE INDEX "tenant_markup_medians_pk"
  ON "tenant_markup_medians" ("tenantId", "kind");

-- Read-side index: agent tool queries by (tenantId, kind) → covered
-- by the unique index above; no additional read index needed.

COMMIT;
