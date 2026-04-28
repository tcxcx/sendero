/**
 * GET /api/auth/whoami
 *
 * Used by `npx @sendero/cli@latest auth whoami`. Resolves the
 * Bearer key in the request to a tenant + key type, with no DB
 * writes. Returns 401 on missing/invalid key.
 *
 * Public-route-listed in proxy.ts so unauthenticated CLI calls reach
 * the handler (auth happens via Bearer key, not Clerk session).
 *
 * Response shape (stable contract — the CLI parses this):
 *   {
 *     tenantId: string,            // Sendero tenant id
 *     orgId: string,               // Clerk org id
 *     keyType: 'sandbox' | 'production',
 *     effectiveKeyType: 'sandbox' | 'production',
 *     scopes: string[]
 *   }
 *
 * `effectiveKeyType` differs from `keyType` only during the testnet-
 * beta downgrade — production keys behave as sandbox until
 * `SENDERO_NETWORK_MODE` flips to 'production' (see CLAUDE.md).
 *
 * Plan tier is intentionally omitted from this response. Plan resolution
 * goes through Clerk's session-based `has({ plan })` helper, which a
 * Bearer-keyed CLI request can't access. CLI users who need plan-tier
 * data should hit `/api/billing/plan-context` from inside a signed-in
 * session (or we add a Bearer-keyed plan-context endpoint later).
 */

import { NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

import { resolveTenantFromApiKey } from '@/lib/api-key-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface WhoamiResponse {
  tenantId: string;
  orgId: string;
  keyType: 'sandbox' | 'production';
  effectiveKeyType: 'sandbox' | 'production';
  scopes: string[];
}

export async function GET(req: Request): Promise<Response> {
  const resolved = await resolveTenantFromApiKey(req);
  if (!resolved) {
    return NextResponse.json(
      { error: 'invalid_or_missing_api_key' },
      { status: 401, headers: { 'cache-control': 'no-store' } }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: resolved.tenantId },
    select: { id: true, clerkOrgId: true },
  });

  if (!tenant) {
    return NextResponse.json(
      { error: 'tenant_not_found' },
      { status: 404, headers: { 'cache-control': 'no-store' } }
    );
  }

  const body: WhoamiResponse = {
    tenantId: tenant.id,
    orgId: tenant.clerkOrgId,
    keyType: resolved.keyType,
    effectiveKeyType: resolved.effectiveKeyType,
    scopes: [...resolved.scopes],
  };

  return NextResponse.json(body, {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  });
}
