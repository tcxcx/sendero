import { clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  isBetaOpen,
  isPrivateBetaWhitelisted,
  normalizePrivateBetaIdentifier,
} from '@/lib/private-beta';

const bodySchema = z.object({
  emailAddress: z.string().email(),
});

export type WaitlistPrecheckScenario =
  | 'none'
  | 'waitlist_pending'
  | 'invited'
  | 'granted_completed'
  | 'granted_allowlist'
  | 'rejected';

export type WaitlistPrecheckBody = {
  ok: true;
  scenario: WaitlistPrecheckScenario;
  /** Only when scenario is `invited` — true when the invitation is still pending */
  invitePending?: boolean;
};

export async function POST(req: Request) {
  const json: unknown = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const email = normalizePrivateBetaIdentifier(parsed.data.emailAddress);
  if (!email) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  try {
    const client = await clerkClient();
    const { data } = await client.waitlistEntries.list({ query: email, limit: 1 });

    const entry = data[0];
    if (entry) {
      if (entry.status === 'pending') {
        return NextResponse.json({
          ok: true,
          scenario: 'waitlist_pending',
        } satisfies WaitlistPrecheckBody);
      }
      if (entry.status === 'invited') {
        const inv = entry.invitation;
        const invitePending = Boolean(inv && !inv.revoked && inv.status === 'pending');
        return NextResponse.json({
          ok: true,
          scenario: 'invited',
          invitePending,
        } satisfies WaitlistPrecheckBody);
      }
      if (entry.status === 'completed') {
        return NextResponse.json({
          ok: true,
          scenario: 'granted_completed',
        } satisfies WaitlistPrecheckBody);
      }
      if (entry.status === 'rejected') {
        return NextResponse.json({ ok: true, scenario: 'rejected' } satisfies WaitlistPrecheckBody);
      }
    }

    if (!isBetaOpen() && isPrivateBetaWhitelisted(email)) {
      return NextResponse.json({
        ok: true,
        scenario: 'granted_allowlist',
      } satisfies WaitlistPrecheckBody);
    }

    return NextResponse.json({ ok: true, scenario: 'none' } satisfies WaitlistPrecheckBody);
  } catch (error) {
    console.error('[waitlist/precheck]', error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: 'server' }, { status: 500 });
  }
}
