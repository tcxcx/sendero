-- Gateway v5 Step 5 — two-column KMS envelope canary for Gateway signers.
--
-- encryptedPrivateKey remains intact as rollback fallback. Runtime reads
-- newEnvelope only when kekProvider='kms-v1' and the per-tenant/user
-- canary gate allows it.

-- CreateEnum
CREATE TYPE "SignerKekProvider" AS ENUM ('env-v1', 'kms-v1');

-- AlterTable
ALTER TABLE "tenant_gateway_signers"
  ADD COLUMN "kekProvider" "SignerKekProvider" NOT NULL DEFAULT 'env-v1',
  ADD COLUMN "newEnvelope" BYTEA,
  ADD COLUMN "kmsKeyResource" TEXT,
  ADD COLUMN "kmsKeyVersion" TEXT;

ALTER TABLE "user_gateway_signers"
  ADD COLUMN "kekProvider" "SignerKekProvider" NOT NULL DEFAULT 'env-v1',
  ADD COLUMN "newEnvelope" BYTEA,
  ADD COLUMN "kmsKeyResource" TEXT,
  ADD COLUMN "kmsKeyVersion" TEXT;

-- Invariant: kms-v1 rows must have the KMS envelope and resource needed
-- to decrypt without consulting process env.
ALTER TABLE "tenant_gateway_signers"
  ADD CONSTRAINT "tenant_gateway_signers_kms_envelope_present"
  CHECK (
    "kekProvider" = 'env-v1'
    OR ("newEnvelope" IS NOT NULL AND "kmsKeyResource" IS NOT NULL)
  );

ALTER TABLE "user_gateway_signers"
  ADD CONSTRAINT "user_gateway_signers_kms_envelope_present"
  CHECK (
    "kekProvider" = 'env-v1'
    OR ("newEnvelope" IS NOT NULL AND "kmsKeyResource" IS NOT NULL)
  );

-- CreateIndex
CREATE INDEX CONCURRENTLY IF NOT EXISTS "tenant_gateway_signers_kekProvider_updatedAt_idx"
  ON "tenant_gateway_signers"("kekProvider", "updatedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "user_gateway_signers_kekProvider_updatedAt_idx"
  ON "user_gateway_signers"("kekProvider", "updatedAt");
