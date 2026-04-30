-- Phase 2 P2.2 step 2 — promote the unique index to a UNIQUE constraint.
--
-- Step 1 (20260428210000_circle_wallets_unique_per_chain) creates
-- "circle_wallets_tenantId_kind_chain_key" as a unique index using
-- CONCURRENTLY so it fails safely on any pre-existing duplicates
-- without locking the table.
--
-- This step wraps the index in a UNIQUE constraint so:
--   1. Prisma's introspection treats it as @@unique (matches the
--      schema.prisma definition).
--   2. Insert-path P2002 errors carry the constraint name, not just
--      a generic index violation. backfill helpers detect P2002 by
--      this name to absorb concurrent races as no-ops.
--
-- ALTER TABLE ... ADD CONSTRAINT ... UNIQUE USING INDEX is a
-- metadata-only operation when the index already exists. Instant,
-- no table lock, safe to run inline.

BEGIN;

ALTER TABLE "circle_wallets"
  ADD CONSTRAINT "circle_wallets_tenantId_kind_chain_key"
  UNIQUE USING INDEX "circle_wallets_tenantId_kind_chain_key";

COMMIT;
