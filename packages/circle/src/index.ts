export * as appKit from './app-kit';
export {
  getAppKit,
  getKitKey,
  getTreasuryAdapter,
  getTreasuryAddress,
  summarizeBridge,
  summarizeSend,
  summarizeSwap,
} from './app-kit';
export {
  type CircleWalletStore,
  fetchWalletBalances,
  syncWalletBalance,
  toMicro,
  type WalletBalancesMicro,
} from './balance-sync';
export * as gateway from './gateway';
export {
  depositToGateway,
  GATEWAY_CHAINS,
  GATEWAY_SOURCE_CHAINS,
  queryUnifiedBalance,
  transferViaGateway,
  transferViaGatewayFromSources,
} from './gateway';
export * as modularWallets from './modular-wallets';
export {
  type CircleSdkLike,
  type ProvisionTenantWalletArgs,
  type ProvisionTenantWalletResult,
  provisionTenantWallet,
} from './provision-tenant-wallet';
export * as unifiedBalance from './unified-balance';
export {
  getTenantUnifiedBalanceContext,
  getTenantUnifiedBalances,
  materializeTenantUnifiedUsdToArc,
  resolveUnifiedBalanceChain,
  spendTenantUnifiedUsd,
  type TenantUnifiedBalanceContext,
  type TenantUnifiedSpendArgs,
  type TenantUnifiedSpendResult,
} from './unified-balance';
export * as wallets from './wallets';
// Flat re-exports of the most-used names so consumers can say
// `import { getTreasuryAdapter } from '@sendero/circle'`.
export {
  getCircle,
  getTreasuryBalances,
} from './wallets';
