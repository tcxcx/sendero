-- Allow the shared Kapso sandbox phone to have one install row per tenant.
-- Exactly one active row per provider phone remains enforced below.

DROP INDEX IF EXISTS "whatsapp_installs_phoneNumberId_key";
DROP INDEX IF EXISTS "whatsapp_installs_kapsoConnectionId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_installs_tenantId_phoneNumberId_key"
  ON "whatsapp_installs"("tenantId", "phoneNumberId");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_installs_tenantId_kapsoConnectionId_key"
  ON "whatsapp_installs"("tenantId", "kapsoConnectionId");

CREATE INDEX IF NOT EXISTS "whatsapp_installs_kapsoConnectionId_idx"
  ON "whatsapp_installs"("kapsoConnectionId");

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_installs_active_phoneNumberId_key"
  ON "whatsapp_installs"("phoneNumberId")
  WHERE "phoneNumberId" IS NOT NULL AND "status" = 'active';
