-- Credits + COGS — schema foundations.
--
-- Adds two enum values and two daily-cap tracking columns on Subscription
-- so the runtime can:
--  1. expose a `basic` BillingTier alongside the existing pro/business/enterprise
--  2. mark MeterEvents that were paid from the SaaS-included credit grant
--     instead of the live x402 USDC stream (excluded from settlement)
--  3. enforce a daily sub-cap (25% of monthly grant) atomically without a
--     daily-burn aggregate read on the hot path
--
-- Migration discipline (per CLAUDE.md migration-lint):
-- ALTER TYPE ADD VALUE statements are kept isolated from any TypeScript
-- code that references the new literals. Code references for `'basic'`
-- and `'credit'` land in subsequent commits, never in the same migration.

-- ── BillingTier: add `basic` ($19/mo tier) ────────────────────────
ALTER TYPE "BillingTier" ADD VALUE IF NOT EXISTS 'basic';

-- ── MeterStatus: add `credit` ─────────────────────────────────────
-- Rows with this status represent SaaS-included usage that does NOT
-- settle on-chain. NanopayBatch.findClaimableEvents must skip them
-- alongside the existing 'sandbox' filter.
ALTER TYPE "MeterStatus" ADD VALUE IF NOT EXISTS 'credit';

-- ── Subscription daily-cap tracking ───────────────────────────────
-- Persisted on the row so the atomic balance-deduct UPDATE can
-- include the daily check in its WHERE clause (no race against
-- aggregate reads). Reset by the preflight when wall clock crosses
-- dailyWindowStartedAt + 24h.
ALTER TABLE "subscriptions"
  ADD COLUMN "dailyCreditBurnMicro"  BIGINT       NOT NULL DEFAULT 0,
  ADD COLUMN "dailyWindowStartedAt"  TIMESTAMPTZ(6);
