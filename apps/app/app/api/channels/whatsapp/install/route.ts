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
import { readSetupLinkSnapshot } from '@sendero/kapso';

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
  const setupLink = readSetupLinkSnapshot(install.metadata);
  return NextResponse.json({
    install: {
      status: install.status,
      phoneNumberId: install.phoneNumberId,
      displayPhoneNumber: install.displayPhoneNumber,
      businessDisplayName: install.businessDisplayName,
      kapsoCustomerId: install.kapsoCustomerId,
      kapsoConnectionId: install.kapsoConnectionId,
      lastErrorMessage: install.lastErrorMessage,
      setupLinkUrl: setupLink?.url ?? null,
      setupLinkExpiresAt: setupLink?.expires_at ?? null,
      setupLinkStatus: setupLink?.status ?? null,
      setupLinkError: setupLink?.whatsapp_setup_error ?? null,
      setupLinkProvisionPhoneNumber: setupLink?.provision_phone_number ?? null,
      provisioned: install.status === 'active' && Boolean(install.phoneNumberId),
    },
  });
}
