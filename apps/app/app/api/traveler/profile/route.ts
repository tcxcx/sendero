/**
 * GET  /api/traveler/profile — read the signed-in traveler's T1 declared signals.
 * POST /api/traveler/profile — create or update the declared profile.
 *
 * T1 "declared" signals (nationality ISO-3 + passport expiry month) are
 * non-PII — a 3-letter code and a date aren't identifying on their own.
 * They live on User.metadata.travelerProfile, unencrypted, and exist
 * to let the agent + workflows run visa/expiry checks without forcing
 * a passport upload for every trip.
 *
 * The encrypted PassportVault (T2) still handles real passport records
 * — this route never touches it.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { readDeclaredTravelerSignals, writeDeclaredTravelerSignals } from '@sendero/vault';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  /** 3-letter ISO 3166-1 alpha-3 nationality (e.g. "USA", "BRA"). */
  nationalityIso3: z.string().regex(/^[A-Za-z]{3}$/),
  /**
   * Passport expiry — month-precision is fine.  Accept YYYY-MM or a
   * full ISO date; we normalize to the first of the month internally.
   */
  expiry: z.string().regex(/^\d{4}-\d{2}(-\d{2})?$/),
});

async function resolveActor() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return null;
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  if (!user) return null;
  return { clerkUserId: userId, userId: user.id };
}

export async function GET(_req: NextRequest) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const declared = await readDeclaredTravelerSignals(prisma, actor.userId);
  if (!declared) return NextResponse.json({ profile: null });

  return NextResponse.json({
    profile: {
      nationalityIso3: declared.declaredNationalityIso3,
      expiresOn: declared.declaredPassportExpiry.toISOString().slice(0, 10),
      declaredAt: declared.declaredAt.toISOString(),
    },
  });
}

export async function POST(req: NextRequest) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = BodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: body.error.flatten() },
      { status: 400 }
    );
  }

  const expiry = new Date(
    body.data.expiry.length === 7 ? `${body.data.expiry}-01` : body.data.expiry
  );
  if (Number.isNaN(expiry.getTime())) {
    return NextResponse.json({ error: 'invalid_expiry' }, { status: 400 });
  }

  const signals = await writeDeclaredTravelerSignals(prisma, actor.userId, {
    declaredNationalityIso3: body.data.nationalityIso3,
    declaredPassportExpiry: expiry,
  });

  return NextResponse.json({
    profile: {
      nationalityIso3: signals.declaredNationalityIso3,
      expiresOn: signals.declaredPassportExpiry.toISOString().slice(0, 10),
      declaredAt: signals.declaredAt.toISOString(),
    },
  });
}
