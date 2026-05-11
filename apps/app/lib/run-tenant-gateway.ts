/**
 * Circle Gateway phase 1 provisioning — extracted from the Clerk
 * webhook so it runs on every provisioning path (dev endpoint included).
 *
 * Provisions:
 *   - TenantGatewaySigner — single EVM signer per tenant for Gateway
 *     burn intents.
 *   - One ops DCW per chain in `getTenantOperationsChains()` — the
 *     wallets that hold pending deposits / sourceDepositor balances.
 *   - TenantGatewayConfig — Sendero-side row pointing at the EVM signer
 *     and the Solana ops DCW; enables Gateway features per tenant.
 *
 * Non-fatal. A backfill cron picks up tenants missing config rows on
 * subsequent runs. Treasury alone is enough for sandbox bookings;
 * Gateway is only on the unified-balance + auto-sweep hot path.
 */

import { provisionTenantOpsDcw } from '@sendero/circle/gateway-ops-wallet';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import { getEnabledGatewayDomains, getTenantOperationsChains } from '@sendero/env/chains';

export interface RunTenantGatewayArgs {
  tenantId: string;
  clerkOrgId: string;
}

export interface RunTenantGatewayResult {
  ok: boolean;
  signerAddress: string | null;
  solanaDepositorAddress: string | null;
  error: string | null;
}

export async function runTenantGateway(
  args: RunTenantGatewayArgs
): Promise<RunTenantGatewayResult> {
  const { tenantId, clerkOrgId } = args;
  try {
    const signer = await getOrCreateGatewaySigner(tenantId);

    const opsWallets = await Promise.all(
      getTenantOperationsChains().map(chain =>
        provisionTenantOpsDcw({
          tenantId,
          clerkOrgId,
          chain,
        })
      )
    );
    // Solana ops DCWs are the ones with a base58 (non-0x) address.
    const solanaOpsWallet = opsWallets.find(w => !w.address.startsWith('0x'));

    await prisma.tenantGatewayConfig.upsert({
      where: { tenantId },
      create: {
        tenantId,
        evmDepositorAddress: signer.address,
        solanaDepositorAddress: solanaOpsWallet?.address ?? null,
        enabledDomains: getEnabledGatewayDomains(),
      },
      update: {
        evmDepositorAddress: signer.address,
        solanaDepositorAddress: solanaOpsWallet?.address ?? undefined,
        enabledDomains: { set: getEnabledGatewayDomains() },
      },
    });

    console.log('[run-tenant-gateway] provisioned', {
      tenantId,
      depositor: signer.address,
      solanaDepositor: solanaOpsWallet?.address ?? null,
    });

    return {
      ok: true,
      signerAddress: signer.address,
      solanaDepositorAddress: solanaOpsWallet?.address ?? null,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('[run-tenant-gateway] failed (non-fatal)', { tenantId, error: message });
    return {
      ok: false,
      signerAddress: null,
      solanaDepositorAddress: null,
      error: message,
    };
  }
}
