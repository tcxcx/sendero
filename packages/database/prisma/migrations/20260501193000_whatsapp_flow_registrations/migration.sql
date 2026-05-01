-- Sendero-owned registry of WhatsApp Flow IDs per tenant phone number.
-- Kapso tenant functions resolve Flow IDs from Sendero at send time,
-- avoiding per-tenant Flow environment variables in Kapso.

CREATE TABLE "whatsapp_flow_registrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "phoneNumberId" TEXT NOT NULL,
  "flowKey" TEXT NOT NULL,
  "kapsoFlowId" TEXT NOT NULL,
  "metaFlowId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "mode" TEXT NOT NULL DEFAULT 'draft',
  "name" TEXT,
  "dataEndpointId" TEXT,
  "lastError" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_flow_registrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_flow_registrations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "whatsapp_flow_registrations_tenantId_phoneNumberId_flowKey_key"
  ON "whatsapp_flow_registrations"("tenantId", "phoneNumberId", "flowKey");

CREATE INDEX "whatsapp_flow_registrations_tenantId_idx"
  ON "whatsapp_flow_registrations"("tenantId");

CREATE INDEX "whatsapp_flow_registrations_phoneNumberId_idx"
  ON "whatsapp_flow_registrations"("phoneNumberId");

CREATE INDEX "whatsapp_flow_registrations_flowKey_idx"
  ON "whatsapp_flow_registrations"("flowKey");
