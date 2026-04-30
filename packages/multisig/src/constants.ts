/**
 * Circle MSCA + weighted-multisig plugin addresses.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Single source of truth for this package — replaces the `@bu/wallets/constants`
 * import path used in desk-v1. Verified on Arc testnet (plugin already deployed
 * at `WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS`) on 2026-03-30.
 *
 * All addresses below are deterministic CREATE2 deployments by Circle and are
 * identical across mainnet + testnet Modular Wallet chains (ARC, ARC-TESTNET,
 * BASE, BASE-SEPOLIA, ETH, ETH-SEPOLIA, ARB, ARB-SEPOLIA, AVAX, AVAX-FUJI,
 * OP, OP-SEPOLIA, POLYGON, POLYGON-AMOY, UNI, UNI-SEPOLIA, SOL-DEVNET, SOL).
 */

import type { Hex, Address } from 'viem';

/** ERC-4337 v0.7 canonical EntryPoint */
export const MODULAR_WALLET_ENTRY_POINT_V07: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/** Circle UpgradableMSCA plugin manager */
export const MODULAR_WALLET_PLUGIN_MANAGER_ADDRESS: Address =
  '0x00000005e69188224e4dEeF607801916DC0936d5';

/** Circle UpgradableMSCA factory */
export const MODULAR_WALLET_FACTORY_ADDRESS: Address = '0x0000000DF7E6c9Dc387cAFc5eCBfa6c3a6179AdD';

/** Circle ColdStorageAddressBookPlugin — on-chain recipient allowlist */
export const ADDRESS_BOOK_PLUGIN_ADDRESS: Address = '0x0000000d81083B16EA76dfab46B0315B0eDBF3d0';

/** Manifest hash for the Address Book plugin install */
export const ADDRESS_BOOK_MANIFEST_HASH: Hex =
  '0x9d177c1c9573b10436b693b7a49f0face36b677c1606a2c579bba1415be349d8';

/** Circle WeightedWebauthnMultisigPlugin — weighted signature validation module */
export const WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS: Address =
  '0x0000000C984AFf541D6cE86Bb697e68ec57873C8';

/** Manifest hash for the weighted multisig plugin install */
export const WEIGHTED_WEBAUTHN_MULTISIG_MANIFEST_HASH: Hex =
  '0xa043327d77a74c1c55cfa799284b831fe09535a88b9f5fa4173d334e5ba0fd91';

/** Owner-validation function id used by the weighted multisig plugin */
export const WEIGHTED_WEBAUTHN_MULTISIG_OWNER_FUNCTION_ID = 0 as const;

// ---------------------------------------------------------------------------
// Gas-fee floor helper (Arc testnet requires a minimum priority fee)
// ---------------------------------------------------------------------------

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_MIN_PRIORITY_FEE_PER_GAS = BigInt(1_000_000_000);

/**
 * Enforce the Arc testnet priority-fee floor; returns the input otherwise.
 *
 * The Arc testnet bundler rejects userOps with priority fee below 1 gwei. This
 * helper is pure; both `maxPriorityFeePerGas` and `maxFeePerGas` are bumped by
 * the same delta so the base-fee component is preserved.
 */
export function applyUserOperationFeeFloor(input: {
  chainId?: number | null;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
}) {
  if (input.chainId !== ARC_TESTNET_CHAIN_ID) {
    return {
      maxPriorityFeePerGas: input.maxPriorityFeePerGas,
      maxFeePerGas: input.maxFeePerGas,
    };
  }

  if (input.maxPriorityFeePerGas >= ARC_MIN_PRIORITY_FEE_PER_GAS) {
    return {
      maxPriorityFeePerGas: input.maxPriorityFeePerGas,
      maxFeePerGas: input.maxFeePerGas,
    };
  }

  const delta = ARC_MIN_PRIORITY_FEE_PER_GAS - input.maxPriorityFeePerGas;

  return {
    maxPriorityFeePerGas: ARC_MIN_PRIORITY_FEE_PER_GAS,
    maxFeePerGas: input.maxFeePerGas + delta,
  };
}
