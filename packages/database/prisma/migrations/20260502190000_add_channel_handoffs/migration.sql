-- ChannelHandoff: human-handoff escalation rows for the WhatsApp/Slack/web
-- agent. Mirrors the Kapso support-agent example's `ask_team_question`
-- pattern but terminates in Sendero's own operator surface (MetaInbox,
-- trip inbox, Liveblocks inbox notifications). Lifecycle: pending →
-- answered → closed.
CREATE TABLE "channel_handoffs" (
  "id"                 TEXT PRIMARY KEY,
  "tenantId"           TEXT NOT NULL,
  "tripId"             TEXT,
  "channelIdentityId"  UUID NOT NULL,
  "channel"            TEXT NOT NULL,
  "inboundMessageId"   TEXT,
  "question"           TEXT NOT NULL,
  "summary"            TEXT,
  "status"             TEXT NOT NULL DEFAULT 'pending',
  "liveblocksRoomId"   TEXT NOT NULL,
  "answer"             TEXT,
  "answeredByUserId"   TEXT,
  "answeredAt"         TIMESTAMPTZ(6),
  "closedAt"           TIMESTAMPTZ(6),
  "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt"          TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "channel_handoffs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "channel_handoffs_tripId_fkey"
    FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL,
  CONSTRAINT "channel_handoffs_channelIdentityId_fkey"
    FOREIGN KEY ("channelIdentityId") REFERENCES "channel_identities"("id") ON DELETE CASCADE,
  CONSTRAINT "channel_handoffs_answeredByUserId_fkey"
    FOREIGN KEY ("answeredByUserId") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "channel_handoffs_tenantId_status_createdAt_idx"
  ON "channel_handoffs" ("tenantId", "status", "createdAt");
CREATE INDEX "channel_handoffs_tenantId_tripId_idx"
  ON "channel_handoffs" ("tenantId", "tripId");
CREATE INDEX "channel_handoffs_channelIdentityId_idx"
  ON "channel_handoffs" ("channelIdentityId");
