CREATE TABLE IF NOT EXISTS "whatsapp_session_verifications" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "channelIdentityId" UUID NOT NULL,
  "purpose" TEXT NOT NULL DEFAULT 'session_verify',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "nonce" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "sentAt" TIMESTAMPTZ(6),
  "verifiedAt" TIMESTAMPTZ(6),
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "whatsapp_session_verifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_session_verifications_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "whatsapp_session_verifications_channelIdentityId_fkey"
    FOREIGN KEY ("channelIdentityId") REFERENCES "channel_identities"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "whatsapp_session_verifications_tenant_identity_created_idx"
  ON "whatsapp_session_verifications"("tenantId", "channelIdentityId", "createdAt");

CREATE INDEX IF NOT EXISTS "whatsapp_session_verifications_tenant_status_expires_idx"
  ON "whatsapp_session_verifications"("tenantId", "status", "expiresAt");
