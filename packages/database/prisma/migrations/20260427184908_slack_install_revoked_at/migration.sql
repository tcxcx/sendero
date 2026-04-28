-- Add a revoked-at marker to Slack installs so the events route can
-- record `tokens_revoked` / `app_uninstalled` without deleting the row.
-- Keeping the row preserves historical references (meter_events.userId
-- → SlackUserBinding → SlackInstall) and lets ops see when an
-- install died. New `installedAt > revokedAt` is the live-install
-- predicate.
ALTER TABLE "slack_installs" ADD COLUMN "revoked_at" TIMESTAMPTZ(6);

CREATE INDEX "slack_installs_revoked_at_idx" ON "slack_installs" ("revoked_at");
