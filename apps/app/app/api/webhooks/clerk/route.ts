/**
 * POST /api/webhooks/clerk
 *
 * Clerk is the source-of-truth writer for identity (User, Tenant,
 * Membership). This route verifies the svix signature, dedupes via
 * WebhookEvent, then dispatches user.*, organization.* and
 * organizationMembership.* events into Prisma upserts keyed on
 * clerkUserId / clerkOrgId / clerkMembershipId.
 *
 * On `organization.created` we also provision a Circle treasury wallet
 * via @sendero/circle and stamp the org's publicMetadata with
 * { tenantId, arcWalletAddress, onboardingComplete } so middleware
 * session claims flip.
 *
 * Out-of-order deliveries are tolerated — membership events that arrive
 * before their org/user bail without writing; svix retries them. We
 * return 500 on real provisioning failures so svix retries; the
 * retry-wallet-provision cron covers the long tail.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { clerkClient } from '@clerk/nextjs/server';
import { mapClerkRoleToPrisma } from '@sendero/auth/roles';
import { verifyClerkWebhook } from '@sendero/auth/webhooks';
import { provisionTenantWallet } from '@sendero/circle';
import { prisma } from '@sendero/database';
import {
  createCustomerUser,
  createCustomerUserGroup,
  findCustomerUserByEmail,
} from '@sendero/duffel';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { webhookEventStore } from '@/lib/webhook-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 });
  }

  const raw = await req.text();
  const headers: Record<string, string | undefined> = {
    'svix-id': req.headers.get('svix-id') ?? undefined,
    'svix-timestamp': req.headers.get('svix-timestamp') ?? undefined,
    'svix-signature': req.headers.get('svix-signature') ?? undefined,
  };

  let event: { type: string; data: Record<string, unknown> };
  try {
    event = verifyClerkWebhook(raw, headers, secret);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_signature', message: err instanceof Error ? err.message : String(err) },
      { status: 401 }
    );
  }

  const result = await processDurableWebhook({
    provider: 'clerk',
    externalId: headers['svix-id'] ?? `${event.type}-${Date.now()}`,
    eventType: event.type,
    payload: event,
    event,
    store: webhookEventStore,
    dispatch,
    logger: console,
    logPrefix: '[webhooks/clerk]',
  });
  if (result.ok === false) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  if (result.deduped) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  return NextResponse.json({ ok: true });
}

async function dispatch(event: { type: string; data: Record<string, unknown> }): Promise<void> {
  switch (event.type) {
    case 'user.created':
    case 'user.updated':
      return onUserUpsert(event.data);
    case 'user.deleted':
      return onUserDeleted(event.data);
    case 'organization.created':
      return onOrganizationCreated(event.data);
    case 'organization.updated':
      return onOrganizationUpdated(event.data);
    case 'organization.deleted':
      return onOrganizationDeleted(event.data);
    case 'organizationMembership.created':
    case 'organizationMembership.updated':
      return onMembershipUpsert(event.data);
    case 'organizationMembership.deleted':
      return onMembershipDeleted(event.data);
    default:
      console.log('[webhooks/clerk] unhandled event.type:', event.type);
  }
}

function asRecord(x: unknown): Record<string, unknown> {
  return x && typeof x === 'object' ? (x as Record<string, unknown>) : {};
}

async function onUserUpsert(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  const emails = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const email = emails.length > 0 ? String(asRecord(emails[0]).email_address ?? '') : '';
  const phones = Array.isArray(data.phone_numbers) ? data.phone_numbers : [];
  const phone = phones.length > 0 ? String(asRecord(phones[0]).phone_number ?? '') : '';
  const firstName = String(data.first_name ?? '');
  const lastName = String(data.last_name ?? '');
  const displayName = `${firstName} ${lastName}`.trim() || String(data.username ?? '') || email;

  const user = await prisma.user.upsert({
    where: { clerkUserId: id },
    create: { clerkUserId: id, email, displayName, phone: phone || undefined },
    update: {
      email: email || undefined,
      displayName: displayName || undefined,
      phone: phone || undefined,
    },
  });

  // Best-effort Duffel CustomerUser sync on first sight. Keeps the
  // first booking off the critical path — all future tool calls hit
  // `user.duffelCustomerUserId` without round-tripping Duffel.
  if (!user.duffelCustomerUserId && email) {
    try {
      await syncDuffelCustomerUserForUser({
        userId: user.id,
        email,
        firstName: firstName || 'Traveler',
        lastName: lastName || 'Guest',
        phone: phone || undefined,
      });
    } catch (err) {
      console.warn('[webhooks/clerk] duffel customer sync failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function syncDuffelCustomerUserForUser(args: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
}): Promise<void> {
  // Resolve the first tenant the user belongs to — that's where the
  // Duffel group lives. If they haven't been added to an org yet (new
  // Clerk user, no membership), skip — we'll sync when they are added
  // or when the first booking is attempted.
  const membership = await prisma.membership.findFirst({
    where: { userId: args.userId },
    select: {
      tenantId: true,
      tenant: { select: { duffelCustomerUserGroupId: true, displayName: true } },
    },
  });
  if (!membership?.tenant) return;

  let groupId = membership.tenant.duffelCustomerUserGroupId;
  if (!groupId) {
    const group = await createCustomerUserGroup({
      name: membership.tenant.displayName || `tenant-${membership.tenantId.slice(0, 8)}`,
      userIds: [],
    });
    groupId = group.id;
    await prisma.tenant.update({
      where: { id: membership.tenantId },
      data: { duffelCustomerUserGroupId: groupId },
    });
  }

  const existing = await findCustomerUserByEmail(args.email).catch(() => null);
  const duffelId =
    existing?.id ??
    (
      await createCustomerUser({
        email: args.email,
        given_name: args.firstName,
        family_name: args.lastName,
        phone_number: args.phone,
        group_id: groupId,
      })
    ).id;

  await prisma.user.update({
    where: { id: args.userId },
    data: { duffelCustomerUserId: duffelId },
  });
}

async function onUserDeleted(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  // Soft-delete pattern — preserve User row for audit (bookings + trails).
  // Clerk remains source of truth for live auth state; orphaned rows here
  // are harmless and traceable. Revisit if/when we add a deletedAt column.
  console.log('[webhooks/clerk] user.deleted (no-op preserving row):', id);
}

async function onOrganizationCreated(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  const name = String(data.name ?? id);
  const slug = String(data.slug ?? id.toLowerCase());

  console.log('[webhooks/clerk] organization.created start', { id, name, slug });

  const tenant = await prisma.tenant.upsert({
    where: { clerkOrgId: id },
    create: {
      clerkOrgId: id,
      slug,
      displayName: name,
      billingTier: 'free',
    },
    update: {
      slug,
      displayName: name,
    },
  });

  // Best-effort Duffel CustomerUserGroup creation on org provision.
  // Non-blocking; if Duffel is down the first booking path fills it in
  // via ensure_duffel_customer. We log but don't fail the Clerk
  // webhook — Duffel identity is additive, not load-bearing.
  if (!tenant.duffelCustomerUserGroupId) {
    try {
      const group = await createCustomerUserGroup({
        name: tenant.displayName || `tenant-${tenant.id.slice(0, 8)}`,
        userIds: [],
      });
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { duffelCustomerUserGroupId: group.id },
      });
    } catch (err) {
      console.warn('[webhooks/clerk] duffel group sync failed', {
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Let provisioning exceptions bubble — the route returns 500, svix
  // retries, and the retry-wallet-provision cron backs that up.
  const result = await provisionTenantWallet({
    tenantId: tenant.id,
    clerkOrgId: id,
  });

  const client = await clerkClient();
  await client.organizations.updateOrganization(id, {
    publicMetadata: {
      tenantId: tenant.id,
      arcWalletAddress: result.address,
      onboardingComplete: true,
    },
  });
  console.log('[webhooks/clerk] organization.created done', {
    id,
    tenantId: tenant.id,
    arcWalletAddress: result.address,
  });
}

async function onOrganizationUpdated(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  await prisma.tenant
    .update({
      where: { clerkOrgId: id },
      data: {
        displayName: data.name ? String(data.name) : undefined,
        slug: data.slug ? String(data.slug) : undefined,
      },
    })
    .catch((e: { code?: string }) => {
      // Out-of-order delivery: update may arrive before created. svix retries.
      if (e?.code !== 'P2025') throw e;
    });
}

async function onOrganizationDeleted(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  // Preserve Tenant row for audit (invoices, bookings, settlements).
  console.log('[webhooks/clerk] organization.deleted (preserving tenant row):', id);
}

async function onMembershipUpsert(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  const role = String(data.role ?? 'org:member');
  const orgData = asRecord(data.organization);
  const userDataRaw = asRecord(data.public_user_data);
  const clerkOrgId = String(orgData.id ?? '');
  const clerkUserId = String(userDataRaw.user_id ?? '');
  if (!clerkOrgId || !clerkUserId) return;

  const [tenant, user] = await Promise.all([
    prisma.tenant.findUnique({ where: { clerkOrgId }, select: { id: true } }),
    prisma.user.findUnique({ where: { clerkUserId }, select: { id: true } }),
  ]);
  // Out-of-order delivery — bail rather than synthesize stale joins.
  // svix retries the membership event once the owning rows exist.
  if (!tenant || !user) return;

  await prisma.membership.upsert({
    where: { clerkMembershipId: id },
    create: {
      clerkMembershipId: id,
      tenantId: tenant.id,
      userId: user.id,
      role: mapClerkRoleToPrisma(role),
      status: 'active',
    },
    update: {
      role: mapClerkRoleToPrisma(role),
      status: 'active',
    },
  });
}

async function onMembershipDeleted(data: Record<string, unknown>): Promise<void> {
  const id = String(data.id);
  await prisma.membership
    .update({
      where: { clerkMembershipId: id },
      data: { status: 'removed' },
    })
    .catch((e: { code?: string }) => {
      if (e?.code !== 'P2025') throw e;
    });
}
