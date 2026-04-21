-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "clerkMembershipId" TEXT;

-- CreateTable
CREATE TABLE "circle_wallets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clerkOrgId" TEXT,
    "address" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "circleWalletSetId" TEXT,
    "circleWalletId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "circle_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "circle_wallets_address_key" ON "circle_wallets"("address");

-- CreateIndex
CREATE INDEX "circle_wallets_tenantId_kind_idx" ON "circle_wallets"("tenantId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_clerkMembershipId_key" ON "memberships"("clerkMembershipId");

-- AddForeignKey
ALTER TABLE "circle_wallets" ADD CONSTRAINT "circle_wallets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
