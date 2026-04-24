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
import { Prisma, prisma } from '@sendero/database';
import {
  createCustomerUser,
  createCustomerUserGroup,
  findCustomerUserByEmail,
} from '@sendero/duffel';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { invalidateApiKeyCache } from '@/lib/api-key-auth';
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
    case 'apiKey.created':
      return onApiKeyCreated(event.data);
    case 'apiKey.revoked':
    case 'apiKey.deleted':
      return onApiKeyRevoked(event.data);
    default:
      console.log('[webhooks/clerk] unhandled event.type:', event.type);
  }
}

/**
 * Bust the verify cache the moment Clerk tells us a key is dead.
 * Without this, a compromised or rotated key keeps authorizing for up
 * to VERIFY_TTL_SECONDS (60s by default). The cache is best-effort —
 * Redis outage just means we fall back to the TTL-based expiry, which
 * is the same behavior as before we added the cache at all.
 */
async function onApiKeyRevoked(data: Record<string, unknown>): Promise<void> {
  const id = typeof data.id === 'string' ? data.id : null;
  if (!id) return;
  await invalidateApiKeyCache(id);
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
  // via ensure_flight_customer. We log but don't fail the Clerk
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

  // Mint a sandbox API key so the org can call /api/mcp and /api/agent/dispatch
  // immediately without a manual mint step. Production keys are user-minted
  // via <APIKeys /> in settings, gated by plan tier; sandbox is always-on
  // and tagged via `claims.type` so the resolver can downgrade settlement.
  try {
    const apiKeysClient = (
      client as unknown as {
        apiKeys?: {
          create: (args: {
            subject: string;
            name?: string;
            claims?: Record<string, unknown>;
          }) => Promise<unknown>;
        };
      }
    ).apiKeys;
    if (apiKeysClient?.create) {
      await apiKeysClient.create({
        subject: id,
        name: 'Sandbox key',
        claims: { type: 'sandbox' },
      });
      console.log('[webhooks/clerk] organization.created sandbox key minted', { id });
    }
  } catch (err) {
    console.warn('[webhooks/clerk] sandbox key mint failed (non-fatal)', {
      id,
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

/**
 * Enforce `PLANS[tier].productionApiKeyLimit` at mint time.
 *
 * Clerk's `<APIKeys />` UI doesn't expose per-org quotas, so a free-tier
 * user could otherwise mint unlimited production keys and bypass the
 * commercial gate. This handler listens to `apiKey.created`, counts the
 * org's active production keys, and revokes the offender if it breaks
 * the plan's limit.
 *
 * Intentionally skips:
 *   - Keys whose subject isn't `org_*` (we don't wire user-level keys).
 *   - Keys with `claims.type === 'sandbox'` — these are the auto-minted
 *     sandbox key we create in `organization.created`, not user-minted.
 *   - Plans with null `productionApiKeyLimit` (Enterprise / unlimited).
 */
async function onApiKeyCreated(data: Record<string, unknown>): Promise<void> {
  const id = typeof data.id === 'string' ? data.id : null;
  const subject = typeof data.subject === 'string' ? data.subject : null;
  const claims = (data.claims ?? {}) as Record<string, unknown>;
  if (!id || !subject || !subject.startsWith('org_')) return;
  if (claims.type === 'sandbox') return;

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: subject },
    select: { id: true, billingTier: true, metadata: true },
  });
  if (!tenant) {
    console.warn('[webhooks/clerk] apiKey.created for unknown org, no action', { subject });
    return;
  }

  // Default-stamp safe scopes for every new production key.  Admins
  // can promote individual keys later via the tenant admin UI; until
  // then a new key is search+trip-assistance+utilities+compliance+
  // documents only.  Settlement + treasury require an explicit opt-in.
  await stampDefaultScopesOnKey(tenant.id, id, tenant.metadata);

  // Map tenant.billingTier (legacy enum) to the Clerk-billed plan tier.
  // Mirrors `resolveTenantPlan()` in api/agent/dispatch/route.ts — keep
  // the two in sync (or extract to @sendero/billing when it earns a
  // second caller).
  const { resolvePlan } = await import('@sendero/billing/plans');
  const legacy = tenant.billingTier?.toLowerCase();
  const tier =
    legacy === 'enterprise'
      ? 'enterprise'
      : legacy === 'pro'
        ? 'pro'
        : legacy === 'business' || legacy === 'basic'
          ? 'basic'
          : 'free';
  const plan = resolvePlan(tier);
  if (plan.productionApiKeyLimit === null) return; // unlimited

  const client = await clerkClient();
  const api = (
    client as unknown as {
      apiKeys?: {
        list?: (args: { subject: string }) => Promise<{
          data?: Array<{ id: string; claims?: Record<string, unknown>; revoked?: boolean }>;
        }>;
        revoke?: (args: { apiKeyId: string; revocationReason?: string }) => Promise<unknown>;
      };
    }
  ).apiKeys;
  if (!api?.revoke) {
    // Fail closed. A missing revoke API means we cannot enforce the
    // quota at all; previously we returned silently and let the key
    // live. Safer to leave it revoked-on-best-effort + return.
    console.error(
      '[webhooks/clerk] clerkClient.apiKeys.revoke unavailable; cannot enforce plan quota',
      { subject, keyId: id, tier }
    );
    return;
  }

  if (!api.list) {
    // No list API available → we can't count existing keys. Fail
    // closed: revoke this mint. The user retries after we upgrade the
    // Clerk SDK or after the transient outage resolves. Previous
    // behavior skipped enforcement entirely, letting anyone on free
    // mint unlimited production keys.
    console.warn('[webhooks/clerk] apiKey list unavailable, revoking new key defensively', {
      subject,
      keyId: id,
      tier,
    });
    await revokeKey(api.revoke, id, tier, plan.productionApiKeyLimit, 'list_api_unavailable');
    return;
  }

  const resp = await api.list({ subject }).catch(err => {
    console.warn('[webhooks/clerk] apiKey list failed', { subject, err });
    return null as null;
  });
  if (!resp) {
    // Fail closed on transient list errors. Users can retry; we don't
    // want a Clerk hiccup to let a free-tier org mint past their quota.
    await revokeKey(api.revoke, id, tier, plan.productionApiKeyLimit, 'list_api_error');
    return;
  }

  const keys = resp.data ?? [];
  const productionActive = keys.filter(k => !k.revoked && (k.claims?.type ?? null) !== 'sandbox');

  // Clerk's list endpoint is eventually-consistent with the create
  // event that just fired. Ensure the fresh key counts exactly once:
  // either it's already in the list, or we add it synthetically.
  const alreadyCounted = productionActive.some(k => k.id === id);
  const effectiveActive = alreadyCounted ? productionActive.length : productionActive.length + 1;

  if (effectiveActive <= plan.productionApiKeyLimit) return;

  // Over limit — revoke the key that just minted (it's the most recent
  // event; revoking it is the least-surprising UX — "you tried to mint
  // one more than your plan allows, so we blocked this one").
  try {
    await api.revoke({
      apiKeyId: id,
      revocationReason: `Revoked: ${tier} plan allows ${plan.productionApiKeyLimit} production API keys. Upgrade from the dashboard (Manage plan).`,
    });
    console.log('[webhooks/clerk] apiKey.created over limit, revoked', {
      subject,
      keyId: id,
      tier,
      limit: plan.productionApiKeyLimit,
      activeBefore: productionActive.length,
    });
  } catch (err) {
    console.error('[webhooks/clerk] apiKey revoke failed', { keyId: id, err });
  }
}

/**
 * Best-effort revoke helper used from fail-closed paths. Never throws —
 * a revoke failure is already logged at the call site and we don't
 * want to block the webhook dispatch on it (Clerk will retry the
 * whole event anyway). Reason strings end up in the audit log.
 */
async function revokeKey(
  revoke: (args: { apiKeyId: string; revocationReason?: string }) => Promise<unknown>,
  keyId: string,
  tier: string,
  limit: number,
  reason: string
): Promise<void> {
  try {
    await revoke({
      apiKeyId: keyId,
      revocationReason: `Revoked (${reason}): ${tier} plan enforcement could not verify key count (limit ${limit}). Retry in a minute or contact support.`,
    });
    console.warn('[webhooks/clerk] apiKey fail-closed revoked', { keyId, tier, reason });
  } catch (err) {
    console.error('[webhooks/clerk] apiKey fail-closed revoke failed', { keyId, reason, err });
  }
}

/**
 * Write DEFAULT_PROD_SCOPES into tenant.metadata.apiKeyScopes[keyId]
 * on every new production key.  Non-destructive: merges with whatever
 * the tenant has already set.  Read at request time by
 * `resolveScopesForKey()` in apps/app/lib/api-key-auth.ts.
 */
async function stampDefaultScopesOnKey(
  tenantId: string,
  keyId: string,
  currentMeta: unknown
): Promise<void> {
  const { DEFAULT_PROD_SCOPES } = await import('@sendero/auth/dispatch-auth');
  const base =
    currentMeta && typeof currentMeta === 'object' && !Array.isArray(currentMeta)
      ? (currentMeta as Record<string, unknown>)
      : {};
  const existingScopes =
    base.apiKeyScopes && typeof base.apiKeyScopes === 'object' && !Array.isArray(base.apiKeyScopes)
      ? (base.apiKeyScopes as Record<string, unknown>)
      : {};
  if (existingScopes[keyId]) return; // already stamped; admins may have customized
  try {
    const nextMeta = {
      ...base,
      apiKeyScopes: {
        ...existingScopes,
        [keyId]: [...DEFAULT_PROD_SCOPES],
      },
    };
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { metadata: nextMeta as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.warn('[webhooks/clerk] failed to stamp default scopes on key', { keyId, err });
  }
}
