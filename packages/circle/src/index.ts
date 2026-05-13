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
export * as compliance from './compliance';
export * as gateway from './gateway';
export {
  depositToGateway,
  GATEWAY_CHAINS,
  GATEWAY_SOURCE_CHAINS,
  queryUnifiedBalance,
  transferViaGateway,
  transferViaGatewayFromSources,
} from './gateway';
export {
  type DepositTravelerToGatewayArgs,
  type DepositTravelerToGatewayResult,
  depositTravelerToGateway,
} from './gateway-deposit-traveler';
export * as gatewayIntent from './gateway-intent';
export * as journal from './journal';
export * as modularWallets from './modular-wallets';
export {
  type CircleSdkLike,
  type ProvisionTenantWalletArgs,
  type ProvisionTenantWalletResult,
  provisionTenantWallet,
} from './provision-tenant-wallet';
export * as signingEvent from './signing-event';
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
export * as unifiedGateway from './unified-gateway';
export {
  addDelegate,
  auditEvmAddresses,
  type BridgeArgs as UnifiedBridgeArgs,
  type BridgeResult as UnifiedBridgeResult,
  bridge,
  type CustomFee,
  circleWalletsPrincipal,
  type DelegateArgs,
  type DepositArgs as UnifiedDepositArgs,
  type DepositForArgs as UnifiedDepositForArgs,
  type DepositResult as UnifiedDepositResult,
  delegateViemPrincipal,
  deposit,
  depositFor,
  type EnsureSolanaGasArgs,
  type EnsureSolanaGasResult,
  type EvmAddressAudit,
  type EvmAddressByChain,
  ensureSolanaGas,
  estimateSpend,
  type GatewayChainKey,
  type GetBalancesArgs as UnifiedGetBalancesArgs,
  getAppKitInstance,
  getBalances,
  getDelegateStatus,
  getUnifiedBalanceNamespace,
  type InitiateRemoveFundArgs,
  initiateRemoveFund,
  isSolanaChainKey,
  type Principal,
  type Principal as GatewayPrincipal,
  queryDepositorBalances,
  type RemoveFundArgs,
  removeDelegate,
  removeFund,
  resolveTravelerPrincipal,
  type SpendArgs as UnifiedSpendArgs,
  type SpendResult as UnifiedSpendResult,
  type SpendSource,
  type SupportedToken as UnifiedSupportedToken,
  setSolanaPlatformLowAlertCallback,
  spend,
  treasuryPrincipal,
  unifiedBalanceChainName,
  viemPrincipal,
} from './unified-gateway';
export * as wallets from './wallets';
// Flat re-exports of the most-used names so consumers can say
// `import { getTreasuryAdapter } from '@sendero/circle'`.
export {
  getCircle,
  getTreasuryBalances,
} from './wallets';
