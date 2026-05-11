-- Slack channel observability parity with WhatsApp.
-- These tables are append-only operational audit logs. They are written
-- fail-soft from the webhook/agent hot path and read by the Slack inbox
-- audit page when a thread gets stuck mid-turn.

CREATE TABLE IF NOT EXISTS "slack_webhook_events" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenant_id" TEXT,
  "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "team_id" TEXT NOT NULL,
  "enterprise_id" TEXT,
  "event_id" TEXT,
  "event_type" TEXT,
  "event_subtype" TEXT,
  "channel_id" TEXT,
  "thread_ts" TEXT,
  "slack_user_id" TEXT,
  "signature_valid" BOOLEAN NOT NULL,
  "replay_window_ok" BOOLEAN,
  "message_count" INTEGER NOT NULL DEFAULT 0,
  "dropped_duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "dropped_busy_count" INTEGER NOT NULL DEFAULT 0,
  "dispatched_count" INTEGER NOT NULL DEFAULT 0,
  "dispatch_status" TEXT NOT NULL DEFAULT 'processed',
  "dispatch_error" TEXT,
  "duration_ms" INTEGER,
  "trace_id" TEXT,
  "payload_hash" TEXT,
  "raw_envelope" JSONB
);

CREATE INDEX IF NOT EXISTS "slack_webhook_events_tenant_received_idx"
  ON "slack_webhook_events" ("tenant_id", "received_at" DESC);
CREATE INDEX IF NOT EXISTS "slack_webhook_events_trace_idx"
  ON "slack_webhook_events" ("trace_id");
CREATE INDEX IF NOT EXISTS "slack_webhook_events_event_idx"
  ON "slack_webhook_events" ("event_id");
CREATE INDEX IF NOT EXISTS "slack_webhook_events_team_thread_idx"
  ON "slack_webhook_events" ("team_id", "channel_id", "thread_ts", "received_at" DESC);

CREATE TABLE IF NOT EXISTS "slack_agent_events" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "tenant_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "trace_id" TEXT,
  "event_id" TEXT,
  "turn_id" TEXT,
  "team_id" TEXT NOT NULL,
  "enterprise_id" TEXT,
  "channel_id" TEXT NOT NULL,
  "thread_ts" TEXT NOT NULL,
  "slack_user_id" TEXT,
  "sendero_user_id" TEXT,
  "trip_id" TEXT,
  "sequence" INTEGER NOT NULL DEFAULT 0,
  "kind" TEXT NOT NULL,
  "tool_name" TEXT,
  "ok" BOOLEAN,
  "duration_ms" INTEGER,
  "status_text" TEXT,
  "error_message" TEXT,
  "metadata" JSONB
);

CREATE INDEX IF NOT EXISTS "slack_agent_events_tenant_created_idx"
  ON "slack_agent_events" ("tenant_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "slack_agent_events_trace_seq_idx"
  ON "slack_agent_events" ("trace_id", "sequence");
CREATE INDEX IF NOT EXISTS "slack_agent_events_team_thread_idx"
  ON "slack_agent_events" ("team_id", "channel_id", "thread_ts", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "slack_agent_events_kind_created_idx"
  ON "slack_agent_events" ("kind", "created_at" DESC);
