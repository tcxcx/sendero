'use client';

/**
 * BlockchainIcon — branded chain glyphs via @web3icons/react.
 * Maps from Sendero's chain keys (Arc_Testnet, Avalanche_Fuji, etc.)
 * and Circle circleId strings (ARC-TESTNET, AVAX-FUJI, etc.) to the
 * correct NetworkXxx component. Matches desk-v1's BlockchainToIconMap.
 */

import type { ComponentType } from 'react';
import {
  NetworkArbitrumOne,
  NetworkArc,
  NetworkAvalanche,
  NetworkBase,
  NetworkEthereum,
  NetworkOptimism,
  NetworkPolygon,
  NetworkSolana,
} from '@web3icons/react';
import type { IconComponentProps } from '@web3icons/react';

type KnownChain =
  | 'Arc_Testnet'
  | 'ARC-TESTNET'
  | 'Avalanche_Fuji'
  | 'AVAX-FUJI'
  | 'AVAX'
  | 'Sol_Devnet'
  | 'SOL-DEVNET'
  | 'Sol'
  | 'SOL'
  | 'Ethereum_Sepolia'
  | 'ETH-SEPOLIA'
  | 'ETH'
  | 'Base_Sepolia'
  | 'BASE-SEPOLIA'
  | 'BASE'
  | 'Optimism_Sepolia'
  | 'OP-SEPOLIA'
  | 'OP'
  | 'Arbitrum_Sepolia'
  | 'ARB-SEPOLIA'
  | 'ARB'
  | 'Polygon_Amoy'
  | 'MATIC-AMOY'
  | 'MATIC'
  | string;

const CHAIN_MAP: Record<string, ComponentType<IconComponentProps>> = {
  // Sendero chain keys
  Arc_Testnet: NetworkArc,
  Avalanche_Fuji: NetworkAvalanche,
  Sol_Devnet: NetworkSolana,
  Sol: NetworkSolana,
  Ethereum_Sepolia: NetworkEthereum,
  Base_Sepolia: NetworkBase,
  Optimism_Sepolia: NetworkOptimism,
  Arbitrum_Sepolia: NetworkArbitrumOne,
  Polygon_Amoy: NetworkPolygon,
  // Circle circleId strings
  'ARC-TESTNET': NetworkArc,
  'AVAX-FUJI': NetworkAvalanche,
  AVAX: NetworkAvalanche,
  'SOL-DEVNET': NetworkSolana,
  SOL: NetworkSolana,
  'ETH-SEPOLIA': NetworkEthereum,
  ETH: NetworkEthereum,
  'BASE-SEPOLIA': NetworkBase,
  BASE: NetworkBase,
  'OP-SEPOLIA': NetworkOptimism,
  OP: NetworkOptimism,
  'ARB-SEPOLIA': NetworkArbitrumOne,
  ARB: NetworkArbitrumOne,
  'MATIC-AMOY': NetworkPolygon,
  MATIC: NetworkPolygon,
};

interface BlockchainIconProps extends Omit<IconComponentProps, 'size'> {
  chain: KnownChain;
  size?: number;
  variant?: 'branded' | 'mono' | 'background';
}

export function BlockchainIcon({
  chain,
  size = 24,
  variant = 'branded',
  ...rest
}: BlockchainIconProps) {
  const Icon = CHAIN_MAP[chain];
  if (!Icon) return null;
  return <Icon size={size} variant={variant} {...rest} />;
}
