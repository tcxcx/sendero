-- Group-broadcast columns — closure #6 (broadcast_to_group_trip).
-- Additive only. WhatsAppOutboundMessage gains group context for
-- per-recipient roll-up; GroupTripPassenger gains opt-out flag.
-- See packages/tools/src/group-trips.ts (broadcast_to_group_trip).

-- Per-passenger opt-out. Existing rows default to false (legacy
-- passengers were never asked, so they remain in scope until they
-- actively send "stop"/"unsubscribe"/"baja" inside a group thread).
ALTER TABLE "group_trip_passengers"
  ADD COLUMN "broadcast_opted_out" BOOLEAN NOT NULL DEFAULT false;

-- Outbound roll-up. Both columns are nullable — only group-broadcast
-- sends populate them (`source = 'group_broadcast'`). Older rows stay
-- NULL.
ALTER TABLE "whatsapp_outbound_messages"
  ADD COLUMN "group_trip_id" TEXT,
  ADD COLUMN "broadcast_id"  TEXT;

-- Hot read path: roster delivery roll-up by (groupTripId, broadcastId).
CREATE INDEX "whatsapp_outbound_messages_group_trip_id_broadcast_id_idx"
  ON "whatsapp_outbound_messages" ("group_trip_id", "broadcast_id");
