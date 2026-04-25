/**
 * POST / DELETE /api/tenant/api-keys/[keyId]/override-scope
 *
 * Admin-only endpoints for granting (POST) and revoking (DELETE) the
 * privileged `tenant:pricing:override` scope on a specific API key.
 * The scope is what unlocks `confirm_booking`'s ceiling-override path —
 * see Eng A8 + DX D4 in the markup plan.
 *
 * Security properties:
 *   - Caller must hold the Clerk `org:admin` role on the active org.
 *   - Sandbox keys are NEVER grantable. The Clerk API key's
 *     `claims.type === 'sandbox'` is the discriminator (mirrors the
 *     onApiKeyCreated webhook's check).
 *   - The key must belong to the same Clerk org as the caller — no
 *     cross-tenant grants. Subject is verified at the Clerk layer.
 *
 * Storage convention (CLAUDE.md → API keys):
 *   The granted scopes for a key live at
 *   `tenant.metadata.apiKeyScopes[keyId]` (an array of scope strings).
 *   Default-stamped on key creation by `stampDefaultScopesOnKey` in
 *   the Clerk webhook handler. This route adds (POST) or removes
 *   (DELETE) `'tenant:pricing:override'` from the array.
 *
 * The runtime check that consumes this scope lives at
 * `packages/tools/src/confirm-booking.ts::runConfirmBooking`, gated by
 * `callerScopes` derived from `tenant.metadata.apiKeyScopes[keyId]`.
 */

import { auth, clerkClient } from '@clerk/nextjs/server';
import { prisma, type Prisma } from '@sendero/database';
import { type NextRequest, NextResponse } from 'next/server';

import { ApiErrors, apiErrorResponse } from '@/lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OVERRIDE_SCOPE = 'tenant:pricing:override' as const;

// ── Auth + tenant resolution ─────────────────────────────────────────

interface AdminContext {
  tenantId: string;
  /** Clerk org id — needed to validate the key's `subject` claim. */
  clerkOrgId: string;
}

async function authAdminTenantOrError(): Promise<{ ctx: AdminContext } | { error: NextResponse }> {
  const { userId, orgId, has } = await auth();
  if (!userId) return { error: ApiErrors.unauthorized() };
  if (!orgId) return { error: ApiErrors.forbidden('No active organization.') };
  if (!has({ role: 'org:admin' })) {
    return { error: ApiErrors.forbidden('Granting privileged scopes requires org:admin.') };
  }
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) {
    return {
      error: apiErrorResponse({
        status: 404,
        code: 'TENANT_NOT_FOUND',
        message: 'Active organization is not provisioned in Sendero.',
      }),
    };
  }
  return { ctx: { tenantId: tenant.id, clerkOrgId: orgId } };
}

// ── Key validation against Clerk ─────────────────────────────────────

interface ClerkApiKey {
  id: string;
  subject: string;
  claims?: Record<string, unknown>;
  revoked?: boolean;
}

/**
 * Look up the API key via Clerk's apiKeys.list (the only stable read
 * path Clerk exposes today). Verifies the key belongs to the
 * caller's org AND is NOT a sandbox key.
 *
 * Returns null when:
 *   - the Clerk apiKeys client isn't available (older SDK)
 *   - the key isn't found under this org
 *   - the key is a sandbox key
 *   - the key is already revoked (defensive — no point granting on a dead key)
 *
 * The caller maps each null reason to a distinct HTTP status.
 */
async function findGrantableKey(
  clerkOrgId: string,
  keyId: string
): Promise<
  | { kind: 'ok'; key: ClerkApiKey }
  | { kind: 'unsupported' }
  | { kind: 'not_found' }
  | { kind: 'sandbox' }
  | { kind: 'revoked' }
> {
  const client = await clerkClient();
  const api = (
    client as unknown as {
      apiKeys?: {
        list?: (args: { subject: string }) => Promise<{ data?: ClerkApiKey[] }>;
      };
    }
  ).apiKeys;
  if (!api?.list) return { kind: 'unsupported' };

  const result = await api.list({ subject: clerkOrgId });
  const key = result.data?.find(k => k.id === keyId);
  if (!key) return { kind: 'not_found' };
  if (key.claims?.type === 'sandbox') return { kind: 'sandbox' };
  if (key.revoked === true) return { kind: 'revoked' };
  return { kind: 'ok', key };
}

// ── Scope mutation ───────────────────────────────────────────────────

function readApiKeyScopes(meta: unknown): Record<string, string[]> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const m = meta as Record<string, unknown>;
  const raw = m.apiKeyScopes;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v) && v.every(s => typeof s === 'string')) {
      out[k] = v as string[];
    }
  }
  return out;
}

async function persistScopes(tenantId: string, keyId: string, nextScopes: string[]): Promise<void> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { metadata: true },
  });
  const base =
    tenant?.metadata && typeof tenant.metadata === 'object' && !Array.isArray(tenant.metadata)
      ? (tenant.metadata as Record<string, unknown>)
      : {};
  const existing = readApiKeyScopes(base);
  const nextMeta = {
    ...base,
    apiKeyScopes: {
      ...existing,
      [keyId]: nextScopes,
    },
  };
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { metadata: nextMeta as unknown as Prisma.InputJsonValue },
  });
}

// ── Handlers ─────────────────────────────────────────────────────────

async function mutate(
  req: NextRequest,
  params: Promise<{ keyId: string }>,
  mode: 'grant' | 'revoke'
): Promise<NextResponse> {
  const { keyId } = await params;
  if (!keyId || keyId.length < 4) {
    return apiErrorResponse({
      status: 400,
      code: 'INVALID_KEY_ID',
      message: 'API key id missing or malformed.',
    });
  }

  const authed = await authAdminTenantOrError();
  if ('error' in authed) return authed.error;
  const { ctx } = authed;

  const verdict = await findGrantableKey(ctx.clerkOrgId, keyId);
  switch (verdict.kind) {
    case 'unsupported':
      return apiErrorResponse({
        status: 503,
        code: 'CLERK_APIKEYS_UNAVAILABLE',
        message: 'Clerk API keys client not available — cannot grant scopes.',
      });
    case 'not_found':
      return apiErrorResponse({
        status: 404,
        code: 'API_KEY_NOT_FOUND',
        message: 'API key not found under this organization.',
      });
    case 'sandbox':
      return apiErrorResponse({
        status: 403,
        code: 'SANDBOX_KEY_NOT_GRANTABLE',
        message:
          'Sandbox keys cannot receive privileged scopes. Mint a production key from the API keys settings page.',
        agentInstruction:
          'Tell the human sandbox keys are blocked from privileged scopes by design. They need a production key minted from /dashboard/settings/api-keys.',
      });
    case 'revoked':
      return apiErrorResponse({
        status: 410,
        code: 'API_KEY_REVOKED',
        message: 'API key is revoked. Mint a new key first.',
      });
    case 'ok':
      break;
  }

  // Read current scopes for the key, default to empty if never stamped.
  const tenant = await prisma.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { metadata: true },
  });
  const currentScopes = readApiKeyScopes(tenant?.metadata)[keyId] ?? [];

  const nextScopes =
    mode === 'grant'
      ? currentScopes.includes(OVERRIDE_SCOPE)
        ? currentScopes
        : [...currentScopes, OVERRIDE_SCOPE]
      : currentScopes.filter(s => s !== OVERRIDE_SCOPE);

  // No-op detection — return success without an extra tenant write.
  if (
    nextScopes.length === currentScopes.length &&
    nextScopes.every((s, i) => s === currentScopes[i])
  ) {
    return NextResponse.json({
      ok: true,
      keyId,
      scope: OVERRIDE_SCOPE,
      mode,
      changed: false,
      scopes: currentScopes,
    });
  }

  await persistScopes(ctx.tenantId, keyId, nextScopes);

  return NextResponse.json({
    ok: true,
    keyId,
    scope: OVERRIDE_SCOPE,
    mode,
    changed: true,
    scopes: nextScopes,
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ keyId: string }> }
): Promise<NextResponse> {
  return mutate(req, ctx.params, 'grant');
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ keyId: string }> }
): Promise<NextResponse> {
  return mutate(req, ctx.params, 'revoke');
}
