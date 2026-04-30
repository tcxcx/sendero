/**
 * Weight Presets for MSCA Smart Wallets.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 *
 * Maps RBAC roles to owner weights for Circle's WeightedWebauthnMultisigPlugin.
 * Each wallet role (personal, team, operations, treasury) has a preset that
 * determines:
 *  - How much each owner's signature "counts" toward the threshold
 *  - The default threshold required for execution
 *  - Which modules are installed by default
 *
 * Weight-based thresholds allow flexible policies:
 *  - Personal: single owner, weight=1, threshold=1 (any signature)
 *  - Operations: low-friction hot wallet, threshold=100
 *  - Treasury: all owners=100, threshold=majority (floor(N/2)+1 owners)
 */

import { WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE } from './modular/address-book';

/** Wallet role determines the weight preset and module set */
export type WalletRole = 'personal' | 'team' | 'operations' | 'treasury';

/** Weight preset configuration for a wallet role */
export interface WeightPreset {
  role: WalletRole;
  /** Maps member role names to their signature weight */
  ownerWeights: Record<string, number>;
  /** Minimum total weight of signatures required for execution */
  defaultThreshold: number;
  /** Real Circle MSCA modules installed for this wallet role */
  modules: ('weighted_multisig' | 'address_book')[];
}

const OPTIONAL_ADDRESS_BOOK_MODULES: 'address_book'[] = WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
  ? ['address_book']
  : [];

/**
 * Weight presets indexed by wallet role.
 *
 * - personal: Single owner, no multisig overhead
 * - operations: Low-threshold hot wallet
 * - treasury: Equal-weight owners, majority threshold (calculated dynamically)
 */
export const WEIGHT_PRESETS: Record<
  WalletRole,
  Omit<WeightPreset, 'role' | 'ownerWeights'> & { ownerWeights: Record<string, number> }
> = {
  personal: {
    ownerWeights: { owner: 1 },
    defaultThreshold: 1,
    modules: ['weighted_multisig'],
  },
  team: {
    ownerWeights: { admin: 100, member: 50 },
    defaultThreshold: 100,
    modules: ['weighted_multisig'],
  },
  operations: {
    ownerWeights: { owner: 100, admin: 100, member: 100 },
    defaultThreshold: 100,
    modules: ['weighted_multisig', ...OPTIONAL_ADDRESS_BOOK_MODULES],
  },
  treasury: {
    ownerWeights: { owner: 100 },
    defaultThreshold: 200, // majority of N owners at weight=100
    modules: ['weighted_multisig', ...OPTIONAL_ADDRESS_BOOK_MODULES],
  },
};

// ---------------------------------------------------------------------------
// Treasury Templates (legacy) — richer configs live in `templates.ts`.
// ---------------------------------------------------------------------------

/** @deprecated Use TreasuryTemplateId from './templates' instead */
export type TreasuryTemplate = 'startup' | 'agency' | 'dao' | 'custom';

/** @deprecated Use TreasuryTemplateFullConfig from './templates' instead */
export interface TreasuryTemplateConfig {
  name: string;
  description: string;
  bestFor: string;
  /** Function that assigns roles and weights given team member count */
  assignRoles: (
    memberCount: number
  ) => Array<{ role: 'owner' | 'admin' | 'member'; weight: number }>;
  /** Calculate threshold for this template given member count */
  getThreshold: (memberCount: number) => number;
  /** Recommended security tier */
  defaultTier: 'basic' | 'standard' | 'enhanced' | 'maximum';
}

/** @deprecated Use TREASURY_TEMPLATE_CONFIGS from './templates' instead */
export const TREASURY_TEMPLATES: Record<TreasuryTemplate, TreasuryTemplateConfig | null> = {
  startup: {
    name: 'Startup',
    description: '2 equal co-founders — either can approve',
    bestFor: 'Co-founders',
    assignRoles: count => {
      const roles: Array<{ role: 'owner' | 'admin' | 'member'; weight: number }> = [];
      for (let i = 0; i < count; i++) {
        roles.push(i < 2 ? { role: 'owner', weight: 500 } : { role: 'member', weight: 50 });
      }
      return roles;
    },
    getThreshold: () => 500,
    defaultTier: 'standard',
  },
  agency: {
    name: 'Agency',
    description: '1 owner leads, admins help manage',
    bestFor: 'Teams with a clear lead',
    assignRoles: count => {
      const roles: Array<{ role: 'owner' | 'admin' | 'member'; weight: number }> = [];
      for (let i = 0; i < count; i++) {
        roles.push(i === 0 ? { role: 'owner', weight: 700 } : { role: 'admin', weight: 100 });
      }
      return roles;
    },
    getThreshold: () => 700,
    defaultTier: 'standard',
  },
  dao: {
    name: 'DAO-style',
    description: 'Everyone equal, majority rules',
    bestFor: 'Flat teams, collectives',
    assignRoles: count =>
      Array.from({ length: count }, () => ({ role: 'owner' as const, weight: 100 })),
    getThreshold: count => (Math.floor(count / 2) + 1) * 100,
    defaultTier: 'enhanced',
  },
  custom: null, // User configures manually
};

/**
 * Calculate the threshold for a treasury wallet given the number of owners.
 *
 * Simple majority: floor(N/2) + 1 owners must sign, each weight=100.
 */
export function calculateThresholdForTreasury(ownerCount: number): number {
  return (Math.floor(ownerCount / 2) + 1) * 100;
}

/**
 * Get the signature weight for a member role within a wallet role.
 *
 * Falls back to the 'member' weight in the preset, or 50 if not found.
 */
export function getWeightForRole(
  walletRole: WalletRole,
  memberRole: 'owner' | 'admin' | 'member'
): number {
  const preset = WEIGHT_PRESETS[walletRole];
  return preset.ownerWeights[memberRole] ?? preset.ownerWeights['member'] ?? 50;
}
