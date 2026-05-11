/**
 * GET /api/handoffs/[id]/status
 *
 * Poll endpoint for `request_booking_approval` (B2B2B Phase 3) and any
 * other agent-side waiter on a ChannelHandoff. Returns the current
 * status + decision metadata. Tenant-scoped via API key OR Clerk
 * session — same auth surface as the rest of the agent dispatch path.
 *
 * Response:
 *   { status: 'pending' | 'approved' | 'rejected' | 'answered' | 'closed',
 *     kind: 'support_question' | 'approval_request',
 *     decidedAt?: ISO, decidedBy?: userId,
 *     answer?: string (for support_question),
 *     metadata?: object (passthrough — priceUsd, threshold, etc.) }
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveTenantId(req: NextRequest): Promise<string | null> {
  const apiKey = await resolveTenantFromApiKey(req).catch(() => null);
  if (apiKey?.tenantId) return apiKey.tenantId;
  const { orgId } = await auth();
  if (!orgId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  return tenant?.id ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const tenantId = await resolveTenantId(req);
  if (!tenantId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const handoff = await prisma.channelHandoff.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      kind: true,
      status: true,
      metadata: true,
      answer: true,
      answeredByUserId: true,
      answeredAt: true,
      closedAt: true,
    },
  });
  if (!handoff) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({
    id: handoff.id,
    kind: handoff.kind,
    status: handoff.status,
    decidedAt: handoff.answeredAt?.toISOString() ?? null,
    decidedBy: handoff.answeredByUserId,
    answer: handoff.answer,
    metadata: handoff.metadata,
  });
}
