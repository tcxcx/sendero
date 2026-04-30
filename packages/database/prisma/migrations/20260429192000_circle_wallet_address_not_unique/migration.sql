-- Circle can return the same EVM address for per-chain wallets in one
-- wallet set. The system identity of a tenant Circle wallet is
-- (tenantId, kind, chain), and Circle webhook dispatch keys by
-- circleWalletId. Keep address searchable, but do not make it globally
-- unique across chains or tenants.

DROP INDEX IF EXISTS "circle_wallets_address_key";

CREATE INDEX IF NOT EXISTS "circle_wallets_address_idx" ON "circle_wallets"("address");
