-- CreateTable
CREATE TABLE "pending_multisig_ops" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "opHash" TEXT NOT NULL,
    "userOp" JSONB NOT NULL,
    "callData" TEXT NOT NULL,
    "transferMeta" JSONB NOT NULL DEFAULT '{}',
    "threshold" INTEGER NOT NULL,
    "collectedWeight" INTEGER NOT NULL DEFAULT 0,
    "signatures" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "initiatedByClerkUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "submittedAt" TIMESTAMPTZ(6),
    "confirmedAt" TIMESTAMPTZ(6),
    "txHash" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pending_multisig_ops_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_multisig_ops_opHash_key" ON "pending_multisig_ops"("opHash");

-- CreateIndex
CREATE INDEX "pending_multisig_ops_tenantId_status_idx" ON "pending_multisig_ops"("tenantId", "status");

-- CreateIndex
CREATE INDEX "pending_multisig_ops_opHash_idx" ON "pending_multisig_ops"("opHash");

-- CreateIndex
CREATE INDEX "pending_multisig_ops_expiresAt_idx" ON "pending_multisig_ops"("expiresAt");

-- AddForeignKey
ALTER TABLE "pending_multisig_ops" ADD CONSTRAINT "pending_multisig_ops_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
