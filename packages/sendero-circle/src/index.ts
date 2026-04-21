export * as wallets from './wallets';
export * as appKit from './app-kit';
export * as gateway from './gateway';
export * as modularWallets from './modular-wallets';

// Flat re-exports of the most-used names so consumers can say
// `import { getTreasuryAdapter } from '@sendero/circle'`.
export {
  getCircle,
  getTreasuryBalances,
} from './wallets';
export {
  getAppKit,
  getTreasuryAdapter,
  getTreasuryAddress,
  getKitKey,
  summarizeBridge,
  summarizeSwap,
  summarizeSend,
} from './app-kit';
export {
  GATEWAY_CHAINS,
  GATEWAY_SOURCE_CHAINS,
  queryUnifiedBalance,
  depositToGateway,
  transferViaGateway,
} from './gateway';
export {
  provisionTenantWallet,
  type ProvisionTenantWalletArgs,
  type ProvisionTenantWalletResult,
  type CircleSdkLike,
} from './provision-tenant-wallet';
