/**
 * UserOp Builder for Treasury / Operations / Personal Wallet Deployment.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 *
 * Circle MSCAs are deployed lazily on the first outbound user operation. The
 * weighted WebAuthn multisig plugin is already present at deployment time, so
 * the bootstrap sequence is:
 *
 * 1. Re-weight the bootstrap signer to the template's intended weight/threshold
 * 2. Install the Address Book module on the MSCA when the current Circle
 *    weighted multisig contracts support that combination
 * 3. Seed the initial allowlist inside the Address Book install data
 *
 * The higher-level builders remain pure and synchronous. Chain interaction
 * happens separately in the web/native setup clients.
 */

import type { Address, Hex } from 'viem';
import { encodeFunctionData } from 'viem';
import { parsePublicKey } from 'webauthn-p256';

import {
  buildAddressBookInstallData,
  getAddressBookDependencies,
  WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE,
} from './modular/address-book';
import {
  ADDRESS_BOOK_MANIFEST_HASH,
  ADDRESS_BOOK_MODULE_ADDRESS,
  WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
} from './modular/plugin-constants';
import type { SecurityTierLevel } from './security-tiers';
import type { TreasuryTemplateFullConfig } from './templates';

// ---------------------------------------------------------------------------
// Circle module constants / ABI
// ---------------------------------------------------------------------------

const ZERO_BYTES32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

const INSTALL_PLUGIN_ABI = [
  {
    type: 'function',
    name: 'installPlugin',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'plugin', type: 'address' },
      { name: 'manifestHash', type: 'bytes32' },
      { name: 'pluginInstallData', type: 'bytes' },
      {
        name: 'dependencies',
        type: 'tuple[]',
        components: [
          { name: 'plugin', type: 'address' },
          { name: 'functionId', type: 'uint8' },
        ],
      },
    ],
  },
] as const;

const UPDATE_MULTISIG_WEIGHTS_ABI = [
  {
    inputs: [
      { internalType: 'address[]', name: 'ownersToUpdate', type: 'address[]' },
      {
        internalType: 'uint256[]',
        name: 'newWeightsToUpdate',
        type: 'uint256[]',
      },
      {
        components: [
          { internalType: 'uint256', name: 'x', type: 'uint256' },
          { internalType: 'uint256', name: 'y', type: 'uint256' },
        ],
        internalType: 'struct PublicKey[]',
        name: 'publicKeyOwnersToUpdate',
        type: 'tuple[]',
      },
      {
        internalType: 'uint256[]',
        name: 'pubicKeyNewWeightsToUpdate',
        type: 'uint256[]',
      },
      { internalType: 'uint256', name: 'newThresholdWeight', type: 'uint256' },
    ],
    name: 'updateMultisigWeights',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

function normalizeHexPublicKey(publicKey: string): Hex {
  return (publicKey.startsWith('0x') ? publicKey : `0x${publicKey}`) as Hex;
}

function encodeInstallPlugin(
  pluginAddress: Address,
  manifestHash: Hex = ZERO_BYTES32,
  pluginInstallData: Hex = '0x',
  dependencies: Array<{ plugin: Address; functionId: number }> = []
): Hex {
  return encodeFunctionData({
    abi: INSTALL_PLUGIN_ABI,
    functionName: 'installPlugin',
    args: [pluginAddress, manifestHash, pluginInstallData, dependencies],
  });
}

function encodeUpdateBootstrapMultisig(input: {
  signer: BootstrapSignerInput;
  threshold: number;
}): Hex {
  if (input.signer.type === 'eoa') {
    return encodeFunctionData({
      abi: UPDATE_MULTISIG_WEIGHTS_ABI,
      functionName: 'updateMultisigWeights',
      args: [
        [input.signer.address],
        [BigInt(input.signer.weight)],
        [],
        [],
        BigInt(input.threshold),
      ],
    });
  }

  const publicKey = parsePublicKey(normalizeHexPublicKey(input.signer.publicKey));
  return encodeFunctionData({
    abi: UPDATE_MULTISIG_WEIGHTS_ABI,
    functionName: 'updateMultisigWeights',
    args: [
      [],
      [],
      [{ x: publicKey.x, y: publicKey.y }],
      [BigInt(input.signer.weight)],
      BigInt(input.threshold),
    ],
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single call in a batch install sequence */
export interface BatchCall {
  target: Address;
  value: bigint;
  data: Hex;
}

export type BootstrapSignerInput =
  | {
      type: 'passkey';
      weight: number;
      publicKey: string;
      credentialId?: string;
    }
  | {
      type: 'eoa';
      weight: number;
      address: Address;
    };

/** Input for building batch install calls */
export interface BatchCallInput {
  template: TreasuryTemplateFullConfig;
  signers: BootstrapSignerInput[];
  tier: SecurityTierLevel;
  walletAddress: Address;
  initialAllowlist?: readonly Address[];
  addresses: {
    weightedMultisig: Address;
    addressBook: Address;
    usdc: Address;
  };
  tokenDecimals: number;
}

/** Input for the higher-level treasury setup builder */
export interface TreasurySetupInput {
  template: TreasuryTemplateFullConfig;
  signers: Array<{
    type?: 'passkey' | 'eoa';
    credential: unknown; // P256Credential from Circle SDK
    role: 'owner' | 'admin';
    weight: number;
    publicKey?: string;
    ownerAddress?: Address;
  }>;
  tier: SecurityTierLevel;
  chain: string;
  usdcAddress: Address;
  walletAddress: Address;
  initialAllowlist?: readonly Address[];
}

/** Result of building a wallet deployment userOp */
export interface BuiltUserOp {
  calls: BatchCall[];
  modules: string[];
  policySummary: {
    threshold: string;
    adminDaily: string;
    adminPerTx: string;
    timelock: string | null;
    sessionKeys: boolean;
  };
}

// ---------------------------------------------------------------------------
// Pure Functions
// ---------------------------------------------------------------------------

/**
 * Convert a USD amount to token-native units given the token's decimal count.
 */
export function encodeLimitToTokenDecimals(usd: number, decimals: number): bigint {
  if (usd === 0) return BigInt(0);
  return BigInt(usd) * BigInt(10) ** BigInt(decimals);
}

/**
 * Build the batch of account calls for a wallet deployment.
 *
 * The MSCA is deployed with Circle's weighted WebAuthn multisig already
 * installed. This builder adjusts that bootstrap config, then installs the
 * Address Book module only when the selected template/tier requires it and
 * the current Circle weighted multisig contracts support that combination.
 *
 * NOTE: SpendingLimit, SessionKey, Timelock do NOT exist as Circle modules.
 * Those are enforced at application layer until Circle ships them.
 */
export function buildBatchInstallCalls(input: BatchCallInput): BatchCall[] {
  const { template, tier, addresses, walletAddress, initialAllowlist } = input;
  const calls: BatchCall[] = [];
  const shouldInstallAddressBook =
    WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE &&
    (tier === 'enhanced' || tier === 'maximum' || template.modules.includes('address_book'));

  if (input.signers.length !== 1) {
    throw new Error(
      'Initial MSCA deployment currently supports exactly one bootstrap signer. Additional signers must join after activation.'
    );
  }

  // 1. Re-weight the bootstrap signer on the already-installed multisig plugin.
  calls.push({
    target: walletAddress,
    value: BigInt(0),
    data: encodeUpdateBootstrapMultisig({
      signer: input.signers[0]!,
      threshold: template.threshold,
    }),
  });

  // 2. Install Address Book if template includes it or tier >= enhanced.
  if (shouldInstallAddressBook) {
    const uniqueRecipients = initialAllowlist?.length
      ? ([...new Set(initialAllowlist.map(address => address.toLowerCase()))] as Address[])
      : undefined;

    calls.push({
      target: walletAddress,
      value: BigInt(0),
      data: encodeInstallPlugin(
        addresses.addressBook,
        ADDRESS_BOOK_MANIFEST_HASH,
        buildAddressBookInstallData(uniqueRecipients),
        getAddressBookDependencies()
      ),
    });
  }

  return calls;
}

// ---------------------------------------------------------------------------
// Higher-Level Builders
// ---------------------------------------------------------------------------

/** Derive the list of module names from tier + template */
function deriveModules(tier: SecurityTierLevel, template: TreasuryTemplateFullConfig): string[] {
  const modules = ['weighted_multisig'];
  if (
    WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE &&
    (tier === 'enhanced' || tier === 'maximum' || template.modules.includes('address_book'))
  ) {
    modules.push('address_book');
  }
  return modules;
}

/** Build a policy summary for UI display */
function buildPolicySummary(
  template: TreasuryTemplateFullConfig,
  _tier: SecurityTierLevel
): BuiltUserOp['policySummary'] {
  return {
    threshold: `${template.threshold}`,
    adminDaily: `$${template.adminDailyLimitUsd.toLocaleString()}`,
    adminPerTx: `$${template.adminPerTxLimitUsd.toLocaleString()}`,
    timelock: null, // No Circle timelock module yet — app-layer only
    sessionKeys: false, // No Circle session key module yet
  };
}

function ensureAddressBookTemplate(
  template: TreasuryTemplateFullConfig
): TreasuryTemplateFullConfig {
  if (!WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE) {
    return template;
  }

  return template.modules.includes('address_book')
    ? template
    : {
        ...template,
        modules: [...template.modules, 'address_book'],
      };
}

/**
 * Build a complete treasury wallet deployment userOp.
 */
export function buildTreasurySetupUserOp(input: TreasurySetupInput): BuiltUserOp {
  const { template, signers, tier, usdcAddress, walletAddress, initialAllowlist } = input;
  const policyTemplate = ensureAddressBookTemplate(template);

  const calls = buildBatchInstallCalls({
    template: policyTemplate,
    signers: signers.map((s, index) => {
      if (s.type === 'eoa' && s.ownerAddress) {
        return {
          type: 'eoa' as const,
          weight: s.weight,
          address: s.ownerAddress,
        };
      }

      const credentialPublicKey =
        typeof s.publicKey === 'string'
          ? s.publicKey
          : extractPublicKeyFromCredential(s.credential);

      if (!credentialPublicKey) {
        throw new Error(`Treasury signer ${index + 1} is missing a WebAuthn public key`);
      }

      return {
        type: 'passkey' as const,
        weight: s.weight,
        credentialId: '',
        publicKey: credentialPublicKey,
      };
    }),
    tier,
    ...(initialAllowlist ? { initialAllowlist } : {}),
    addresses: {
      weightedMultisig: WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
      addressBook: ADDRESS_BOOK_MODULE_ADDRESS,
      usdc: usdcAddress,
    },
    walletAddress,
    tokenDecimals: 6,
  });

  return {
    calls,
    modules: deriveModules(tier, policyTemplate),
    policySummary: buildPolicySummary(policyTemplate, tier),
  };
}

/**
 * Build an operations wallet deployment userOp.
 *
 * Similar to treasury but typically with lower thresholds and limits, designed
 * for day-to-day team operations.
 */
export function buildOperationsWalletUserOp(input: {
  template: TreasuryTemplateFullConfig;
  signers: BootstrapSignerInput[];
  tier: SecurityTierLevel;
  usdcAddress: Address;
  walletAddress: Address;
  initialAllowlist?: readonly Address[];
}): BuiltUserOp {
  const { template, signers, tier, usdcAddress, walletAddress, initialAllowlist } = input;
  const policyTemplate = ensureAddressBookTemplate(template);

  const calls = buildBatchInstallCalls({
    template: policyTemplate,
    signers,
    tier,
    ...(initialAllowlist ? { initialAllowlist } : {}),
    addresses: {
      weightedMultisig: WEIGHTED_WEB_AUTHN_MULTISIG_PLUGIN_ADDRESS,
      addressBook: ADDRESS_BOOK_MODULE_ADDRESS,
      usdc: usdcAddress,
    },
    walletAddress,
    tokenDecimals: 6,
  });

  return {
    calls,
    modules: deriveModules(tier, policyTemplate),
    policySummary: buildPolicySummary(policyTemplate, tier),
  };
}

/**
 * Build a personal wallet deployment userOp.
 *
 * Simplest configuration — single signer, weighted_multisig only.
 */
export function buildPersonalWalletUserOp(input: {
  dailyLimitUsd: number;
  perTxLimitUsd: number;
  usdcAddress: Address;
}): BuiltUserOp {
  const { dailyLimitUsd, perTxLimitUsd } = input;

  return {
    calls: [],
    modules: ['weighted_multisig'],
    policySummary: {
      threshold: '1000',
      adminDaily: `$${dailyLimitUsd.toLocaleString()}`,
      adminPerTx: `$${perTxLimitUsd.toLocaleString()}`,
      timelock: null,
      sessionKeys: false,
    },
  };
}

function extractPublicKeyFromCredential(credential: unknown): string | null {
  if (!credential || typeof credential !== 'object') {
    return null;
  }

  const candidate = (credential as { publicKey?: unknown }).publicKey;
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
}
