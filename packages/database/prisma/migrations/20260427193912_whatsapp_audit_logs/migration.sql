-- WhatsApp webhook + outbound audit logs.
--
-- Closes Bucket 5 (observability) gaps surfaced by /bucket-analysis:
-- inbound webhook-delivery audit + outbound message audit. Both tables
-- are append-mostly with one update path each (status webhook updates
-- the outbound row by wamid). Indexed for the common operator
-- queries: list-by-tenant-recent + lookup-by-wamid.

-- ─── inbound webhook deliveries ────────────────────────────────────
CREATE TABLE "whatsapp_webhook_events" (
  "id"                       TEXT          PRIMARY KEY,
  "tenant_id"                TEXT,
  "received_at"              TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- HMAC verify outcome — false here means the request was rejected
  -- (we still log it for forensics).
  "signature_valid"          BOOLEAN       NOT NULL,
  -- Did at least one normalized message timestamp fall within the
  -- replay window? null when the payload had no messages.
  "replay_window_ok"         BOOLEAN,
  -- sha256 of the raw body — useful to confirm we're seeing the same
  -- payload Meta sent (no shared-state mutation through proxies).
  "payload_hash"             TEXT          NOT NULL,
  "message_count"            INTEGER       NOT NULL DEFAULT 0,
  "identity_change_count"    INTEGER       NOT NULL DEFAULT 0,
  "status_update_count"      INTEGER       NOT NULL DEFAULT 0,
  "dropped_replay_count"     INTEGER       NOT NULL DEFAULT 0,
  "dropped_duplicate_count"  INTEGER       NOT NULL DEFAULT 0,
  "dispatched_count"         INTEGER       NOT NULL DEFAULT 0,
  "duration_ms"              INTEGER,
  "trace_id"                 TEXT,
  -- Optional raw envelope kept for forensics (off by default in prod
  -- to avoid storing customer message bodies; toggled per-tenant via
  -- WhatsAppInstall.metadata.auditRawPayloads).
  "raw_envelope"             JSONB
);

CREATE INDEX "whatsapp_webhook_events_tenant_received_idx"
  ON "whatsapp_webhook_events" ("tenant_id", "received_at" DESC);
CREATE INDEX "whatsapp_webhook_events_trace_idx"
  ON "whatsapp_webhook_events" ("trace_id");

-- ─── outbound messages ──────────────────────────────────────────────
-- One row per send, keyed on Meta's wamid for status webhook joins.
CREATE TABLE "whatsapp_outbound_messages" (
  "id"                  TEXT          PRIMARY KEY,
  "tenant_id"           TEXT          NOT NULL,
  "wamid"               TEXT          NOT NULL UNIQUE,
  "phone_number_id"     TEXT          NOT NULL,
  -- E.164 or BSUID, whichever was used as the recipient identifier.
  "recipient_id"        TEXT          NOT NULL,
  -- 'text' | 'template' | 'interactive' | 'image' | 'document' | 'video'
  -- | 'audio' | 'reaction' | 'location' | 'flow' — pass-through.
  "kind"                TEXT          NOT NULL,
  -- 'agent_reply' | 'otp' | 'security_alert' | 'manual' | 'broadcast' | etc.
  -- Lets ops separate "did the agent reply land?" from "did the OTP
  -- land?" without grepping handlers.
  "source"              TEXT          NOT NULL,
  -- Optional template name when `kind = template`.
  "template_name"       TEXT,
  -- Optional preview snippet, capped at 280 chars. PII-light by
  -- design — surfaced in the operator UI to make rows recognisable
  -- without paging into the full payload.
  "preview"             TEXT,
  "sent_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- Pass-through Meta status: 'sent' | 'delivered' | 'read' | 'failed'.
  -- Initialised to 'sent' on insert; overwritten by the status webhook.
  "delivery_status"     TEXT          NOT NULL DEFAULT 'sent',
  "failure_reason"      TEXT,
  "delivered_at"        TIMESTAMPTZ(6),
  "read_at"             TIMESTAMPTZ(6),
  "failed_at"           TIMESTAMPTZ(6),
  "trace_id"            TEXT,
  CONSTRAINT "whatsapp_outbound_messages_tenant_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "whatsapp_outbound_messages_tenant_sent_idx"
  ON "whatsapp_outbound_messages" ("tenant_id", "sent_at" DESC);
CREATE INDEX "whatsapp_outbound_messages_status_idx"
  ON "whatsapp_outbound_messages" ("tenant_id", "delivery_status");
CREATE INDEX "whatsapp_outbound_messages_source_idx"
  ON "whatsapp_outbound_messages" ("tenant_id", "source");
