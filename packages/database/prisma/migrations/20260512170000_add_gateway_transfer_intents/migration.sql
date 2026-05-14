-- Gateway v5 Step 2 — shadow GatewayTransferIntent state machine.
--
-- Observability-only in this migration: current transfer code writes
-- states, but the table does not yet drive retries or replace
-- gateway_transfer_logs as the operator-facing index.

-- CreateEnum
CREATE TYPE "GatewayTransferIntentState" AS ENUM (
  'prepared',
  'burn_signed',
  'burn_attested',
  'mint_submitted',
  'mint_confirmed',
  'mint_failed_retriable',
  'mint_failed_terminal'
);

-- CreateTable
CREATE TABLE "gateway_transfer_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" TEXT NOT NULL,
  "gatewayTransferLogId" UUID,
  "signerKind" TEXT NOT NULL,
  "sourceChain" TEXT,
  "destinationChain" TEXT NOT NULL,
  "amountMicroUsdc" BIGINT NOT NULL,
  "recipientAddress" TEXT NOT NULL,
  "burnIntentSalt" TEXT,
  "state" "GatewayTransferIntentState" NOT NULL DEFAULT 'prepared',
  "attestation" TEXT,
  "apiSignature" TEXT,
  "burnTxHash" TEXT,
  "mintTxHash" TEXT,
  "failedReason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "gateway_transfer_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "gateway_transfer_intents_amount_positive" CHECK ("amountMicroUsdc" > 0)
);

-- AddForeignKey
ALTER TABLE "gateway_transfer_intents"
  ADD CONSTRAINT "gateway_transfer_intents_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "gateway_transfer_intents"
  ADD CONSTRAINT "gateway_transfer_intents_gatewayTransferLogId_fkey"
  FOREIGN KEY ("gatewayTransferLogId") REFERENCES "gateway_transfer_logs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "gateway_transfer_intents_gatewayTransferLogId_key"
  ON "gateway_transfer_intents"("gatewayTransferLogId");

CREATE INDEX "gateway_transfer_intents_tenantId_state_createdAt_idx"
  ON "gateway_transfer_intents"("tenantId", "state", "createdAt");

CREATE INDEX "gateway_transfer_intents_state_updatedAt_idx"
  ON "gateway_transfer_intents"("state", "updatedAt");

CREATE INDEX "gateway_transfer_intents_burnIntentSalt_idx"
  ON "gateway_transfer_intents"("burnIntentSalt");
