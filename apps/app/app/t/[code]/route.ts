/**
 * GET /t/<code>
 *
 * Sendero-branded short-link redirector. Resolves an opaque 8-char code
 * to its stored `targetUrl` (typically a long MoonPay checkout URL with
 * a signed query string) and 302s the browser there.
 *
 * Why this exists: WhatsApp, Slack, and SMS strip preview when message
 * bodies carry 500+ char URLs, and travelers don't trust raw
 * `buy.moonpay.com/?...&signature=...` links. `app.sendero.travel/t/AB12CD34`
 * is short, brand-aligned, and unfurl-friendly.
 *
 * Public route — Clerk session NOT required (see `apps/app/proxy.ts`).
 *
 * Behavior:
 *   - 404 if code not found.
 *   - 410 Gone if revoked OR past `expiresAt`.
 *   - 302 to `targetUrl` otherwise.
 *   - Click count + first/last-click timestamps updated best-effort
 *     after the redirect dispatches (does NOT block the response).
 *   - `Cache-Control: no-store` — unfurl bots must re-resolve every time
 *     so a revocation lands immediately.
 *
 * Runtime: nodejs (needs Prisma).
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
} as const;

function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS });
}

function gone(): NextResponse {
  return NextResponse.json({ error: 'gone' }, { status: 410, headers: NO_STORE_HEADERS });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ code: string }> }
): Promise<NextResponse> {
  const { code: rawCode } = await ctx.params;
  const code = (rawCode ?? '').toUpperCase();

  // Cheap shape gate before hitting Postgres — codes are exactly 8
  // base32 chars (A-Z, 0-9). Anything else is junk traffic.
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    return notFound();
  }

  const link = await prisma.shortLink.findUnique({
    where: { code },
    select: {
      id: true,
      targetUrl: true,
      revokedAt: true,
      expiresAt: true,
      firstClickAt: true,
    },
  });

  if (!link) {
    return notFound();
  }

  const now = new Date();
  if (link.revokedAt !== null) {
    return gone();
  }
  if (link.expiresAt !== null && link.expiresAt.getTime() <= now.getTime()) {
    return gone();
  }

  // Ops visibility for known unfurl bots — don't extend the redirect on
  // user agents we already understand, just log so we can correlate
  // unfurls vs human clicks.
  const ua = req.headers.get('user-agent') ?? '';
  if (/Slackbot|WhatsApp|Twitterbot|facebookexternalhit|TelegramBot|Discordbot/i.test(ua)) {
    console.info('[short-link] unfurl bot fetch', { code, ua });
  }

  // Best-effort, fire-and-forget click stats. Never block the redirect
  // on a slow/failing DB write — the user-facing latency budget is the
  // 302 itself.
  void prisma.shortLink
    .update({
      where: { id: link.id },
      data: {
        clickCount: { increment: 1 },
        lastClickAt: now,
        ...(link.firstClickAt === null ? { firstClickAt: now } : {}),
      },
    })
    .catch(err => {
      console.warn('[short-link] click increment failed (non-fatal)', {
        code,
        error: err instanceof Error ? err.message : String(err),
      });
    });

  const res = NextResponse.redirect(link.targetUrl, 302);
  for (const [k, v] of Object.entries(NO_STORE_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}
