/**
 * Progressive Security Tier Engine.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 *
 * Evaluates wallet balance to determine the appropriate security tier, and
 * calculates upgrade paths when a wallet outgrows its current tier.
 *
 * Tiers are balance-driven recommendations — upgrades are never forced.
 * Spending limits are always-on regardless of tier.
 */

import { WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE } from './modular/address-book';

/** Security tier levels, ordered from lowest to highest */
export type SecurityTierLevel = 'basic' | 'standard' | 'enhanced' | 'maximum';

/** Full tier configuration */
export interface SecurityTier {
  level: SecurityTierLevel;
  /** Minimum balance in USD cents to recommend this tier */
  minBalance: number;
  /** Modules that should be active at this tier */
  modules: string[];
  /** Whether multisig (weighted threshold) is recommended */
  requiresMultisig: boolean;
  /** Whether timelock delays are recommended */
  requiresTimelock: boolean;
  /** Human-readable description */
  description: string;
}

const TIER_ORDER: SecurityTierLevel[] = ['basic', 'standard', 'enhanced', 'maximum'];
const OPTIONAL_ADDRESS_BOOK_MODULES = WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
  ? ['address_book']
  : [];

/**
 * Security tier definitions.
 *
 * Balance thresholds in USD cents (100 = $1.00). Modules reference real Circle
 * MSCA plugins (`weighted_multisig`, `address_book`). `spending_limit`,
 * `session_key`, `timelock` are application-layer enforcement — Circle has not
 * shipped those modules.
 */
export const SECURITY_TIERS: Record<SecurityTierLevel, SecurityTier> = {
  basic: {
    level: 'basic',
    minBalance: 0,
    modules: ['weighted_multisig'],
    requiresMultisig: false,
    requiresTimelock: false,
    description: 'Basic protection with passkey signing',
  },
  standard: {
    level: 'standard',
    minBalance: 100_000, // $1,000
    modules: ['weighted_multisig'],
    requiresMultisig: false,
    requiresTimelock: false,
    description: 'Standard protection for active wallets',
  },
  enhanced: {
    level: 'enhanced',
    minBalance: 5_000_000, // $50,000
    modules: ['weighted_multisig', ...OPTIONAL_ADDRESS_BOOK_MODULES],
    requiresMultisig: true,
    requiresTimelock: false,
    description: WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
      ? 'Enhanced protection with multisig + address book'
      : 'Enhanced protection with multisig and tighter app-layer policy',
  },
  maximum: {
    level: 'maximum',
    minBalance: 25_000_000, // $250,000
    modules: ['weighted_multisig', ...OPTIONAL_ADDRESS_BOOK_MODULES],
    requiresMultisig: true,
    requiresTimelock: true,
    description: WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
      ? 'Maximum protection with multisig + address book + app-layer timelock'
      : 'Maximum protection with multisig + app-layer timelock',
  },
};

/** Evaluate the recommended tier for a given balance (USD cents). */
export function evaluateSecurityTier(balanceCents: number): SecurityTierLevel {
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    const tier = SECURITY_TIERS[TIER_ORDER[i]!];
    if (balanceCents >= tier.minBalance) {
      return tier.level;
    }
  }
  return 'basic';
}

/** Compare two tier levels (returns -, 0, +). */
export function compareTiers(a: SecurityTierLevel, b: SecurityTierLevel): number {
  return TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b);
}

/** Recommended tier if current is below, else null. */
export function getRequiredUpgrade(
  currentTier: SecurityTierLevel,
  balanceCents: number
): SecurityTierLevel | null {
  const recommended = evaluateSecurityTier(balanceCents);
  if (compareTiers(recommended, currentTier) > 0) {
    return recommended;
  }
  return null;
}

/** Modules that need to be added when upgrading between tiers. */
export function getUpgradePath(from: SecurityTierLevel, to: SecurityTierLevel): string[] {
  const currentModules = new Set(SECURITY_TIERS[from].modules);
  const targetModules = SECURITY_TIERS[to].modules;
  return targetModules.filter(m => !currentModules.has(m));
}

/**
 * Reverse-engineer the tier from installed modules.
 *
 * Used when the on-chain account is the source of truth for what tier a wallet
 * is actually at (vs. the recommended tier from balance).
 */
export function getTierFromModules(installedModules: string[]): SecurityTierLevel {
  if (!WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE) {
    return installedModules.includes('weighted_multisig') ? 'standard' : 'basic';
  }

  const installed = new Set(installedModules);
  for (let i = TIER_ORDER.length - 1; i >= 0; i--) {
    const tierLevel = TIER_ORDER[i]!;
    const tier = SECURITY_TIERS[tierLevel];
    if (tier.modules.every(m => installed.has(m))) {
      return tierLevel;
    }
  }
  return 'basic';
}
