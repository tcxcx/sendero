-- Slack channel routing — set in the channel setup wizard, read by the
-- event dispatcher to decide where to post each Sendero event class
-- (trip events, settlements, cap warnings, escalations, silent).

ALTER TABLE "slack_installs"
    ADD COLUMN "routing" JSONB;
