-- Phase 2 P2.2 — enforce one wallet per (tenant, kind, chain).
--
-- Phase 1 added a non-unique (tenantId, kind, chain) index for fast
-- per-chain ops DCW lookups. Phase 2 promotes that to UNIQUE so race-
-- safe insert paths can rely on the constraint instead of pre-checking.
--
-- Race scenarios this closes:
--   - Two concurrent organization.created webhooks (svix at-least-once)
--     both call provisionTenantOpsDcw → without unique, both could
--     CREATE rows with the same (tenant, kind, chain), yielding two
--     ops DCWs and Circle SDK + DB drift.
--   - Phase 2 backfill cron + login hook race on the same tenant.
--
-- Phase 2 wallets currently exist for one (tenant, kind='treasury',
-- chain='ARC-TESTNET') row per tenant + zero or one (tenant,
-- kind='operations', chain='ARC-TESTNET') row per tenant. Both
-- already satisfy the unique constraint by construction; the audit
-- query below verifies this before promotion.
--
-- Pre-flight audit (run via Supabase MCP / psql before migrating):
--   SELECT "tenantId", kind, chain, COUNT(*)
--   FROM   "circle_wallets"
--   GROUP  BY "tenantId", kind, chain
--   HAVING COUNT(*) > 1;
--
--   Expected: zero rows. If any duplicates show up, dedup them
--   manually (keep the row Circle SDK still recognizes, archive the
--   stale row's circle_wallet_id) BEFORE running this migration.
--
-- Forward-compat: when Phase 3 adds AVAX-FUJI, no migration change
-- needed — the (AVAX-FUJI) ops DCW lands as a fresh row with the
-- same constraint.

BEGIN;

-- Drop the non-unique index — UNIQUE will replace it. Keep the
-- separate (tenantId, kind) index intact (it's used by listings that
-- don't filter by chain).
DROP INDEX IF EXISTS "circle_wallets_tenantId_kind_chain_idx";

-- Add UNIQUE constraint. PostgreSQL implicitly creates a backing
-- unique index, which serves the same lookup pattern the old non-
-- unique index did. The named constraint matches Prisma's expected
-- shape (`tenantId_kind_chain`) so prisma migrate diff stays clean.
ALTER TABLE "circle_wallets"
  ADD CONSTRAINT "circle_wallets_tenantId_kind_chain_key"
  UNIQUE ("tenantId", "kind", "chain");

COMMIT;
