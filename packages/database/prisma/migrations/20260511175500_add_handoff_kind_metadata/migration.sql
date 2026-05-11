-- Add `kind` discriminator + `metadata` JSONB to ChannelHandoff so we
-- can reuse the same table for both support-question handoffs (the
-- existing path) and policy-driven booking approvals (B2B2B Phase 3).
--
-- `kind` defaults to 'support_question' so existing rows backfill
-- cleanly with no app-level rewrite. New approval-request rows set
-- kind='approval_request' and stash policy / price / route context in
-- `metadata`.

ALTER TABLE "channel_handoffs"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'support_question',
  ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Existing index on (tenantId, status, createdAt) still covers the
-- common operator-dashboard query; add a partial index for the
-- approval pane so it stays cheap even as ChannelHandoff grows.
CREATE INDEX IF NOT EXISTS "channel_handoffs_approval_idx"
  ON "channel_handoffs" ("tenantId", "status", "createdAt")
  WHERE "kind" = 'approval_request';
