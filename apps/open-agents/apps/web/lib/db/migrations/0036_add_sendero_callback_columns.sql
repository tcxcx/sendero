-- SENDERO bridge: per-session callback URL + secret + fired-at marker.
-- Populated by /api/sendero/dispatch when the dispatch payload includes a
-- callback field. The sendero-callback workflow polls these rows and POSTs
-- to sendero_callback_url when the session reaches terminal state.

ALTER TABLE "sessions"
  ADD COLUMN IF NOT EXISTS "sendero_callback_url" text,
  ADD COLUMN IF NOT EXISTS "sendero_callback_secret" text,
  ADD COLUMN IF NOT EXISTS "sendero_callback_fired_at" timestamp;

-- Index supports the polling workflow's hot query: find sessions with a
-- callback configured that haven't fired yet.
CREATE INDEX IF NOT EXISTS "sessions_sendero_callback_pending_idx"
  ON "sessions" ("status")
  WHERE "sendero_callback_url" IS NOT NULL AND "sendero_callback_fired_at" IS NULL;
