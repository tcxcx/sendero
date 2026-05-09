/**
 * Shared cascade trigger for the corporate + agency onboarding flows.
 *
 * Once the Tenant row is upserted with a chosen `primaryChain`, this
 * helper fires the matching provisioning path so the tenant lands on
 * the next page (Slack OAuth install for corporate, confirmation page
 * for agency) with their wallet + identity already in flight. Mirrors
 * the Clerk `organization.created` webhook fork at
 * `apps/app/app/api/webhooks/clerk/route.ts:354`.
 *
 * Why this lives in the app and not in `@sendero/circle`:
 * - The flow-level decision ("which provisioner to call given the
 *   chain choice") belongs to the application layer; the package layer
 *   exposes the mechanics (`provisionTenantWallet`,
 *   `provisionTenantSolanaTreasury`, `ensureOrgIdentity`).
 * - Errors are absorbed (logged, not thrown) so a transient Circle 5xx
 *   on a busy onboarding doesn't 500 the form action. The
 *   `retry-wallet-provision` + `retry-solana-wallet-provision` crons
 *   sweep up the long tail.
 *
 * Side effects:
 * - For 'arc': writes a CircleWallet row of kind='treasury', chain='ARC-TESTNET'.
 * - For 'sol': writes a CircleWallet row of kind='treasury', chain='SOL-DEVNET'.
 * - Best-effort `ensureOrgIdentity` writes an OnchainIdentity row with
 *   matching `chain` (ERC-8004 mint on Arc, intent row on Sol pending
 *   Metaplex Agent Registry adapter).
 *
 * Returns the resolved address + a flag indicating whether the wallet
 * was already provisioned (idempotent across re-submits).
 */

import { provisionTenantWallet } from '@sendero/circle';
import { provisionTenantSolanaTreasury } from '@sendero/circle/provision-tenant-solana-treasury';
import { ensureOrgIdentity } from '@sendero/tools/provision-identity';

export interface EnsurePrimaryChainProvisionedArgs {
  tenantId: string;
  clerkOrgId: string;
  primaryChain: 'arc' | 'sol';
}

export interface EnsurePrimaryChainProvisionedResult {
  chain: 'arc' | 'sol';
  /** Treasury address — `0x…` on Arc, base58 on Sol. */
  address: string | null;
  alreadyExisted: boolean;
  /** OnchainIdentity row status, or null if the call failed (non-fatal). */
  identityStatus: string | null;
  /** Provisioning failure reason (transport-level), or null on success. */
  walletError: string | null;
  identityError: string | null;
}

export async function ensurePrimaryChainProvisioned(
  args: EnsurePrimaryChainProvisionedArgs
): Promise<EnsurePrimaryChainProvisionedResult> {
  const out: EnsurePrimaryChainProvisionedResult = {
    chain: args.primaryChain,
    address: null,
    alreadyExisted: false,
    identityStatus: null,
    walletError: null,
    identityError: null,
  };

  if (args.primaryChain === 'sol') {
    try {
      const wallet = await provisionTenantSolanaTreasury({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
      });
      out.address = wallet.address;
      out.alreadyExisted = wallet.alreadyExisted ?? false;
    } catch (err) {
      out.walletError = err instanceof Error ? err.message : String(err);
      console.warn('[ensurePrimaryChainProvisioned] sol treasury failed', {
        tenantId: args.tenantId,
        error: out.walletError,
      });
      // Bail before identity — without a treasury wallet ensureOrgIdentity
      // would fail anyway with "no holder" and the cron will retry both.
      return out;
    }
  } else {
    try {
      const result = await provisionTenantWallet({
        tenantId: args.tenantId,
        clerkOrgId: args.clerkOrgId,
      });
      out.address = result.address;
      out.alreadyExisted = result.alreadyExisted ?? false;
    } catch (err) {
      out.walletError = err instanceof Error ? err.message : String(err);
      console.warn('[ensurePrimaryChainProvisioned] arc treasury failed', {
        tenantId: args.tenantId,
        error: out.walletError,
      });
      return out;
    }
  }

  try {
    const identity = await ensureOrgIdentity({ tenantId: args.tenantId });
    out.identityStatus = identity.status;
  } catch (err) {
    out.identityError = err instanceof Error ? err.message : String(err);
    console.warn('[ensurePrimaryChainProvisioned] identity failed (non-fatal)', {
      tenantId: args.tenantId,
      chain: args.primaryChain,
      error: out.identityError,
    });
  }

  return out;
}
