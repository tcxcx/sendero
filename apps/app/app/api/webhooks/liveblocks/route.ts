import { type NextRequest, NextResponse } from 'next/server';

import { type WebhookEvent, WebhookHandler } from '@liveblocks/node';

import { fanoutLiveblocksWebhookEvent } from '@/lib/liveblocks-webhook-fanout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const secret = process.env.LIVEBLOCKS_WEBHOOK_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ error: 'liveblocks_webhook_not_configured' }, { status: 503 });
  }

  const rawBody = await req.text();
  let event: WebhookEvent;
  try {
    event = new WebhookHandler(secret).verifyRequest({
      headers: req.headers,
      rawBody,
    });
  } catch (error) {
    console.warn('[liveblocks/webhook] signature verification failed', error);
    return NextResponse.json({ error: 'invalid_signature' }, { status: 400 });
  }

  const result = await fanoutLiveblocksWebhookEvent(event);
  return NextResponse.json({ ok: true, ...result });
}
