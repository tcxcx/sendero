/**
 * Tenant provisioning orchestrator — chain-aware + progress-stamping.
 *
 * Single source of truth for "what happens after a Tenant row exists
 * with a chosen primaryChain." Consumed by:
 *   - `/api/webhooks/clerk` (organization.created path, prod)
 *   - `/api/dev/complete-org-provisioning` (local dev fallback)
 *   - Future: retry crons (today they only fix wallet+identity stage-by-stage)
 *
 * The pre-existing `ensurePrimaryChainProvisioned` already branches on
 * primaryChain. This wrapper adds progress stamping at each stage so
 * the wait screen can render real state. It also owns the Clerk
 * publicMetadata flip so callers don't duplicate that logic.
 *
 * Idempotent — the underlying provisioners short-circuit when their
 * outputs already exist. `attempts` in Tenant.metadata.provisioning
 * increments on every re-entry so we can see retries.
 *
 * Failure model:
 *   - Treasury failure is fatal → state goes `failed`, throws, caller
 *     returns 500, svix/clerk retries.
 *   - Identity failure is non-fatal → stage stamped `failed`, but
 *     finalize still runs and onboardingComplete still flips. The
 *     retry-identity-provision cron picks up the OnchainIdentity row.
 */

import { clerkClient } from '@clerk/nextjs/server';

import { ensurePrimaryChainProvisioned } from '@/lib/provision-tenant-on-chain-choice';
import { beginProvisioning, stampStage } from '@/lib/provisioning-progress';
import { runTenantGateway } from '@/lib/run-tenant-gateway';

export interface RunTenantProvisioningArgs {
  tenantId: string;
  clerkOrgId: string;
  primaryChain: 'arc' | 'sol';
}

export interface RunTenantProvisioningResult {
  chain: 'arc' | 'sol';
  address: string | null;
  alreadyExisted: boolean;
  identityStatus: string | null;
  identityError: string | null;
}

export async function runTenantProvisioning(
  args: RunTenantProvisioningArgs
): Promise<RunTenantProvisioningResult> {
  const { tenantId, clerkOrgId, primaryChain } = args;

  await beginProvisioning({ tenantId, chain: primaryChain });

  // --- Stage 1: treasury wallet ---------------------------------------
  await stampStage({ tenantId, stage: 'treasury', status: 'running' });

  // ensurePrimaryChainProvisioned bundles wallet + identity into one
  // call. We need them stamped separately, so we still call it once,
  // then reflect its results into both stamps below.
  const provisioned = await ensurePrimaryChainProvisioned({
    tenantId,
    clerkOrgId,
    primaryChain,
  });

  if (provisioned.walletError || !provisioned.address) {
    await stampStage({
      tenantId,
      stage: 'treasury',
      status: 'failed',
      error: provisioned.walletError ?? 'no_address',
    });
    throw new Error(
      `[runTenantProvisioning] treasury failed (${primaryChain}): ${provisioned.walletError ?? 'no_address'}`
    );
  }

  await stampStage({
    tenantId,
    stage: 'treasury',
    status: 'done',
    extras: { address: provisioned.address, alreadyExisted: provisioned.alreadyExisted },
  });

  // --- Stage 2: identity (non-fatal) ---------------------------------
  await stampStage({ tenantId, stage: 'identity', status: 'running' });
  if (provisioned.identityError) {
    await stampStage({
      tenantId,
      stage: 'identity',
      status: 'failed',
      error: provisioned.identityError,
    });
  } else {
    await stampStage({
      tenantId,
      stage: 'identity',
      status: 'done',
      extras: { identityStatus: provisioned.identityStatus },
    });
  }

  // --- Stage 3: finalize (Gateway + Clerk publicMetadata flip) ------
  // Gateway provisioning is non-fatal; the cron sweeper picks up
  // missing TenantGatewayConfig / signer / ops DCWs on the next run.
  // We attempt it inline here so the operator dashboard sees the
  // unified balance widget light up without waiting for a cron tick.
  await stampStage({ tenantId, stage: 'finalize', status: 'running' });
  const gateway = await runTenantGateway({ tenantId, clerkOrgId });
  try {
    const client = await clerkClient();
    await client.organizations.updateOrganization(clerkOrgId, {
      publicMetadata: {
        tenantId,
        primaryChain,
        ...(primaryChain === 'sol'
          ? { solTreasuryAddress: provisioned.address }
          : { arcWalletAddress: provisioned.address }),
        onboardingComplete: true,
      },
    });
    await stampStage({
      tenantId,
      stage: 'finalize',
      status: 'done',
      extras: {
        gatewayOk: gateway.ok,
        gatewaySignerAddress: gateway.signerAddress,
        gatewaySolanaDepositor: gateway.solanaDepositorAddress,
        gatewayError: gateway.error,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await stampStage({ tenantId, stage: 'finalize', status: 'failed', error: message });
    throw err;
  }

  return {
    chain: primaryChain,
    address: provisioned.address,
    alreadyExisted: provisioned.alreadyExisted,
    identityStatus: provisioned.identityStatus,
    identityError: provisioned.identityError,
  };
}
