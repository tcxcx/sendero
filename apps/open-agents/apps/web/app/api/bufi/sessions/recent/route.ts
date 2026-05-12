// BUFI ingress: list-recent bot-user sessions for the morning digest cron.
// Same shared Bearer secret as /api/bufi/dispatch.

import crypto from 'node:crypto';
import { and, eq, gte } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { sessions } from '@/lib/db/schema';

const BUFI_BOT_USER_ID = 'bufi-bridge-bot';

function verifyBufiIngress(req: NextRequest): boolean {
  const secret = process.env.OPEN_AGENTS_BUFI_INGRESS_SECRET;
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (!auth) return false;
  const expected = `Bearer ${secret}`;
  if (auth.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verifyBufiIngress(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const sinceRaw = url.searchParams.get('since');
  const sinceMs = sinceRaw ? Number.parseInt(sinceRaw, 10) : Date.now() - 24 * 60 * 60 * 1000;
  const sinceDate = new Date(Number.isFinite(sinceMs) ? sinceMs : Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: sessions.id,
      title: sessions.title,
      status: sessions.status,
      repoOwner: sessions.repoOwner,
      repoName: sessions.repoName,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(eq(sessions.userId, BUFI_BOT_USER_ID), gte(sessions.createdAt, sinceDate)))
    .limit(50);

  return NextResponse.json(rows);
}
