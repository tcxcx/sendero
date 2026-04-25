-- Extend the user-keyed `wallets` table to support DCW (Developer-
-- Controlled Wallets) alongside the existing MSCA (Modular passkey)
-- rows. All new columns are nullable / defaulted so existing rows are
-- unaffected.

ALTER TABLE "wallets"
  ADD COLUMN "provisioner"       TEXT NOT NULL DEFAULT 'msca',
  ADD COLUMN "circleWalletId"    TEXT,
  ADD COLUMN "circleWalletSetId" TEXT,
  ADD COLUMN "accountType"       TEXT,
  ADD COLUMN "metadata"          JSONB;

-- Unique on circleWalletId when set (Circle's DCW id is a stable global
-- key — surfacing duplicate rows for the same Circle wallet would mask
-- a provisioning bug).
CREATE UNIQUE INDEX "wallets_circleWalletId_key"
  ON "wallets"("circleWalletId");

-- Per-user, per-provisioner lookup. ensureTravelerWallet() reads
-- WHERE userId=? AND provisioner='dcw' so this is the hot path.
CREATE INDEX "wallets_userId_provisioner_idx"
  ON "wallets"("userId", "provisioner");
