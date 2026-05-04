/**
 * POST /api/short-links
 *
 * Internal-only short-link issuer. Generates a fresh 8-char base32
 * code, persists a `ShortLink` row, and returns the full
 * `app.sendero.travel/t/<code>` URL.
 *
 * Auth: shared dispatch secret via `x-sendero-dispatch-secret`
 * (matching `AGENT_DISPATCH_SECRET` or `CRON_SECRET`). Same auth model
 * as `/api/internal/booking-fanout` and `/api/agent/dispatch`. There
 * is intentionally no public signup — short links must be issued by
 * Sendero-trusted services so we can host-allowlist target URLs.
 *
 * Body:
 *   {
 *     targetUrl:        string;            // https://, host on allowlist
 *     tenantId?:        string;
 *     userId?:          string;
 *     purpose?:         string;            // free-form analytics label
 *     expiresInSeconds?: number;           // soft expiry from "now"
 *   }
 *
 * Response 200:
 *   { shortUrl: string; code: string; expiresAt: string | null }
 *
 * Runtime: nodejs (Prisma + node:crypto).
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Host allowlist for redirect targets. Hardcoded — anything outside
 * this list is rejected with 400 to keep Sendero out of the open-redirect
 * business. `*.ngrok.app` is permitted for local dev tunnels.
 */
const ALLOWED_HOSTS: readonly string[] = [
  'buy.moonpay.com',
  'buy-sandbox.moonpay.com',
  'sell.moonpay.com',
  'sell-sandbox.moonpay.com',
  'app.sendero.travel',
  'sendero.travel',
];

const ALLOWED_HOST_SUFFIXES: readonly string[] = ['.ngrok.app'];

function isAllowedHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (ALLOWED_HOSTS.includes(lower)) return true;
  return ALLOWED_HOST_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorize(req: NextRequest): boolean {
  const provided =
    req.headers.get('x-sendero-dispatch-secret') ?? req.headers.get('x-sendero-internal-secret');
  const expected = process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? '';
  if (!expected || !provided) return false;
  return safeEqual(provided, expected);
}

/**
 * 8-char base32-ish code. We start from `randomBytes(5)` (~40 bits),
 * base64url-encode, drop ambiguous `-`/`_`, slice to 8, uppercase.
 * Collision probability at 1M codes is ~1e-7 — well within the 3-retry
 * budget below.
 */
function generateCode(): string {
  const buf = randomBytes(8);
  return buf.toString('base64url').replace(/[-_]/g, '').slice(0, 8).toUpperCase();
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel').replace(/\/$/, '');
}

interface CreateBody {
  targetUrl?: string;
  tenantId?: string;
  userId?: string;
  purpose?: string;
  expiresInSeconds?: number;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const targetUrl = typeof body.targetUrl === 'string' ? body.targetUrl.trim() : '';
  if (!targetUrl) {
    return NextResponse.json(
      { error: 'missing_required', need: ['targetUrl'] },
      { status: 400 }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: 'invalid_target_url' }, { status: 400 });
  }
  if (parsed.protocol !== 'https:') {
    return NextResponse.json(
      { error: 'invalid_target_url', reason: 'must_be_https' },
      { status: 400 }
    );
  }
  if (!isAllowedHost(parsed.hostname)) {
    return NextResponse.json(
      { error: 'host_not_allowed', host: parsed.hostname },
      { status: 400 }
    );
  }

  let expiresAt: Date | null = null;
  if (typeof body.expiresInSeconds === 'number' && Number.isFinite(body.expiresInSeconds)) {
    if (body.expiresInSeconds <= 0) {
      return NextResponse.json(
        { error: 'invalid_expires_in_seconds' },
        { status: 400 }
      );
    }
    expiresAt = new Date(Date.now() + Math.floor(body.expiresInSeconds) * 1000);
  }

  // Retry up to 3x on UNIQUE collision. With a 40-bit space, retry budget
  // exhaustion would itself be a strong signal that something is broken
  // (e.g. RNG returning the same bytes), so we surface it as 500.
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    try {
      const row = await prisma.shortLink.create({
        data: {
          code,
          targetUrl,
          tenantId: body.tenantId ?? null,
          userId: body.userId ?? null,
          purpose: body.purpose ?? null,
          expiresAt,
        },
        select: { code: true, expiresAt: true },
      });
      return NextResponse.json(
        {
          shortUrl: `${appBaseUrl()}/t/${row.code}`,
          code: row.code,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        },
        { status: 200 }
      );
    } catch (err) {
      lastError = err;
      // Prisma P2002 = unique constraint violation. Retry with fresh code.
      const code = (err as { code?: string } | null)?.code;
      if (code !== 'P2002') {
        console.error('[short-links] create failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        return NextResponse.json({ error: 'internal_error' }, { status: 500 });
      }
    }
  }

  console.error('[short-links] exhausted retry budget on UNIQUE collisions', {
    error: lastError instanceof Error ? lastError.message : String(lastError),
  });
  return NextResponse.json({ error: 'code_collision_retry_exhausted' }, { status: 500 });
}
