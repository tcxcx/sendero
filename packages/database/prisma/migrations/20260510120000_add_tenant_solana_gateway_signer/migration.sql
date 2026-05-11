-- CreateTable
CREATE TABLE "tenant_solana_gateway_signers" (
    "tenantId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "kekVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_solana_gateway_signers_pkey" PRIMARY KEY ("tenantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_solana_gateway_signers_address_key" ON "tenant_solana_gateway_signers"("address");

-- AddForeignKey
ALTER TABLE "tenant_solana_gateway_signers" ADD CONSTRAINT "tenant_solana_gateway_signers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
