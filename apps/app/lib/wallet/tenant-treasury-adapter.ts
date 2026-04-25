/**
 * Tenant treasury context for `kit.depositFor`.
 *
 * Mirrors `apps/app/lib/transfer-policy/app-kit.ts` — same pattern, but
 * the signer is the corporate treasury EOA (`TREASURY_PRIVATE_KEY`)
 * rather than the spend delegate. The treasury credits travelers'
 * unified balances via Gateway's permissionless depositFor; no traveler
 * signature is required.
 *
 * Today: a single platform-level treasury serves every tenant (testnet
 * beta). The `tenantId` argument is plumbed through so we can branch
 * to per-tenant CircleWallets later without changing callers.
 */

import { UnifiedBalanceKit } from '@circle-fin/unified-balance-kit';
import type { ViemAdapter } from '@circle-fin/adapter-viem-v2';

import { getTreasuryAdapter, getTreasuryAddress } from '@sendero/circle';

export interface TenantTreasury {
  kit: UnifiedBalanceKit;
  adapter: ViemAdapter;
  address: string;
}

let cached: { kit: UnifiedBalanceKit; adapter: ViemAdapter; address: string } | null = null;

export function getTenantTreasury(_tenantId: string): TenantTreasury | null {
  if (cached) return cached;
  let adapter: ViemAdapter;
  let address: string;
  try {
    adapter = getTreasuryAdapter();
    address = getTreasuryAddress();
  } catch {
    return null;
  }
  const kit = new UnifiedBalanceKit();
  cached = { kit, adapter, address };
  return cached;
}
