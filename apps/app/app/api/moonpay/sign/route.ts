/**
 * MoonPay URL signer — signs the search portion of a MoonPay widget URL
 * with HMAC-SHA256 keyed by `MOONPAY_SIGNING_SECRET`. The widget calls
 * this from the browser after assembling the buy URL; the returned
 * signature is appended as the `signature` query param so MoonPay's
 * server-side check passes.
 *
 * Auth: Clerk session required. Anonymous calls are rejected so the
 * Sendero secret can't be borrowed to point a MoonPay widget at an
 * attacker's wallet under our branding.
 *
 * Domain pin: only signs URLs whose host is on MoonPay's list. Defense
 * in depth — the secret is dedicated to MoonPay so signing arbitrary
 * URLs would be useless to MoonPay, but pinning catches misconfiguration
 * and prevents the secret from ever HMAC'ing attacker-chosen content.
 *
 * Rate limit: 10 req/min per (userId, IP) via Upstash, env-scoped.
 * Falls open when Redis is unavailable (e.g. local dev without KV) so
 * the widget doesn't break for solo developers.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';

import { getRedis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RATE_LIMIT_PER_MIN = 10;
const ALLOWED_HOSTS = new Set([
  'buy.moonpay.com',
  'buy-sandbox.moonpay.com',
  'buy-staging.moonpay.com',
  'sell.moonpay.com',
  'sell-sandbox.moonpay.com',
  'sell-staging.moonpay.com',
]);

function envTag(): string {
  const v = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

async function checkRateLimit(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true; // fail-open in environments without Upstash
  const count = await redis.incr(key);
  if (count === 1) {
    // First hit — set 60s window.
    await redis.expire(key, 60);
  }
  return count <= RATE_LIMIT_PER_MIN;
}

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const secret = process.env.MOONPAY_SIGNING_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'moonpay_signer_unconfigured' }, { status: 503 });
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateKey = `${envTag()}:moonpay:sign:${userId}:${ip}`;
  const allowed = await checkRateLimit(rateKey).catch(() => true);
  if (!allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (typeof body.url !== 'string') {
    return NextResponse.json({ error: 'url_required' }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(body.url);
  } catch {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(parsed.host)) {
    return NextResponse.json({ error: 'host_not_allowed' }, { status: 400 });
  }

  const signature = crypto.createHmac('sha256', secret).update(parsed.search).digest('base64');

  return NextResponse.json({ signature });
}
