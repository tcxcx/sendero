/**
 * GET /api/esim/qr/[token].png
 *
 * Renders the eSIM activation QR code as a PNG image.
 *
 * Token: HMAC-signed `<base64url(esimId)>.<hex(sig)>` issued by
 * `signQrToken()` in `@sendero/esim/qr`. The activation code itself
 * never appears in the URL — only the eSIM id, signed against
 * `INVOICE_SIGNING_SECRET`. Bad / tampered tokens 404.
 *
 * Public route — added to the proxy allowlist so unfurl bots (Slack,
 * WhatsApp media fetch) can render the image. The HMAC token is the
 * security gate, not Clerk auth.
 */

import { type NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';

import { prisma } from '@sendero/database';
import { verifyQrToken } from '@sendero/esim';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ token: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  const secret = process.env.INVOICE_SIGNING_SECRET ?? '';
  if (!secret) {
    return NextResponse.json({ error: 'qr_signing_unconfigured' }, { status: 503 });
  }

  // Token may carry a `.png` suffix when the renderer used the friendly
  // URL form — strip it before verification.
  const { token } = await ctx.params;
  const stripped = token.replace(/\.png$/, '');
  const verified = verifyQrToken(stripped, secret);
  if (!verified) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404 });
  }

  const esim = await prisma.esim.findUnique({
    where: { id: verified.esimId },
    select: { lpaCode: true, expiresAt: true },
  });
  if (!esim) {
    return NextResponse.json({ error: 'esim_not_found' }, { status: 404 });
  }

  // Reject expired-and-then-some so we don't keep serving QR codes
  // that won't activate. 7-day grace lets travelers scan late.
  if (esim.expiresAt && esim.expiresAt.getTime() + 7 * 24 * 3600 * 1000 < Date.now()) {
    return NextResponse.json({ error: 'esim_expired' }, { status: 410 });
  }

  // 600px QR with 4-cell quiet zone — readable from a laptop screen
  // when the traveler is scanning from another device. Error-correction
  // level 'M' (15% recovery) is fine for short LPA strings.
  const png = await QRCode.toBuffer(esim.lpaCode, {
    type: 'png',
    width: 600,
    margin: 4,
    errorCorrectionLevel: 'M',
  });

  return new NextResponse(new Uint8Array(png), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600',
      // Make scrapers / unfurl bots stash the image; signed token
      // already gates access.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
