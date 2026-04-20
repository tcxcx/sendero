/**
 * App Kit BridgeChain enum values, grouped. Source of truth for bridge
 * source/destination selectors.
 */

export const BRIDGE_MAINNETS = [
  'Arbitrum',
  'Avalanche',
  'Base',
  'Codex',
  'Edge',
  'Ethereum',
  'HyperEVM',
  'Ink',
  'Linea',
  'Monad',
  'Morph',
  'Optimism',
  'Plume',
  'Polygon',
  'Sei',
  'Solana',
  'Sonic',
  'Unichain',
  'World_Chain',
  'XDC',
] as const;

export const BRIDGE_TESTNETS = [
  'Arc_Testnet',
  'Arbitrum_Sepolia',
  'Avalanche_Fuji',
  'Base_Sepolia',
  'Codex_Testnet',
  'Edge_Testnet',
  'Ethereum_Sepolia',
  'HyperEVM_Testnet',
  'Ink_Testnet',
  'Linea_Sepolia',
  'Monad_Testnet',
  'Morph_Testnet',
  'Optimism_Sepolia',
  'Plume_Testnet',
  'Polygon_Amoy_Testnet',
  'Sei_Testnet',
  'Solana_Devnet',
  'Sonic_Testnet',
  'Unichain_Sepolia',
  'World_Chain_Sepolia',
  'XDC_Apothem',
] as const;

export const BRIDGE_CHAINS = [...BRIDGE_MAINNETS, ...BRIDGE_TESTNETS] as const;

export type BridgeChainId = (typeof BRIDGE_CHAINS)[number];

/** Human-friendly label for a bridge chain id. */
export function bridgeChainLabel(id: BridgeChainId): string {
  return id
    .replace(/_/g, ' ')
    .replace(/Testnet/i, '· testnet')
    .replace(/Sepolia/i, '· sepolia')
    .replace(/Fuji/i, '· fuji')
    .replace(/Amoy/i, '· amoy')
    .replace(/Apothem/i, '· apothem')
    .replace(/Devnet/i, '· devnet');
}

/** Which testnets are practical sources for bridging INTO Arc_Testnet. */
export const ARC_BRIDGE_SOURCES = [
  'Ethereum_Sepolia',
  'Base_Sepolia',
  'Polygon_Amoy_Testnet',
  'Avalanche_Fuji',
  'Arbitrum_Sepolia',
  'Optimism_Sepolia',
  'Solana_Devnet',
  'Unichain_Sepolia',
  'Linea_Sepolia',
] as const;

export type ArcBridgeSource = (typeof ARC_BRIDGE_SOURCES)[number];
