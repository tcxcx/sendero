/**
 * Circle ColdStorageAddressBookPlugin helpers.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Only the pure encoding / install-data helpers are retained; the Circle-SDK
 * `installAddressBookModule` branch is dropped — Sendero installs the module
 * through the MSCA userOp flow in `userop-builder.ts`, not via the DCW API.
 *
 * The plugin, when installed, restricts ERC-20/721/1155 transfer recipients
 * to an on-chain allowlist. It does NOT gate self-calls (addOwners, etc.), so
 * async signer joins after install are unaffected.
 */

import type { Address, Hex } from 'viem';
import { decodeFunctionResult, encodeAbiParameters, encodeFunctionData } from 'viem';

import {
  WEIGHTED_WEB_AUTHN_MULTISIG_OWNER_FUNCTION_ID,
  WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
} from './plugin-constants';

export {
  ADDRESS_BOOK_MANIFEST_HASH,
  ADDRESS_BOOK_MODULE_ADDRESS,
} from './plugin-constants';

/**
 * Confirmed with Circle's Modular Wallet team (2026-04-15) — contract-level
 * install of the Address Book plugin is supported when the MSCA was bootstrapped
 * with the weighted multisig plugin. Install happens in a SEPARATE installPlugin
 * userOp signed via the weighted multisig validation path, wired through the
 * dependencies returned by `getAddressBookDependencies()`.
 */
export const WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE = true;

// ---------------------------------------------------------------------------
// ABI fragments
// ---------------------------------------------------------------------------

const ADDRESS_BOOK_ABI = [
  {
    name: 'addAllowedRecipients',
    type: 'function',
    inputs: [{ name: 'recipients', type: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'removeAllowedRecipients',
    type: 'function',
    inputs: [{ name: 'recipients', type: 'address[]' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAllowedRecipients',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const;

const ADDRESS_BOOK_READ_ABI = [
  {
    name: 'getAllowedRecipients',
    type: 'function',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address[]' }],
    stateMutability: 'view',
  },
] as const;

export type FunctionReference = {
  plugin: Address;
  functionId: number;
};

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/** Encode `addAllowedRecipients([address])` for a single allowlist entry. */
export function encodeAddAllowlistEntry(address: Address): Hex {
  return encodeFunctionData({
    abi: ADDRESS_BOOK_ABI,
    functionName: 'addAllowedRecipients',
    args: [[address]],
  });
}

/** Encode `removeAllowedRecipients([address])` for a single allowlist entry. */
export function encodeRemoveAllowlistEntry(address: Address): Hex {
  return encodeFunctionData({
    abi: ADDRESS_BOOK_ABI,
    functionName: 'removeAllowedRecipients',
    args: [[address]],
  });
}

/**
 * Encode a batch of `addAllowedRecipients` calls as individual execute entries
 * for the MSCA's executeBatch helper.
 */
export function encodeBatchAddAllowlist(
  addresses: readonly Address[],
  walletAddress: Address
): Array<{ to: Address; value: bigint; data: Hex }> {
  return addresses.map(addr => ({
    to: walletAddress,
    value: BigInt(0),
    data: encodeAddAllowlistEntry(addr),
  }));
}

/** Legacy alias for `encodeGetAllowedRecipients`. */
export function encodeIsAllowed(address: Address): Hex {
  return encodeGetAllowedRecipients(address);
}

/** Encode `getAllowedRecipients(account)` for read-only calls. */
export function encodeGetAllowedRecipients(account: Address): Hex {
  return encodeFunctionData({
    abi: ADDRESS_BOOK_ABI,
    functionName: 'getAllowedRecipients',
    args: [account],
  });
}

/** Legacy alias for `encodeGetAllowedRecipients`. */
export function encodeGetAllowlist(account: Address): Hex {
  return encodeGetAllowedRecipients(account);
}

export function decodeAllowedRecipients(data: Hex): readonly Address[] {
  return decodeFunctionResult({
    abi: ADDRESS_BOOK_READ_ABI,
    functionName: 'getAllowedRecipients',
    data,
  }) as readonly Address[];
}

export function isRecipientAllowlisted(data: Hex, recipient: Address): boolean {
  const normalized = recipient.toLowerCase();
  return decodeAllowedRecipients(data).some(address => address.toLowerCase() === normalized);
}

/**
 * Build the plugin install data for the Address Book module.
 *
 * Empty allowlist → `0x` (no pre-population). Otherwise returns
 * ABI-encoded `(address[])` with case-insensitive dedupe.
 */
export function buildAddressBookInstallData(initialRecipients?: readonly Address[]): Hex {
  if (!initialRecipients?.length) {
    return '0x';
  }

  const recipients = [
    ...new Set(initialRecipients.map(recipient => recipient.toLowerCase())),
  ] as Address[];
  return encodeAbiParameters([{ type: 'address[]' }], [recipients]);
}

/**
 * Dependency tuple wiring the Address Book install to the weighted multisig
 * plugin's owner validation. Duplicated intentionally — the plugin manifest
 * declares two function references that both resolve to the multisig owner
 * validator.
 */
export function getAddressBookDependencies(): FunctionReference[] {
  return [
    {
      plugin: WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
      functionId: WEIGHTED_WEB_AUTHN_MULTISIG_OWNER_FUNCTION_ID,
    },
    {
      plugin: WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
      functionId: WEIGHTED_WEB_AUTHN_MULTISIG_OWNER_FUNCTION_ID,
    },
  ];
}

/** Re-export ABI for downstream decoders (controllers, tools). */
export { ADDRESS_BOOK_ABI };
