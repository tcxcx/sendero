/**
 * Resolve the operator email for a tenant — used by trip-event email
 * notifications (hold-approval pings, booking-confirmed cc).
 *
 * Resolution order:
 *   1. `tenant.billingContactEmail` (already set by ops onboarding for
 *      paying customers; matches what we use for invoicing)
 *   2. The first active `agency_admin` Membership's User.email
 *   3. null — caller decides whether to fall back or skip the send
 */

import { prisma } from '@sendero/database';

export async function getTenantNotificationEmail(tenantId: string): Promise<string | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { billingContactEmail: true },
  });
  if (tenant?.billingContactEmail) return tenant.billingContactEmail;

  const adminMembership = await prisma.membership.findFirst({
    where: { tenantId, role: 'agency_admin', status: 'active' },
    orderBy: { joinedAt: 'asc' },
    select: { user: { select: { email: true } } },
  });
  return adminMembership?.user?.email ?? null;
}
