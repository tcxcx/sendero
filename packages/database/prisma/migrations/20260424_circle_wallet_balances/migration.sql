-- AlterTable: cache USDC + EURC balances on the CircleWallet row.
-- Populated by the Circle notifications webhook via syncWalletBalance().
-- The UI reads these columns instead of polling RPC from the browser.
ALTER TABLE "circle_wallets"
  ADD COLUMN "usdcBalanceMicro" BIGINT,
  ADD COLUMN "eurcBalanceMicro" BIGINT,
  ADD COLUMN "balanceUpdatedAt" TIMESTAMPTZ(6);
