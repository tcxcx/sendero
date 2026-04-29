-- Phase 2 P2.2 — enforce one wallet per (tenant, kind, chain).
--
-- Phase 1 added a non-unique (tenantId, kind, chain) index for fast
-- per-chain ops DCW lookups. Phase 2 promotes that to a UNIQUE
-- constraint so race-safe insert paths can rely on the constraint
-- instead of pre-checking. Closes:
--
--   - Two concurrent organization.created webhooks (svix at-least-once)
--     both calling provisionTenantOpsDcw — without unique, both could
--     CREATE rows with the same (tenant, kind, chain).
--   - Phase 2 backfill cron + login backfill hook racing on the same
--     (tenant, chain).
--
-- Two-step migration to fail safely on any pre-existing duplicates:
--   Step 1 (this file): CREATE UNIQUE INDEX CONCURRENTLY. Fails loud
--                       with the offending tuple if dupes exist; never
--                       locks the table for writes either way.
--   Step 2 (separate):  ALTER TABLE ADD CONSTRAINT ... USING INDEX —
--                       metadata-only, instant.
--
-- PostgreSQL note: UNIQUE constraints don't support NOT VALID (that's
-- CHECK / FOREIGN KEY only). The CONCURRENTLY index is the production-
-- grade equivalent — index creation surfaces duplicates with a clear
-- error including the tenantId + kind + chain values, without holding
-- the table lock that a plain `ADD CONSTRAINT UNIQUE` would.
--
-- This file is intentionally NOT wrapped in BEGIN/COMMIT — Prisma on
-- Postgres doesn't wrap migrations in a transaction by default, and
-- CONCURRENTLY operations CANNOT run inside a transaction.
--
-- If this migration fails with a "could not create unique index"
-- error, the deployer's recovery path:
--   1. Read the error — Postgres logs the offending tuple.
--   2. Investigate the duplicate (manually pick the canonical row;
--      archive the stale circle_wallet_id Circle-side).
--   3. Re-run the migration after dedup. The unique index creation
--      is idempotent (IF NOT EXISTS).

DROP INDEX CONCURRENTLY IF EXISTS "circle_wallets_tenantId_kind_chain_idx";

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
  "circle_wallets_tenantId_kind_chain_key"
  ON "circle_wallets" ("tenantId", "kind", "chain");
