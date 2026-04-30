CREATE TABLE IF NOT EXISTS "support_context_sessions" (
  "code" TEXT PRIMARY KEY,
  "tenant_id" TEXT NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "context" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "expires_at" TIMESTAMPTZ NOT NULL,
  "last_used_at" TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS "support_context_sessions_tenant_created_idx"
  ON "support_context_sessions" ("tenant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "support_context_sessions_expires_idx"
  ON "support_context_sessions" ("expires_at");
