/**
 * Environment variable access with explicit nullable getters. Callers
 * that need a credential are expected to surface a 503 when the getter
 * returns null — no silent demo fallbacks.
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

  // Viem treasury (App Kit adapter). See lib/appkit.ts for why we need
  // a private-key EOA alongside the DCW custodial treasury.
  treasuryPrivateKey: () => process.env.TREASURY_PRIVATE_KEY || null,
  treasuryViemAddress: () => process.env.TREASURY_VIEM_ADDRESS || null,

  arcRpcUrl: () =>
    process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.network',
  // Arc Testnet canonical chain id per https://docs.arc.network
  arcChainId: () => Number(process.env.ARC_CHAIN_ID || 5042002),
  arcUsdcAddress: () =>
    process.env.ARC_USDC_ADDRESS ||
    '0x3600000000000000000000000000000000000000',
  arcEurcAddress: () =>
    process.env.ARC_EURC_ADDRESS ||
    '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  arcExplorerUrl: () =>
    process.env.ARC_EXPLORER_URL || 'https://testnet.arcscan.app',

  // Circle Modular Wallets (user-side passkey auth). NOTE: The "Client Key"
  // Modular Wallets expects has the `TEST_CLIENT_KEY:` / `LIVE_CLIENT_KEY:`
  // prefix. `KIT_KEY:` values belong to App Kit / Swap Kit and will 401 here.
  modularClientKey: () =>
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_KEY ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY ||
    null,
  modularClientUrl: () =>
    process.env.NEXT_PUBLIC_CIRCLE_CLIENT_URL ||
    process.env.NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_URL ||
    'https://modular-sdk.circle.com/v1/rpc/w3s/buidl',
};
