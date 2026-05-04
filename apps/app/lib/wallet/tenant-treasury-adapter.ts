/**
 * Tenant treasury context for prefunds.
 *
 * Thin shim over `@sendero/circle/unified-gateway`. The kit instance,
 * adapter, and treasury address all come from the centralized service —
 * this file knows only that "treasury → traveler" is a `depositFor`
 * call and which env vars must be set.
 *
 * Today: a single platform-level treasury serves every tenant
 * (testnet beta). The `tenantId` argument is plumbed through so we
 * can branch to per-tenant CircleWallets later without changing
 * callers.
 */

import {
  type GatewayChainKey,
  type Principal,
  depositFor as unifiedDepositFor,
  resolveUnifiedBalanceChain,
  treasuryPrincipal,
} from '@sendero/circle';

export interface TenantTreasury {
  principal: Principal;
  address: string;
  /**
   * Cross-account deposit — treasury pays, `depositAccount` is credited
   * on Gateway. The chain string is normalized through
   * `resolveUnifiedBalanceChain` so callers can pass either Sendero
   * keys (`Arc_Testnet`) or App Kit names (`Solana_Devnet`).
   */
  depositFor(args: {
    amount: string;
    sourceChain: string;
    depositAccount: string;
  }): Promise<{ txHash: string; explorerUrl?: string }>;
}

let cached: TenantTreasury | null = null;

export function getTenantTreasury(_tenantId: string): TenantTreasury | null {
  if (cached) return cached;
  const principal = treasuryPrincipal();
  if (!principal) return null;
  cached = {
    principal,
    address: principal.address,
    async depositFor({ amount, sourceChain, depositAccount }) {
      const chainKey: GatewayChainKey = resolveUnifiedBalanceChain(sourceChain);
      return unifiedDepositFor({ principal, chainKey, amount, depositAccount });
    },
  };
  return cached;
}
