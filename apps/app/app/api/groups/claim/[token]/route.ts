/**
 * POST /api/groups/claim/[token] — claim a group-trip seat from the
 * public landing page (`/group/[token]`).
 *
 * Auth: Clerk session required. The signed token already binds the
 * tenant; we still verify the signed-in user belongs to a Sendero User
 * row before attaching them to the GroupTripPassenger row.
 *
 * On 401 the client bounces through `/sign-in` then retries; that's
 * the same flow the rest of the app uses.
 *
 * Spec: docs/architecture/concierge-magic.md adjacent — group-trip
 * closure plan #1.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';
import { claimGroupSeatTool } from '@sendero/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const session = await auth();
  if (!session?.userId) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId: session.userId },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Your Sendero profile is being provisioned. Refresh in a few seconds and try again.',
      },
      { status: 409 }
    );
  }

  // Resolve tenantId from the signed token before we hit the tool —
  // the tool requires `ctx.traveler.tenantId`, which we'd otherwise
  // derive from the Clerk org session (and a Clerk-personal-account
  // claim wouldn't carry one).
  const { verifyGroupClaimToken, GroupClaimTokenError } = await import(
    '@sendero/tools/lib/group-claim-token'
  );
  let payload;
  try {
    payload = await verifyGroupClaimToken(decodeURIComponent(token));
  } catch (err) {
    if (err instanceof GroupClaimTokenError) {
      return NextResponse.json(
        { ok: false, error: `${err.code}: ${err.message}` },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  let body: { role?: string } = {};
  try {
    body = (await req.json()) as { role?: string };
  } catch {
    /* empty body is fine; role defaults */
  }

  try {
    const result = await claimGroupSeatTool.handler(
      { token: decodeURIComponent(token), role: body.role ?? payload.role ?? 'attendee' },
      {
        traveler: {
          userId: user.id,
          tenantId: payload.tenantId,
        },
      }
    );
    return NextResponse.json({
      ok: true,
      groupTripId: result.groupTripId,
      passengerCount: result.passengerCount,
      remainingSeats: result.remainingSeats,
      isNew: result.isNew,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
