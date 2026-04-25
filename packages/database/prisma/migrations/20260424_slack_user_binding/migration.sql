-- Slack-driven agent turns previously stamped meter_events.userId with
-- the workspace admin's User row (the Slack install's authedUserId),
-- regardless of which Slack member actually triggered the turn. That
-- broke per-user spend caps, analytics, and audit trails.
--
-- Fix: cache (tenantId, slackTeamId, slackUserId) -> Sendero User.id in
-- the new `slack_user_bindings` table, and auto-provision a User row
-- the first time we see a Slack member who isn't yet in our system.
--
-- To support auto-provisioning before the human ever signs up via
-- Clerk:
--   1. Make `users.clerkUserId` nullable (Postgres @unique allows
--      multiple NULLs, so this is safe).
--   2. Add a new `UserSource` enum + `users.source` column with
--      default 'native' so existing rows are unaffected.
--
-- Backwards-compat:
--   * Existing User rows: `source` defaults to 'native', `clerkUserId`
--     keeps its current value.
--   * The Clerk `user.created` webhook upsert already keys on
--     `clerkUserId`; nullable column is only an issue for code that
--     dereferences the field, which we've audited.

-- 1. UserSource enum.
CREATE TYPE "UserSource" AS ENUM ('native', 'slack', 'whatsapp', 'guest');

-- 2. Add `source` column to users with default. Existing rows keep
--    behaviour by inheriting `native`. NOT NULL is safe because the
--    DEFAULT backfills automatically (Postgres metadata-only change
--    on PG 11+).
ALTER TABLE "users"
  ADD COLUMN "source" "UserSource" NOT NULL DEFAULT 'native';

-- 3. Make clerkUserId nullable so Slack-/WhatsApp-provisioned User
--    rows can exist without a Clerk identity. The unique index keeps
--    NULLs distinct in Postgres so multiple provisional users coexist.
ALTER TABLE "users"
  ALTER COLUMN "clerkUserId" DROP NOT NULL;

-- 4. slack_user_bindings cache. One row per (tenant, team, slack user).
CREATE TABLE "slack_user_bindings" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "slackTeamId"   TEXT NOT NULL,
    "slackUserId"   TEXT NOT NULL,
    "senderoUserId" TEXT NOT NULL,
    "email"         TEXT,
    "resolvedAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "slack_user_bindings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slack_user_bindings_tenantId_slackTeamId_slackUserId_key"
    ON "slack_user_bindings"("tenantId", "slackTeamId", "slackUserId");
CREATE INDEX "slack_user_bindings_tenantId_idx"
    ON "slack_user_bindings"("tenantId");
CREATE INDEX "slack_user_bindings_senderoUserId_idx"
    ON "slack_user_bindings"("senderoUserId");

ALTER TABLE "slack_user_bindings"
    ADD CONSTRAINT "slack_user_bindings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slack_user_bindings"
    ADD CONSTRAINT "slack_user_bindings_senderoUserId_fkey"
    FOREIGN KEY ("senderoUserId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
