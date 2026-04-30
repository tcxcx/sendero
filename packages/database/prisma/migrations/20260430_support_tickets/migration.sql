CREATE TABLE IF NOT EXISTS "support_tickets" (
  "id" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'normal',
  "source" TEXT NOT NULL DEFAULT 'whatsapp',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "assignee_name" TEXT,
  "assignee_email" TEXT,
  "assignee_slack_user_id" TEXT,
  "whatsapp_conversation_id" TEXT,
  "whatsapp_phone_number" TEXT,
  "whatsapp_profile_name" TEXT,
  "workflow_execution_id" TEXT,
  "slack_channel_id" TEXT,
  "slack_message_ts" TEXT,
  "raw_context" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "closed_at" TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS "support_tickets_tenant_status_created_idx"
  ON "support_tickets" ("tenant_id", "status", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "support_tickets_slack_thread_idx"
  ON "support_tickets" ("slack_channel_id", "slack_message_ts");

CREATE INDEX IF NOT EXISTS "support_tickets_workflow_execution_idx"
  ON "support_tickets" ("workflow_execution_id");
