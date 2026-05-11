/**
 * Mint a signed invite token for the corporate-customer Slack install
 * flow (Flow B). The TMC operator generates this from the customer-
 * account detail page; the resulting URL is emailed to the corporate
 * admin, who clicks → Slack OAuth → install lands as
 * `SlackInstall { kind: 'customer_account', customerAccountId: ... }`.
 *
 * Signed token shape + secret: `lib/customer-account-invite.ts`.
 *
 * The URL we return points at the existing Slack OAuth init endpoint
 * with the invite token as `state` — Flow B-aware OAuth callback work
 * lands in Phase 2 of the rollout; for Phase 1 we just mint + verify.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { prisma } from '@sendero/database';

import { signCustomerAccountInvite } from '@/lib/customer-account-invite';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { orgId, userId } = await auth();
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  }

  const { id: customerAccountId } = await params;
  // Tenant-bind in WHERE — prevents a TMC operator at one tenant
  // from minting an invite for a customer account at another tenant.
  const account = await prisma.customerAccount.findFirst({
    where: { id: customerAccountId, tenantId: tenant.id },
    select: { id: true, displayName: true, status: true },
  });
  if (!account) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const token = signCustomerAccountInvite(tenant.id, account.id);

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3010';
  // Phase 1: the URL is a placeholder route. Phase 2 wires
  // /install/slack/customer-account → Slack OAuth flow that branches on
  // the verified token. For now, the operator sees the URL + can copy
  // it; clicking it will land on a "coming soon" page until Phase 2.
  const inviteUrl = `${appOrigin.replace(/\/$/, '')}/install/slack/customer-account?token=${encodeURIComponent(
    token
  )}`;

  return NextResponse.json({
    inviteUrl,
    token,
    expiresInSeconds: 3600,
    accountId: account.id,
    accountDisplayName: account.displayName,
  });
}
