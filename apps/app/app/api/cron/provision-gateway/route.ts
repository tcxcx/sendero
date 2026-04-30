/**
 * GET /api/cron/provision-gateway
 *
 * Phase 1 P1.7 + Phase 2 P2.7 — sweeper that fills gaps left when:
 *   - The synchronous `organization.created` Clerk webhook couldn't
 *     provision Gateway artifacts (transient Circle API failure,
 *     missing env, partial state).
 *   - A Phase 3+ chain is added to `getTenantOperationsChains()` and
 *     existing tenants need the new ops DCW backfilled.
 *
 * For each candidate tenant, ensures three categories of rows:
 *   1. TenantGatewaySigner — per-tenant Gateway EOA, encrypted at
 *      rest. getOrCreateGatewaySigner is idempotent + race-safe.
 *   2. CircleWallet(kind='operations', chain=…) for every chain in
 *      `getTenantOperationsChains()`. Phase 2 = ARC only; Phase 3+
 *      auto-widens via the env-driven config.
 *   3. TenantGatewayConfig — depositor address + enabled domain set
 *      derived from the chain config. Upsert merges domains so adding
 *      a chain doesn't retract previously enabled ones.
 *
 * Auth: CRON_SECRET via Authorization: Bearer header (Vercel injects).
 * Schedule: every 30 minutes (vercel.json). Bounded to 50 candidates
 * per run.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { backfillTenantOpsDcws } from '@sendero/circle/gateway-backfill';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';
import {
  GATEWAY_DOMAIN_BY_CHAIN,
  getEnabledGatewayDomains,
  getTenantOperationsChains,
} from '@sendero/env/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_SIZE = 50;

interface ProvisionResult {
  tenantId: string;
  clerkOrgId: string;
  status: 'provisioned' | 'partial' | 'skipped' | 'failed';
  signerProvisioned?: boolean;
  opsChainsProvisioned?: string[];
  opsChainsFailed?: Array<{ chain: string; error: string }>;
  configProvisioned?: boolean;
  error?: string;
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const requiredOpsChains = getTenantOperationsChains();

  // Candidates: tenants missing any of (signer, config, ops DCW on
  // any required chain). Two queries unioned, deduped:
  //   1) Tenants with signer or config null — catches brand-new and
  //      brand-failed.
  //   2) Tenants with signer + config but missing an ops DCW on at
  //      least one required chain — catches partial provisioning AND
  //      Phase 3+ chain expansion (existing tenants need the new
  //      chain's ops DCW).
  const newTenantCandidates = await prisma.tenant.findMany({
    where: {
      OR: [{ gatewaySigner: null }, { gatewayConfig: null }],
    },
    select: { id: true, clerkOrgId: true },
    take: BATCH_SIZE,
  });

  const opsGapCandidates = await prisma.tenant.findMany({
    where: {
      gatewaySigner: { isNot: null },
      gatewayConfig: { isNot: null },
      // Each tenant whose ops DCW chain count is less than the active
      // required-chains count is a candidate. This single Prisma
      // expression covers Phase 3+ chain expansion uniformly.
      OR: requiredOpsChains.map(chain => ({
        circleWallets: { none: { kind: 'operations', chain } },
      })),
    },
    select: { id: true, clerkOrgId: true },
    take: BATCH_SIZE,
  });

  const seen = new Set(newTenantCandidates.map(c => c.id));
  const candidates = [...newTenantCandidates];
  for (const c of opsGapCandidates) {
    if (!seen.has(c.id)) {
      candidates.push(c);
      seen.add(c.id);
    }
  }

  const results: ProvisionResult[] = [];
  for (const c of candidates) {
    if (!c.clerkOrgId) continue;
    const result: ProvisionResult = {
      tenantId: c.id,
      clerkOrgId: c.clerkOrgId,
      status: 'skipped',
      signerProvisioned: false,
      opsChainsProvisioned: [],
      opsChainsFailed: [],
      configProvisioned: false,
    };

    try {
      // Step 1: signer (idempotent — returns existing if present).
      const signer = await getOrCreateGatewaySigner(c.id);
      result.signerProvisioned = true;

      // Step 2: ops DCWs across every required chain (idempotent +
      // race-safe via the (tenantId, kind, chain) unique constraint).
      const opsResult = await backfillTenantOpsDcws({
        tenantId: c.id,
        clerkOrgId: c.clerkOrgId,
      });
      result.opsChainsProvisioned = opsResult.created;
      result.opsChainsFailed = opsResult.failed;

      // Step 3: TenantGatewayConfig with the latest enabled domains.
      // Upsert merges domains so adding a chain doesn't retract
      // previously enabled ones.
      const requiredDomains = getEnabledGatewayDomains();
      const actualOpsWallets = await prisma.circleWallet.findMany({
        where: { tenantId: c.id, kind: 'operations', chain: { in: [...requiredOpsChains] } },
        select: { chain: true },
      });
      const actualDomains = actualOpsWallets
        .map(w => GATEWAY_DOMAIN_BY_CHAIN[w.chain])
        .filter((domain): domain is number => typeof domain === 'number');
      const enabledDomains = mergeUniqueSorted(undefined, actualDomains);
      const missingDomains = requiredDomains.filter(domain => !enabledDomains.includes(domain));
      const solanaOpsWallet = await prisma.circleWallet.findFirst({
        where: {
          tenantId: c.id,
          kind: 'operations',
          chain: { in: ['SOL-DEVNET', 'SOL'] },
        },
        select: { address: true },
        orderBy: { createdAt: 'asc' },
      });
      await prisma.tenantGatewayConfig.upsert({
        where: { tenantId: c.id },
        create: {
          tenantId: c.id,
          evmDepositorAddress: signer.address,
          solanaDepositorAddress: solanaOpsWallet?.address ?? null,
          enabledDomains,
        },
        update: {
          evmDepositorAddress: signer.address,
          solanaDepositorAddress: solanaOpsWallet?.address ?? undefined,
          enabledDomains: { set: enabledDomains },
        },
      });
      result.configProvisioned = true;

      result.status =
        (result.opsChainsFailed?.length ?? 0) > 0 || missingDomains.length > 0
          ? 'partial'
          : 'provisioned';
    } catch (err) {
      result.status = result.signerProvisioned ? 'partial' : 'failed';
      result.error = err instanceof Error ? err.message : String(err);
      console.warn('[cron/provision-gateway] partial/failed', {
        tenantId: c.id,
        result,
      });
    }
    results.push(result);
  }

  const summary = {
    total: results.length,
    provisioned: results.filter(r => r.status === 'provisioned').length,
    partial: results.filter(r => r.status === 'partial').length,
    failed: results.filter(r => r.status === 'failed').length,
    skipped: results.filter(r => r.status === 'skipped').length,
    requiredOpsChains: [...requiredOpsChains],
  };

  console.log('[cron/provision-gateway] run complete', summary);

  return NextResponse.json({ ok: true, ...summary, results });
}

/**
 * Union of two domain ID sets, deduped, sorted ascending. Adding a
 * chain to the config is monotonic — we never retract a domain a
 * tenant has been transacting on.
 */
function mergeUniqueSorted(existing: number[] | undefined, incoming: number[]): number[] {
  const merged = new Set<number>(existing ?? []);
  for (const d of incoming) merged.add(d);
  return [...merged].sort((a, b) => a - b);
}
