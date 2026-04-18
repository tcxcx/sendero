/**
 * Environment variable access with explicit fallbacks.
 *
 * When a credential is missing, the getter returns `null` and callers
 * should branch to a demo-mode fallback rather than throwing. This keeps
 * the hackathon demo alive when partial env is wired up.
 */

export const env = {
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,

  duffelApiToken: () => process.env.DUFFEL_API_TOKEN || null,
  duffelEnv: () =>
    (process.env.DUFFEL_ENV as 'test' | 'live') || 'test',

  circleApiKey: () => process.env.CIRCLE_API_KEY || null,
  circleEntitySecret: () =>
    process.env.CIRCLE_ENTITY_SECRET ||
    process.env.CIRCLE_ENTITY_SECRET_CIPHERTEXT ||
    null,
  circleWalletSetId: () => process.env.CIRCLE_WALLET_SET_ID || null,
  circleTreasuryWalletId: () =>
    process.env.CIRCLE_TREASURY_WALLET_ID || null,
  circleTreasuryAddress: () =>
    process.env.CIRCLE_TREASURY_ADDRESS || null,

  arcRpcUrl: () =>
    process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  arcChainId: () => Number(process.env.ARC_CHAIN_ID || 421),
  arcUsdcAddress: () =>
    process.env.ARC_USDC_ADDRESS ||
    '0x3600000000000000000000000000000000000000',
  arcEurcAddress: () => process.env.ARC_EURC_ADDRESS || null,
  arcExplorerUrl: () =>
    process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app',

  demoFallback: () => process.env.PASILLO_DEMO_FALLBACK !== 'false',
};

export function isDemoMode() {
  return (
    !env.duffelApiToken() || !env.circleApiKey() || !env.anthropicApiKey()
  );
}
