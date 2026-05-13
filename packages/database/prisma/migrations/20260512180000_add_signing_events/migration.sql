-- Gateway v5 Step 3 — append-only SigningEvent audit table.

-- CreateTable
CREATE TABLE "signing_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "signerKind" TEXT NOT NULL,
  "signerAddress" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "callerSurface" TEXT NOT NULL,
  "callerUserId" TEXT,
  "intentId" UUID,
  "messageKind" TEXT NOT NULL,
  "messageHash" BYTEA NOT NULL,
  "signature" BYTEA NOT NULL,
  "kmsKeyVersion" TEXT NOT NULL,
  "attestedImageDigest" TEXT,
  "slsaSourceCommit" TEXT,
  "complianceDecisionId" UUID,
  "approvalReceiptId" UUID,
  "revocationEpoch" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "signing_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "signing_events"
  ADD CONSTRAINT "signing_events_intentId_fkey"
  FOREIGN KEY ("intentId") REFERENCES "gateway_transfer_intents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "signing_events_principalId_createdAt_idx"
  ON "signing_events"("principalId", "createdAt" DESC);

CREATE INDEX "signing_events_signerAddress_createdAt_idx"
  ON "signing_events"("signerAddress", "createdAt" DESC);

CREATE INDEX "signing_events_intentId_idx"
  ON "signing_events"("intentId");

CREATE INDEX "signing_events_messageHash_idx"
  ON "signing_events"("messageHash");

CREATE INDEX "signing_events_createdAt_idx"
  ON "signing_events"("createdAt");

-- Append-only enforcement.
CREATE OR REPLACE FUNCTION reject_signing_event_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'signing_events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER signing_events_immutable
BEFORE UPDATE OR DELETE ON "signing_events"
FOR EACH ROW EXECUTE FUNCTION reject_signing_event_mutation();
