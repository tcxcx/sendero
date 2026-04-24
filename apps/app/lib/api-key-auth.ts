/**
 * Resolve a Clerk API key bearer token to a Sendero tenant.
 *
 * Clerk's `<APIKeys />` component handles mint/list/revoke; we only
 * need the server-side verify + tenant mapping. Users paste the token
 * into their MCP client or x402 agent as `Authorization: Bearer ak_xxx`.
 *
 * Sandbox vs production semantics:
 *   - Sandbox keys are minted server-side on `organization.created`
 *     with `claims: { type: 'sandbox' }` and a fixed label. They never
 *     settle real USDC — MeterEvent.status = 'sandbox' bypasses batch.
 *   - User-minted keys via `<APIKeys />` do NOT carry our `claims` (the
 *     component doesn't expose the field). Any key verified without
 *     `claims.type === 'sandbox'` is treated as production.
 *
 * Network-mode downgrade:
 *   - During `testnet-beta` mode, production keys are treated as
 *     sandbox at runtime (MeterEvent.status = 'sandbox'). The keyType
 *     on the row itself is preserved so flipping the env to
 *     `production` just works the day Arc mainnet ships.
 */

import crypto from 'node:crypto';

import type { NextRequest } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';

import { env } from '@sendero/env';
import { prisma } from '@sendero/database';

import { getRedis } from './redis';

export type ApiKeyKind = 'sandbox' | 'production';

/**
 * Verify cache — Upstash Redis (shared across Fluid Compute instances).
 *
 * Clerk charges per verify() call (~$0.00001); a hot path like
 * `/api/mcp` would hammer it. 60s TTL is aggressive enough that
 * revocation lands within a minute, loose enough that a busy agent
 * amortizes to ~1 verify/minute/key.
 *
 * Keyed on sha256(token) so the raw secret never sits in Redis. When
 * Redis is unavailable (local dev without env vars, transient outage),
 * we fall through to the live verify — the cache is an optimization,
 * not a dependency. Fire-and-forget writes so a Redis hiccup doesn't
 * slow the hot path.
 */
const VERIFY_TTL_SECONDS = 60;
const CACHE_PREFIX = 'apikey:verify:';

function cacheKey(token: string): string {
  return CACHE_PREFIX + crypto.createHash('sha256').update(token).digest('hex');
}

export interface ResolvedApiKey {
  tenantId: string;
  clerkOrgId: string;
  keyId: string;
  /** On-paper type as stored in Clerk claims. */
  keyType: ApiKeyKind;
  /** Effective type after network-mode downgrade. */
  effectiveKeyType: ApiKeyKind;
  label: string | null;
}

function extractBearer(req: Request | NextRequest): string | null {
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (auth) {
    const match = /^Bearer\s+(\S+)/i.exec(auth);
    if (match) return match[1];
  }
  const custom = req.headers.get('x-sendero-api-key') ?? req.headers.get('X-Sendero-Api-Key');
  if (custom && custom.trim()) return custom.trim();
  return null;
}

export async function resolveTenantFromApiKey(
  req: Request | NextRequest
): Promise<ResolvedApiKey | null> {
  const token = extractBearer(req);
  if (!token) return null;

  // Quick format guard — Clerk API keys start with `ak_`. Skip verify
  // for anything else so we don't consume Clerk API credits on noise
  // (bogus Authorization headers from random traffic would otherwise
  // each cost a verify() round-trip).
  if (!token.startsWith('ak_')) return null;

  // Short-circuit through Redis. Revocation takes up to
  // VERIFY_TTL_SECONDS (60s) to propagate; trade-off is ~1 verify/min/key
  // instead of 1 verify/request. If Redis is unavailable we fall through
  // to the live verify path.
  const redis = getRedis();
  const cacheId = cacheKey(token);
  if (redis) {
    const hit = await redis.get<ResolvedApiKey>(cacheId).catch(() => null);
    if (hit) return hit;
  }

  let verified: Awaited<ReturnType<typeof clerkClientVerify>> | null = null;
  try {
    verified = await clerkClientVerify(token);
  } catch {
    return null;
  }
  if (!verified) return null;

  const subject = verified.subject;
  if (!subject || !subject.startsWith('org_')) {
    // User-level keys aren't wired to Sendero tenants — we're a B2B
    // org-scoped product. Reject.
    return null;
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: subject },
    select: { id: true },
  });
  if (!tenant) return null;

  const claims = (verified.claims ?? {}) as Record<string, unknown>;
  const keyType: ApiKeyKind = claims.type === 'sandbox' ? 'sandbox' : 'production';
  const effectiveKeyType: ApiKeyKind =
    env.isTestnetBeta() && keyType === 'production' ? 'sandbox' : keyType;

  const resolved: ResolvedApiKey = {
    tenantId: tenant.id,
    clerkOrgId: subject,
    keyId: verified.id,
    keyType,
    effectiveKeyType,
    label: verified.name ?? null,
  };

  // Fire-and-forget. If Redis is down we still return the resolved
  // value — next request will just re-verify against Clerk.
  if (redis) {
    void redis.set(cacheId, resolved, { ex: VERIFY_TTL_SECONDS }).catch(() => {});
  }
  return resolved;
}

/**
 * Thin wrapper around `clerkClient.apiKeys.verify` that returns a
 * narrowed shape. Isolated so tests can stub it without touching
 * `@clerk/nextjs/server`.
 */
async function clerkClientVerify(
  token: string
): Promise<{
  id: string;
  subject: string;
  name?: string | null;
  claims?: Record<string, unknown>;
} | null> {
  const client = await clerkClient();
  const api = (
    client as unknown as {
      apiKeys?: {
        verify: (secret: string) => Promise<{
          id: string;
          subject: string;
          name?: string | null;
          claims?: Record<string, unknown>;
        }>;
      };
    }
  ).apiKeys;
  if (!api?.verify) return null;
  try {
    const res = await api.verify(token);
    return res;
  } catch {
    return null;
  }
}
