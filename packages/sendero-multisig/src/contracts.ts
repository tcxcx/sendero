/**
 * Circle MSCA contract addresses.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Back-compat export surface for callers that prefer named address groups;
 * all underlying values come from `./constants`.
 */

import type { Address } from 'viem';

import {
  ADDRESS_BOOK_MANIFEST_HASH,
  ADDRESS_BOOK_PLUGIN_ADDRESS,
  MODULAR_WALLET_ENTRY_POINT_V07,
  MODULAR_WALLET_FACTORY_ADDRESS,
  MODULAR_WALLET_PLUGIN_MANAGER_ADDRESS,
  WEIGHTED_WEBAUTHN_MULTISIG_MANIFEST_HASH,
  WEIGHTED_WEBAUTHN_MULTISIG_OWNER_FUNCTION_ID,
  WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS,
} from './constants';

/** ColdStorageAddressBookPlugin (on-chain allowlist) */
export const ADDRESS_BOOK_PLUGIN = ADDRESS_BOOK_PLUGIN_ADDRESS;

/** @deprecated Legacy alias — use ADDRESS_BOOK_PLUGIN. */
export const SAFE_LIST_PLUGIN = ADDRESS_BOOK_PLUGIN_ADDRESS;

/** UpgradableMSCA factory */
export const MSCA_FACTORY = {
  mainnet: MODULAR_WALLET_FACTORY_ADDRESS,
  testnet: MODULAR_WALLET_FACTORY_ADDRESS,
} as const;

/** MSCA implementation address */
export const MSCA_IMPLEMENTATION = {
  mainnet: '0xA70F1296869DA9D7CB69578123F21888E6dB2B62' as Address,
  testnet: '0xA70F1296869DA9D7CB69578123F21888E6dB2B62' as Address,
} as const;

/** ERC-4337 EntryPoint v0.7 */
export const ENTRY_POINT_V07 = MODULAR_WALLET_ENTRY_POINT_V07;

/** Deterministic PluginManager used by the Circle MSCA factory */
export const PLUGIN_MANAGER = MODULAR_WALLET_PLUGIN_MANAGER_ADDRESS;

/** Weighted WebAuthn multisig validation module */
export const WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN = WEIGHTED_WEBAUTHN_MULTISIG_PLUGIN_ADDRESS;

export {
  ADDRESS_BOOK_MANIFEST_HASH,
  WEIGHTED_WEBAUTHN_MULTISIG_MANIFEST_HASH,
  WEIGHTED_WEBAUTHN_MULTISIG_OWNER_FUNCTION_ID,
};

/**
 * USDC token addresses per chain.
 *
 * Ported for back-compat. Sendero's canonical USDC addresses live in
 * `@sendero/arc`; callers should prefer that when available.
 */
export const USDC_ADDRESS: Record<string, Address> = {
  POLYGON: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  'POLYGON-AMOY': '0x41e94eb019c0762f9bfcf9fb1e58725bfb0e7582',
  ETH: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  'ETH-SEPOLIA': '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
  ARB: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  'ARB-SEPOLIA': '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  'AVAX-FUJI': '0x5425890298aed601595a70AB815c96711a31Bc65',
};
