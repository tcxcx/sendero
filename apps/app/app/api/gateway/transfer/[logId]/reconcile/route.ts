/**
 * POST /api/gateway/transfer/[logId]/reconcile
 *
 * Phase 5 P5.5 — operator-triggered per-row reconcile. The cron at
 * `/api/cron/reconcile-gateway-transfers` is the autonomous version;
 * this route exists for the case where an operator is staring at a
 * "still attesting after 4 minutes" row in the dashboard and wants to
 * pull truth from Circle right now without waiting for the next cron
 * tick.
 *
 * Tenant-scoped: route requires a Clerk session AND the row's tenantId
 * must equal the session org's tenantId. Cross-tenant lookups return
 * the same `transfer_not_found` shape as missing rows so existence
 * isn't leaked.
 *
 * Throttle: rows hydrated within `MIN_RECONCILE_GAP_MS` return
 * `{ throttled: true }` instead of hammering Circle. Operator-button
 * spam shouldn't be more aggressive than the cron.
 *
 * Body: none. Path provides the log id.
 */

import { NextRequest, NextResponse } from 'next/server';

import { auth } from '@clerk/nextjs/server';
import { hydrateTransferFromCircle } from '@sendero/circle/gateway-reconcile';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Minimum wait between hydrations on the same row. 30s gives Circle
 *  time to actually progress between two fetches and prevents an
 *  excited operator from spamming the API. */
const MIN_RECONCILE_GAP_MS = 30_000;

export async function POST(req: NextRequest, { params }: { params: Promise<{ logId: string }> }) {
  const { orgId } = await auth();
  if (!orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const { logId } = await params;
  const row = await prisma.gatewayTransferLog.findUnique({
    where: { id: logId },
    select: {
      id: true,
      tenantId: true,
      circleTransferId: true,
      lastReconciledAt: true,
    },
  });

  // Same shape on missing + cross-tenant — the operator UI should never
  // be able to probe for the existence of another tenant's transfers.
  if (!row || row.tenantId !== tenant.id) {
    return NextResponse.json({ error: 'transfer_not_found' }, { status: 404 });
  }

  if (!row.circleTransferId) {
    return NextResponse.json(
      {
        error: 'no_circle_transfer_id',
        hint: 'transfer never reached Circle — nothing to reconcile',
      },
      { status: 409 }
    );
  }

  if (row.lastReconciledAt && Date.now() - row.lastReconciledAt.getTime() < MIN_RECONCILE_GAP_MS) {
    return NextResponse.json({
      ok: true,
      throttled: true,
      lastReconciledAt: row.lastReconciledAt.toISOString(),
      retryAfterMs: MIN_RECONCILE_GAP_MS - (Date.now() - row.lastReconciledAt.getTime()),
    });
  }

  const result = await hydrateTransferFromCircle(row.id, row.circleTransferId);

  return NextResponse.json({ ok: !result.error, result });
}
