-- Operator chat sessions — persisted history for the MetaInbox
-- console's CHAT MODE tab.
--
-- One ChatSession per useChat instance, one ChatMessage per UIMessage
-- (role + parts array verbatim). `tripId` is nullable: a chat can
-- start unattached and be promoted to a trip later, or many chats can
-- attach to the same trip over its life. Operator can re-view either
-- view (chat or trip) without losing the other.
--
-- Cascade rules:
--   tenant deleted   → all chat sessions purged (RGPD safe)
--   user deleted     → SetNull (chat survives, just orphaned)
--   trip deleted     → SetNull (chat survives, detached from trip)
--   session deleted  → all messages purged

CREATE TABLE "chat_sessions" (
    "id"        TEXT           NOT NULL,
    "tenantId"  TEXT           NOT NULL,
    "userId"    TEXT,
    "title"     TEXT,
    "tripId"    TEXT,
    "metadata"  JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_sessions_tenantId_createdAt_idx"
  ON "chat_sessions"("tenantId", "createdAt");
CREATE INDEX "chat_sessions_userId_createdAt_idx"
  ON "chat_sessions"("userId", "createdAt");
CREATE INDEX "chat_sessions_tripId_idx"
  ON "chat_sessions"("tripId");

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "chat_sessions"
  ADD CONSTRAINT "chat_sessions_tripId_fkey"
  FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "chat_messages" (
    "id"            UUID           NOT NULL DEFAULT gen_random_uuid(),
    "chatSessionId" TEXT           NOT NULL,
    "role"          TEXT           NOT NULL,
    "content"       TEXT           NOT NULL DEFAULT '',
    "parts"         JSONB,
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chat_messages_chatSessionId_createdAt_idx"
  ON "chat_messages"("chatSessionId", "createdAt");

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_chatSessionId_fkey"
  FOREIGN KEY ("chatSessionId") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
