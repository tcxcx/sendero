-- Phase C-2 — cross-channel notification dispatcher tables.
--
-- Two new tables, both empty at create time so indexes are instant
-- (no CONCURRENTLY needed). The migration-lint rule in lefthook
-- targets ALTER TYPE ADD VALUE patterns + nullable→not-null on
-- existing tables; CREATE TABLE on greenfield is safe.

-- NotificationDispatch — correlation envelope for cross-channel sends.
-- The (tenantId, dedupKey, channelKind) UNIQUE constraint is the
-- idempotency lock for the parallel-fire-with-dedupKey migration
-- pattern (locked /plan-eng-review E5).
CREATE TABLE "notification_dispatch" (
    "id"            TEXT NOT NULL,
    "tenantId"      TEXT NOT NULL,
    "sourceKind"    TEXT NOT NULL,
    "sourceId"      TEXT NOT NULL,
    "eventKind"     TEXT NOT NULL,
    "dedupKey"      TEXT NOT NULL,
    "channelKind"   TEXT NOT NULL,
    "recipients"    JSONB NOT NULL,
    "snapshotPrefs" JSONB NOT NULL,
    "status"        TEXT NOT NULL,
    "triggeredBy"   TEXT NOT NULL,
    "dispatchedAt"  TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_dispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_dispatch_tenantId_dedupKey_channelKind_key"
    ON "notification_dispatch"("tenantId", "dedupKey", "channelKind");

CREATE INDEX "notification_dispatch_tenantId_eventKind_dispatchedAt_idx"
    ON "notification_dispatch"("tenantId", "eventKind", "dispatchedAt");

CREATE INDEX "notification_dispatch_tenantId_sourceKind_sourceId_idx"
    ON "notification_dispatch"("tenantId", "sourceKind", "sourceId");

-- UserNotificationPref — per-user channel preferences for each event
-- kind. text[] over junction table per /plan-eng-review E3.
CREATE TABLE "user_notification_pref" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "eventKind" TEXT NOT NULL,
    "channels"  TEXT[] NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_notification_pref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_notification_pref_userId_tenantId_eventKind_key"
    ON "user_notification_pref"("userId", "tenantId", "eventKind");

CREATE INDEX "user_notification_pref_tenantId_eventKind_idx"
    ON "user_notification_pref"("tenantId", "eventKind");
