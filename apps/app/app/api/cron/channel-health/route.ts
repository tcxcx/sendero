/**
 * Channel health cron — hourly (Vercel Cron).
 *
 * Walks every `WhatsAppInstall` and `SlackInstall`, pings Kapso status
 * + Slack `auth.test`, and flips `status: 'error'` on the install when
 * a check fails. On recovery it flips back to `'active'` and clears
 * `lastErrorMessage`.
 *
 * Auth: CRON_SECRET header match. Vercel injects this automatically;
 * external callers are rejected.
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { KapsoClient } from '@sendero/kapso';
import { WebClient } from '@slack/web-api';
import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && req.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const report = { whatsapp: { ok: 0, error: 0 }, slack: { ok: 0, error: 0 } };

  // ── WhatsApp installs ───────────────────────────────────────────────
  const apiKey = env.kapsoApiKey();
  if (apiKey) {
    const kapso = new KapsoClient({ apiKey, baseUrl: env.kapsoApiBaseUrl() });
    const waInstalls = await prisma.whatsAppInstall.findMany({
      where: { status: { in: ['active', 'error'] } },
      select: { id: true, tenantId: true, phoneNumberId: true, status: true },
    });
    for (const install of waInstalls) {
      try {
        if (!install.phoneNumberId) throw new Error('missing_phone_number_id');
        await kapso.getPhoneNumber(install.phoneNumberId);
        await prisma.whatsAppInstall.update({
          where: { id: install.id },
          data: { status: 'active', lastErrorMessage: null, lastHealthyAt: new Date() },
        });
        report.whatsapp.ok++;
      } catch (err) {
        await prisma.whatsAppInstall.update({
          where: { id: install.id },
          data: {
            status: 'error',
            lastErrorMessage: err instanceof Error ? err.message : String(err),
          },
        });
        report.whatsapp.error++;
        console.warn('[channel-health] whatsapp failed', {
          tenantId: install.tenantId,
          channel: 'whatsapp',
          direction: 'health',
          status: 'error',
        });
      }
    }
  }

  // ── Slack installs ──────────────────────────────────────────────────
  const slackInstalls = await prisma.slackInstall.findMany({
    select: { id: true, tenantId: true, botToken: true },
  });
  for (const install of slackInstalls) {
    try {
      const client = new WebClient(install.botToken);
      const res = await client.auth.test();
      if (!res.ok) throw new Error(res.error ?? 'slack_auth_failed');
      report.slack.ok++;
    } catch (err) {
      report.slack.error++;
      console.warn('[channel-health] slack failed', {
        tenantId: install.tenantId,
        channel: 'slack',
        direction: 'health',
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ ok: true, report });
}
