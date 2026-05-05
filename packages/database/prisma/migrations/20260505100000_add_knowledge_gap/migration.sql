-- KnowledgeGap — agent-reported observability for missing tools / docs / env.
-- See packages/tools/src/report-knowledge-gap.ts.

-- Enums
CREATE TYPE "KnowledgeGapKind" AS ENUM (
  'tool_input_mismatch',
  'tool_not_found',
  'tool_error_unrecoverable',
  'instruction_missing',
  'env_missing',
  'schema_drift',
  'runtime_constraint',
  'other'
);

CREATE TYPE "KnowledgeGapSeverity" AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE "KnowledgeGapStatus" AS ENUM (
  'open',
  'triaged',
  'in_progress',
  'resolved',
  'duplicate',
  'wontfix'
);

-- Table
CREATE TABLE "knowledge_gaps" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL,
  "trace_id" TEXT,
  "kind" "KnowledgeGapKind" NOT NULL,
  "severity" "KnowledgeGapSeverity" NOT NULL DEFAULT 'medium',
  "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'open',
  "tool_name" TEXT,
  "error_message" TEXT NOT NULL,
  "attempted_input" JSONB,
  "hypothesis" TEXT NOT NULL,
  "suggested_fix" TEXT,
  "blocking_traveler" BOOLEAN NOT NULL DEFAULT false,
  "channel_kind" TEXT,
  "surface" TEXT,
  "reported_by_user_id" TEXT,
  "resolved_at" TIMESTAMPTZ(6),
  "resolution_note" TEXT,
  "resolution_pr_url" TEXT,
  "dedup_key" TEXT NOT NULL,
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

-- Dedup constraint — one row per (tenant, dedupKey). Same agent
-- complaint across turns increments `occurrence_count` instead of
-- piling up duplicates. CONCURRENTLY is intentionally omitted on
-- table-create — the table is empty so there's nothing to lock.
CREATE UNIQUE INDEX "knowledge_gaps_tenant_dedup_unique"
  ON "knowledge_gaps" ("tenant_id", "dedup_key");

-- Read paths the scanner + dashboard exercise:
--   1. "show me open critical/high gaps" → tenant + status + severity.
--   2. "where are tool_input_mismatch gaps?" → tenant + kind + status.
--   3. "all gaps for tool X" → tool_name + status.
--   4. "this trace's gaps" → trace_id.
CREATE INDEX "knowledge_gaps_tenant_status_severity_lastseen_idx"
  ON "knowledge_gaps" ("tenant_id", "status", "severity", "last_seen_at" DESC);
CREATE INDEX "knowledge_gaps_tenant_kind_status_idx"
  ON "knowledge_gaps" ("tenant_id", "kind", "status");
CREATE INDEX "knowledge_gaps_tool_status_idx"
  ON "knowledge_gaps" ("tool_name", "status");
CREATE INDEX "knowledge_gaps_trace_idx"
  ON "knowledge_gaps" ("trace_id");
