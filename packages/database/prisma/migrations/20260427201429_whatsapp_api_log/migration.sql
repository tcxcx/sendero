-- WhatsApp external API audit log.
--
-- Closes the last ◐ in Bucket 5: every outbound API call we make to
-- Kapso (health pings, setup links, template publishing) and Meta
-- Cloud API (sends, media uploads, template CRUD) lands here. Failed
-- calls + slow calls (durationMs) are the high-signal rows for ops.
--
-- Pure audit — append-only, no FK on tenant so calls without a
-- resolved tenant (e.g. install-time setup links before tenant is
-- bound) still record. Index supports the inbox UI's
-- "last N calls per tenant" query.

CREATE TABLE "whatsapp_api_logs" (
  "id"             TEXT          PRIMARY KEY,
  "tenant_id"      TEXT,
  "called_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  -- 'kapso' | 'meta' (more later if we add Twilio fallback / etc.)
  "target"         TEXT          NOT NULL,
  -- HTTP method — pass-through.
  "method"         TEXT          NOT NULL,
  -- Endpoint path / shape, e.g. '/platform/v1/customers/{id}/setup_links'
  -- or '/{phone_number_id}/messages'. Path params replaced with `{}` so
  -- rows aggregate cleanly per endpoint shape.
  "endpoint"       TEXT          NOT NULL,
  -- HTTP status code returned. 0 if the request never completed
  -- (DNS / network / timeout).
  "status_code"    INTEGER       NOT NULL,
  "duration_ms"    INTEGER       NOT NULL,
  "ok"             BOOLEAN       NOT NULL,
  -- Compact error message on non-2xx — first 280 chars of body.
  "error_message"  TEXT,
  -- Optional correlation back to the inbound webhook this call was
  -- triggered by (status webhook → reconcile, etc).
  "trace_id"       TEXT
);

CREATE INDEX "whatsapp_api_logs_tenant_called_idx"
  ON "whatsapp_api_logs" ("tenant_id", "called_at" DESC);
CREATE INDEX "whatsapp_api_logs_target_called_idx"
  ON "whatsapp_api_logs" ("target", "called_at" DESC);
CREATE INDEX "whatsapp_api_logs_failed_idx"
  ON "whatsapp_api_logs" ("tenant_id", "ok", "called_at" DESC) WHERE "ok" = false;
