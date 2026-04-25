/**
 * GET /api/channels/whatsapp/install
 *
 * Live snapshot of the active tenant's WhatsAppInstall row. The wizard's
 * VerifyNumberPane polls this every few seconds while the operator
 * completes Meta Embedded Signup in the Kapso-hosted page — once the
 * `whatsapp.phone_number.created` webhook lands and writes
 * `phoneNumberId`, the pane enables Continue and the wizard advances.
 *
 * Tenant-scoped via `requireCurrentTenant()`.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { requireCurrentTenant } from '@/lib/tenant-context';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const { tenant } = await requireCurrentTenant();
  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId: tenant.id },
    select: {
      status: true,
      phoneNumberId: true,
      displayPhoneNumber: true,
      businessDisplayName: true,
      kapsoCustomerId: true,
      kapsoConnectionId: true,
      lastErrorMessage: true,
      metadata: true,
    },
  });
  if (!install) {
    return NextResponse.json({ install: null });
  }
  const metadata = (install.metadata as Record<string, unknown> | null) ?? {};
  return NextResponse.json({
    install: {
      status: install.status,
      phoneNumberId: install.phoneNumberId,
      displayPhoneNumber: install.displayPhoneNumber,
      businessDisplayName: install.businessDisplayName,
      kapsoCustomerId: install.kapsoCustomerId,
      kapsoConnectionId: install.kapsoConnectionId,
      lastErrorMessage: install.lastErrorMessage,
      setupLinkUrl: typeof metadata.setupLinkUrl === 'string' ? metadata.setupLinkUrl : null,
      setupLinkExpiresAt:
        typeof metadata.setupLinkExpiresAt === 'string' ? metadata.setupLinkExpiresAt : null,
      provisioned: install.status === 'active' && Boolean(install.phoneNumberId),
    },
  });
}
