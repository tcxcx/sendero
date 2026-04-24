/**
 * Treasury Template Configurations.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 *
 * Pre-built treasury wallet configurations for common team types. Each template
 * defines owner weights, thresholds, spending limits, security tiers, and
 * installed modules.
 */

import { WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE } from './modular/address-book';
import type { SecurityTierLevel } from './security-tiers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All supported treasury template identifiers */
export type TreasuryTemplateId =
  | 'solo_freelancer'
  | 'startup'
  | 'agency'
  | 'import_export'
  | 'saas_platform'
  | 'dao'
  | 'custom';

/** Full configuration for a treasury template */
export interface TreasuryTemplateFullConfig {
  /** Template identifier */
  id: TreasuryTemplateId;
  /** Human-readable name */
  name: string;
  /** Short description */
  description: string;
  /** Card description for UI selection */
  cardDescription: string;
  /** Weight assigned to each owner */
  ownerWeight: number;
  /** Weight assigned to admin signers (optional, defaults to 0) */
  adminWeight?: number;
  /** Default threshold required for execution */
  threshold: number;
  /** Whether threshold is fixed or scales with owner count */
  thresholdRule: 'fixed' | 'dynamic';
  /** Admin daily spending limit in USD */
  adminDailyLimitUsd: number;
  /** Admin per-transaction spending limit in USD */
  adminPerTxLimitUsd: number;
  /** Recommended security tier */
  defaultTier: SecurityTierLevel;
  /** Real Circle MSCA modules to install */
  modules: ('weighted_multisig' | 'address_book')[];
  /** Dashboard layout hint for the UI */
  dashboardLayout: string;
}

// ---------------------------------------------------------------------------
// Template Configs (6 non-custom presets)
// ---------------------------------------------------------------------------

export const TREASURY_TEMPLATE_CONFIGS: Record<
  Exclude<TreasuryTemplateId, 'custom'>,
  TreasuryTemplateFullConfig
> = {
  solo_freelancer: {
    id: 'solo_freelancer',
    name: 'Solo Freelancer',
    description: 'Single-owner wallet for independent contractors',
    cardDescription: 'Simple setup for solo operators — one signature, basic limits',
    ownerWeight: 1000,
    threshold: 1000,
    thresholdRule: 'fixed',
    adminDailyLimitUsd: 500,
    adminPerTxLimitUsd: 200,
    defaultTier: 'basic',
    modules: ['weighted_multisig'],
    dashboardLayout: 'invoice_focus',
  },
  startup: {
    id: 'startup',
    name: 'Startup',
    description: '2 equal co-founders — either can approve',
    cardDescription: 'Co-founder treasury with equal signing power',
    ownerWeight: 500,
    threshold: 500,
    thresholdRule: 'fixed',
    adminDailyLimitUsd: 1_000,
    adminPerTxLimitUsd: 500,
    defaultTier: 'standard',
    modules: ['weighted_multisig'],
    dashboardLayout: 'runway_focus',
  },
  agency: {
    id: 'agency',
    name: 'Agency',
    description: '1 owner leads, admins help manage',
    cardDescription: 'Clear lead with admin support for payroll and ops',
    ownerWeight: 700,
    adminWeight: 100,
    threshold: 700,
    thresholdRule: 'fixed',
    adminDailyLimitUsd: 5_000,
    adminPerTxLimitUsd: 2_000,
    defaultTier: 'standard',
    modules: ['weighted_multisig'],
    dashboardLayout: 'payroll_focus',
  },
  import_export: {
    id: 'import_export',
    name: 'Import / Export',
    description: 'Cross-border trade with enhanced security',
    cardDescription: 'High-limit treasury for international trade operations',
    ownerWeight: 500,
    adminWeight: 100,
    threshold: 500,
    thresholdRule: 'fixed',
    adminDailyLimitUsd: 10_000,
    adminPerTxLimitUsd: 5_000,
    defaultTier: 'enhanced',
    modules: WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
      ? ['weighted_multisig', 'address_book']
      : ['weighted_multisig'],
    dashboardLayout: 'trade_focus',
  },
  saas_platform: {
    id: 'saas_platform',
    name: 'SaaS Platform',
    description: 'Revenue-driven treasury for software companies',
    cardDescription: 'Balanced treasury for recurring revenue businesses',
    ownerWeight: 500,
    adminWeight: 150,
    threshold: 500,
    thresholdRule: 'fixed',
    adminDailyLimitUsd: 3_000,
    adminPerTxLimitUsd: 1_500,
    defaultTier: 'standard',
    modules: ['weighted_multisig'],
    dashboardLayout: 'revenue_focus',
  },
  dao: {
    id: 'dao',
    name: 'DAO-style',
    description: 'Everyone equal, majority rules',
    cardDescription: 'Flat governance — threshold scales with member count',
    ownerWeight: 100,
    threshold: 200,
    thresholdRule: 'dynamic',
    adminDailyLimitUsd: 1_000,
    adminPerTxLimitUsd: 500,
    defaultTier: 'enhanced',
    modules: WEIGHTED_MULTISIG_ADDRESS_BOOK_COMPATIBLE
      ? ['weighted_multisig', 'address_book']
      : ['weighted_multisig'],
    dashboardLayout: 'treasury_focus',
  },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/**
 * Calculate the effective threshold for a template given the number of owners.
 *
 * Fixed templates always return their configured threshold; dynamic (DAO) uses
 * `(floor(N/2) + 1) * ownerWeight`.
 */
export function getThresholdForTemplate(
  templateId: Exclude<TreasuryTemplateId, 'custom'>,
  ownerCount: number
): number {
  const config = TREASURY_TEMPLATE_CONFIGS[templateId];
  if (config.thresholdRule === 'fixed') {
    return config.threshold;
  }
  return (Math.floor(ownerCount / 2) + 1) * config.ownerWeight;
}

/** Get the full template configuration by ID; null for 'custom'. */
export function getTemplateConfig(id: TreasuryTemplateId): TreasuryTemplateFullConfig | null {
  if (id === 'custom') return null;
  return TREASURY_TEMPLATE_CONFIGS[id] ?? null;
}
