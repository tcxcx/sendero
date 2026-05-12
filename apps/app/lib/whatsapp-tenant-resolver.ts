/**
 * Resolve the right tenant for a WhatsApp turn.
 *
 * The sandbox WhatsApp number (`SENDERO_SANDBOX_PHONE_NUMBER_ID`) is
 * shared across many tenants — every agency that runs a demo installs
 * it into their own tenant, producing multiple `WhatsAppInstall` rows
 * with the same `phoneNumberId`. A naïve `findFirst` picks an arbitrary
 * tenant and is the root cause of "agency removed" errors when that
 * arbitrary pick happens to point at a deleted tenant.
 *
 * Resolution priority for a single turn:
 *
 *   1. **Single-install case.** Only one tenant has installed this
 *      `phoneNumberId` → that tenant. Covers BYO Meta numbers + the
 *      common pre-multi-tenant state.
 *   2. **Returning traveler.** Multiple installs share the number AND
 *      the inbound carries a traveler phone → pick the tenant whose
 *      `ChannelIdentity` was most recently touched for that phone.
 *      Travelers stay pinned to whichever agency they last interacted
 *      with.
 *   3. **Explicit `bodyTenantId` from a trusted caller.** Used by the
 *      Kapso shared-secret path until Phase 1 wires tenantPhoneNumberId
 *      forwarding. We verify the tenant still exists before honoring
 *      it — a stale env-var pointing at a deleted tenant can never
 *      poison the turn.
 *   4. **Sandbox fallback.** A tenant marked `metadata.protected: true`
 *      (provisioned by `provision-sandbox-tenant.ts`) catches every
 *      cold-start traveler so the bot can always reply. Never deletable.
 *   5. **`whatsappDefaultTenantId()` env-var.** Last-resort legacy hook.
 *      Verified live before use.
 *
 * Returns `null` only if every priority above fails AND there is no
 * sandbox tenant — production posture for callers that prefer
 * fail-closed routing (e.g. inbound webhook audit rows).
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';

export interface ResolveTenantArgs {
  /** Meta Graph `phone_number_id` of the bot that received the message. */
  tenantPhoneNumberId?: string | null;
  /** Inbound traveler phone in E.164 (or raw — we normalize). */
  travelerPhone?: string | null;
  /** Trusted-caller override (Kapso shared-secret env). Honored only if the tenant still exists. */
  bodyTenantId?: string | null;
}

export interface ResolveTenantResult {
  tenantId: string | null;
  /** One of: 'install_single' | 'channel_identity_recent' | 'body_tenant_id' | 'sandbox_fallback' | 'env_fallback' | 'unresolved' */
  source: ResolveTenantSource;
}

export type ResolveTenantSource =
  | 'install_single'
  | 'channel_identity_recent'
  | 'channel_identity_any'
  | 'body_tenant_id'
  | 'sandbox_fallback'
  | 'env_fallback'
  | 'unresolved';

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
}

async function tenantExists(tenantId: string): Promise<boolean> {
  const row = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  return Boolean(row);
}

async function findSandboxTenantId(): Promise<string | null> {
  // Sandbox tenant is marked `metadata.protected: true`. Provisioned
  // by `apps/app/scripts/_local/provision-sandbox-tenant.ts`. We
  // intentionally don't cache the lookup — a single Tenant.findFirst
  // on an indexed metadata path is sub-ms and survives tenant churn
  // without needing to bust a cache.
  const sandbox = await prisma.tenant.findFirst({
    where: { metadata: { path: ['protected'], equals: true } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  return sandbox?.id ?? null;
}

export async function resolveTenantForWhatsAppTurn(
  args: ResolveTenantArgs
): Promise<ResolveTenantResult> {
  const travelerPhone = normalizePhone(args.travelerPhone ?? null);
  const tenantPhoneNumberId = args.tenantPhoneNumberId?.trim() || null;
  const bodyTenantId = args.bodyTenantId?.trim() || null;

  // Step 1: candidate tenants by phoneNumberId
  const candidates: string[] = [];
  if (tenantPhoneNumberId) {
    const installs = await prisma.whatsAppInstall.findMany({
      where: { phoneNumberId: tenantPhoneNumberId, NOT: { status: 'disabled' } },
      select: { tenantId: true },
    });
    for (const i of installs) candidates.push(i.tenantId);

    if (candidates.length === 1) {
      return { tenantId: candidates[0]!, source: 'install_single' };
    }
  }

  // Step 2: returning traveler — pick the tenant they most recently
  // interacted with from the candidate set. If we have no install
  // candidates (Kapso path before Phase 1 wires phoneNumberId), fall
  // through to step 3 — bodyTenantId is a stronger signal than an
  // unfiltered ChannelIdentity lookup.
  if (travelerPhone && candidates.length > 1) {
    const recent = await prisma.channelIdentity.findFirst({
      where: {
        kind: 'whatsapp',
        externalUserId: travelerPhone,
        tenantId: { in: candidates },
      },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true },
    });
    if (recent) {
      return { tenantId: recent.tenantId, source: 'channel_identity_recent' };
    }
  }

  // Step 3: traveler's most-recent ChannelIdentity wins over the
  // env-var override. The traveler's own binding history is a stronger
  // signal than Kapso's static SENDERO_TENANT_ID — that env-var drifts
  // every time someone spins up a new demo tenant. We only honor it as
  // a fallback when we have no other anchoring info.
  if (travelerPhone) {
    const recent = await prisma.channelIdentity.findFirst({
      where: { kind: 'whatsapp', externalUserId: travelerPhone },
      orderBy: { updatedAt: 'desc' },
      select: { tenantId: true },
    });
    if (recent && (await tenantExists(recent.tenantId))) {
      return { tenantId: recent.tenantId, source: 'channel_identity_any' };
    }
  }

  // Step 4: trusted-caller override — but only if the tenant still
  // exists. The bug we're fixing is exactly the case where this env-var
  // points at a deleted tenant.
  if (bodyTenantId && (await tenantExists(bodyTenantId))) {
    return { tenantId: bodyTenantId, source: 'body_tenant_id' };
  }

  // Step 5: sandbox fallback
  const sandbox = await findSandboxTenantId();
  if (sandbox) {
    return { tenantId: sandbox, source: 'sandbox_fallback' };
  }

  // Step 6: legacy env-var fallback
  const envFallback = env.whatsappDefaultTenantId?.() ?? null;
  if (envFallback && (await tenantExists(envFallback))) {
    return { tenantId: envFallback, source: 'env_fallback' };
  }

  return { tenantId: null, source: 'unresolved' };
}
