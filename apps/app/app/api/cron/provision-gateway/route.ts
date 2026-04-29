/**
 * GET /api/cron/provision-gateway
 *
 * Phase 1 P1.7 — sweeper that fills gaps left when the synchronous
 * `organization.created` webhook couldn't provision Gateway artifacts
 * (transient Circle API failure, partial outage, missing env). The
 * webhook handler intentionally treats Gateway provisioning as
 * non-fatal so onboarding doesn't block; this cron makes sure no
 * tenant stays stuck without Gateway.
 *
 * For each candidate tenant, ensures three rows exist:
 *   1. TenantGatewaySigner — per-tenant Gateway EOA, encrypted at
 *      rest. getOrCreateGatewaySigner is idempotent + race-safe.
 *   2. CircleWallet(kind='operations', chain='ARC-TESTNET') — the ops
 *      DCW that receives inbound USDC for the Phase 1 sweep loop.
 *      Phase 3+ widens to per-chain rows as enabled domains expand.
 *   3. TenantGatewayConfig — depositor address + enabled domain set.
 *      Default Phase 1 = [26] (Arc Testnet only).
 *
 * Auth: CRON_SECRET header match (Vercel injects automatically).
 * Scheduled in apps/app/vercel.json.
 *
 * Bounded to 50 candidates per run. Tenants with all three rows
 * already present are filtered out at the query level.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { provisionTenantOpsDcw } from '@sendero/circle/gateway-ops-wallet';
import { getOrCreateGatewaySigner } from '@sendero/circle/gateway-signer';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PHASE_1_CHAIN = 'ARC-TESTNET';
const PHASE_1_DOMAINS = [26];
const BATCH_SIZE = 50;

interface ProvisionResult {
  tenantId: string;
  clerkOrgId: string;
  status: 'provisioned' | 'partial' | 'skipped' | 'failed';
  signerProvisioned?: boolean;
  opsDcwProvisioned?: boolean;
  configProvisioned?: boolean;
  error?: string;
}

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Candidates: tenants missing any of (signer, config, ops DCW on Arc).
  // Use a coarse filter (signer OR config null) to find work, then
  // probe ops DCW per row — keeps the SQL simple while still narrowing
  // the candidate set on the hot path.
  const candidates = await prisma.tenant.findMany({
    where: {
      clerkOrgId: { not: null },
      OR: [{ gatewaySigner: null }, { gatewayConfig: null }],
    },
    select: { id: true, clerkOrgId: true },
    take: BATCH_SIZE,
  });

  // Augment with tenants who have signer + config but missing ops DCW
  // on Arc. The above query catches new tenants; this catches a partial
  // provision that landed signer + config but not the ops DCW.
  const opsGapCandidates = await prisma.tenant.findMany({
    where: {
      clerkOrgId: { not: null },
      gatewaySigner: { isNot: null },
      gatewayConfig: { isNot: null },
      circleWallets: {
        none: { kind: 'operations', chain: PHASE_1_CHAIN },
      },
    },
    select: { id: true, clerkOrgId: true },
    take: BATCH_SIZE,
  });

  const seen = new Set(candidates.map(c => c.id));
  for (const c of opsGapCandidates) {
    if (!seen.has(c.id)) candidates.push(c);
  }

  const results: ProvisionResult[] = [];
  for (const c of candidates) {
    if (!c.clerkOrgId) continue;
    const result: ProvisionResult = {
      tenantId: c.id,
      clerkOrgId: c.clerkOrgId,
      status: 'skipped',
      signerProvisioned: false,
      opsDcwProvisioned: false,
      configProvisioned: false,
    };

    try {
      // Step 1: signer (idempotent — returns existing if present).
      const signer = await getOrCreateGatewaySigner(c.id);
      result.signerProvisioned = true;

      // Step 2: ops DCW on Arc (idempotent on (tenantId, kind, chain)).
      await provisionTenantOpsDcw({
        tenantId: c.id,
        clerkOrgId: c.clerkOrgId,
        chain: PHASE_1_CHAIN,
      });
      result.opsDcwProvisioned = true;

      // Step 3: TenantGatewayConfig with Phase 1 enabled domain.
      // Upsert keeps existing config intact while ensuring the row
      // exists; we only refresh evmDepositorAddress so a previous
      // partial config gets corrected if signer regenerated (shouldn't
      // happen, but defensive).
      await prisma.tenantGatewayConfig.upsert({
        where: { tenantId: c.id },
        create: {
          tenantId: c.id,
          evmDepositorAddress: signer.address,
          enabledDomains: PHASE_1_DOMAINS,
        },
        update: {
          evmDepositorAddress: signer.address,
        },
      });
      result.configProvisioned = true;

      result.status = 'provisioned';
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
  };

  console.log('[cron/provision-gateway] run complete', summary);

  return NextResponse.json({ ok: true, ...summary, results });
}
