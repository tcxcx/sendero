/**
 * Per-tenant chain configuration — data-driven, environment-aware.
 *
 * Phase 2 sets up the abstraction so adding a new chain (Phase 3 =
 * Avalanche, Phase 4 = Solana + Arbitrum) is a single-list change. The
 * provisioning, backfill, balance, and route layers all read from
 * these helpers; nothing hardcodes 'ARC-TESTNET' anymore.
 *
 * ── Chain identifier convention ──────────────────────────────────────
 *
 * We use Circle's blockchain identifier format with dashes
 * ('ARC-TESTNET', 'AVAX-FUJI', 'SOL-DEVNET'). This matches:
 *   - `circle_wallets.chain` column values
 *   - Circle webhook `notification.blockchain` field
 *   - Circle SDK `createWallets({ blockchains: [...] })` arg
 *
 * The `kitName` form with underscores ('Arc_Testnet', 'Avalanche_Fuji')
 * lives in `@sendero/circle/gateway` GATEWAY_CHAINS for App Kit
 * compatibility — that's a UI-side detail, not a system-of-record id.
 *
 * ── Mainnet vs testnet ───────────────────────────────────────────────
 *
 * The chain list flips automatically based on `env.isTestnetBeta()`.
 * No additional env knob needed. Mainnet cutover replaces the testnet
 * identifiers with their mainnet counterparts in lockstep.
 */

import { env } from './index';

// ── Chain identifiers ────────────────────────────────────────────────

/**
 * Canonical Circle-format chain identifiers Sendero supports across
 * Phase 2+. Phase 2 enables only ARC; Phase 3 adds AVAX; Phase 4 adds
 * SOL + ARB. Adding here doesn't auto-enable — see
 * `getTenantTreasuryChains` + `getTenantOperationsChains` below for the
 * per-purpose toggles.
 */
export const SENDERO_CHAINS = {
  testnet: {
    arc: 'ARC-TESTNET',
    avax: 'AVAX-FUJI',
    sol: 'SOL-DEVNET',
    base: 'BASE-SEPOLIA',
    optimism: 'OP-SEPOLIA',
    arbitrum: 'ARB-SEPOLIA',
    polygon: 'MATIC-AMOY',
    ethereum: 'ETH-SEPOLIA',
  },
  mainnet: {
    arc: 'ARC',
    avax: 'AVAX',
    sol: 'SOL',
    base: 'BASE',
    optimism: 'OP',
    arbitrum: 'ARB',
    polygon: 'MATIC',
    ethereum: 'ETH',
  },
} as const;

/**
 * Circle Gateway domain IDs per chain. Same number on testnet + mainnet
 * for a given chain (e.g. Solana = 5 on both, Avalanche = 1 on both).
 * Source: https://developers.circle.com/gateway/docs/supported-chains
 */
export const GATEWAY_DOMAIN_BY_CHAIN: Record<string, number> = {
  // Mainnet
  ETH: 0,
  AVAX: 1,
  OP: 2,
  ARB: 3,
  SOL: 5,
  BASE: 6,
  MATIC: 7,
  ARC: 26,
  // Testnet
  'AVAX-FUJI': 1,
  'OP-SEPOLIA': 2,
  'ARB-SEPOLIA': 3,
  'SOL-DEVNET': 5,
  'BASE-SEPOLIA': 6,
  'MATIC-AMOY': 7,
  'ARC-TESTNET': 26,
  'ETH-SEPOLIA': 0,
};

// ── Per-purpose chain lists ──────────────────────────────────────────

/**
 * Shape that both testnet + mainnet conform to. Each property is a
 * Circle blockchain identifier in their dashed format.
 */
type ChainSet = {
  readonly arc: string;
  readonly avax: string;
  readonly sol: string;
  readonly base: string;
  readonly optimism: string;
  readonly arbitrum: string;
  readonly polygon: string;
  readonly ethereum: string;
};

/**
 * Resolve the active chain identifier set based on testnet/mainnet.
 * Internal helper — callers use the per-purpose getters below.
 */
function activeChains(): ChainSet {
  return env.isTestnetBeta() ? SENDERO_CHAINS.testnet : SENDERO_CHAINS.mainnet;
}

/**
 * Chains where each tenant has a treasury Circle SCA wallet. Treasury
 * is the primary balance-holding wallet — settle_split's agency leg
 * lands there, operator UI ops happen there.
 *
 * Phase 2: Arc only. Treasury stays single-chain because settlement
 * still terminates on Arc; multi-chain wouldn't change the math today.
 * Phase 3+ may widen if we move settlement off Arc.
 */
export function getTenantTreasuryChains(): readonly string[] {
  const c = activeChains();
  return [c.arc] as const;
}

/**
 * Chains where each tenant has an operations DCW staging wallet. Inbound
 * USDC lands here, the auto-sweep webhook drains it into the tenant
 * Gateway EOA → Gateway unified balance.
 *
 * Phase 2: Arc only. Phase 3 adds AVAX (corporate-buyer-friendly EVM
 * chain with $-cheap gas; same EOA signs because chainId-aware EIP-3009
 * works on USDC's domain). Phase 4 adds SOL-DEVNET (different
 * provisioning path because Solana can't sign EVM EIP-3009) and
 * ARB-SEPOLIA for Arbitrum testnet coverage.
 *
 * The list IS the seam — adding a chain = appending here. Backfill cron
 * + login hook auto-provision for every existing tenant on next pass.
 */
export function getTenantOperationsChains(): readonly string[] {
  const c = activeChains();
  return [c.arc, c.avax, c.arbitrum, c.sol] as const;
}

/**
 * Circle Gateway domain IDs the tenant operates on. Derived from
 * `getTenantOperationsChains()` so the chain list stays the single
 * source of truth.
 */
export function getEnabledGatewayDomains(): number[] {
  return getTenantOperationsChains()
    .map(chain => GATEWAY_DOMAIN_BY_CHAIN[chain])
    .filter((domain): domain is number => typeof domain === 'number');
}

/**
 * True when the chain identifier is one Sendero supports right now
 * (in either treasury or operations role). Useful for webhook dispatch
 * and route validation.
 */
export function isSupportedChain(chain: string): boolean {
  const treasury = getTenantTreasuryChains();
  const ops = getTenantOperationsChains();
  return treasury.includes(chain) || ops.includes(chain);
}

/**
 * Map a Circle chain identifier to its Gateway domain ID. Returns
 * null for chains we don't support (caller filters / skips).
 */
export function gatewayDomainFor(chain: string): number | null {
  return GATEWAY_DOMAIN_BY_CHAIN[chain] ?? null;
}
