/**
 * GET /api/passport/eligibility-preview?dest=XXX[&depart=YYYY-MM-DD]
 *
 * Lightweight preview of `verifyTravelDocuments` for the signed-in
 * traveler against a destination ISO-3 country code. Backs the
 * "Travel verdicts" card on /dashboard/passport so the user immediately
 * sees the value of having uploaded their passport — without paying
 * for Sherpa or Timatic. Uses the existing static `visa-rules.ts`
 * corridors + the 6-month-validity rule already shipped in
 * `@sendero/vault::verifyTravelDocuments`.
 *
 * No PII in the response — same enum-coded reasons/actions the agent's
 * `check_travel_eligibility` tool returns. The /dashboard/passport
 * client maps these to human copy.
 */

import { auth } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@sendero/database';
import {
  readDeclaredTravelerSignals,
  readTenantDefaultNationality,
  readVaultSignals,
  verifyTravelDocuments,
} from '@sendero/vault';

import { ensureUserRow } from '@/lib/ensure-user';
import { passportLog } from '@/lib/passport-debug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ISO3_RE = /^[A-Z]{3}$/i;

export async function GET(req: NextRequest) {
  passportLog('[passport/eligibility-preview] ▶ GET received');
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const dest = (url.searchParams.get('dest') ?? '').trim().toUpperCase();
  if (!ISO3_RE.test(dest)) {
    return NextResponse.json(
      { error: 'invalid_dest', message: 'Pass `dest` as a 3-letter ISO country code (e.g. USA).' },
      { status: 400 }
    );
  }

  const departureDate = url.searchParams.get('depart')
    ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const returnDateRaw = url.searchParams.get('return');
  // Default to 7-day round-trip so the 6-month validity rule actually
  // exercises the return leg. Callers can override or pass null.
  const returnDate =
    returnDateRaw === 'null'
      ? null
      : (returnDateRaw ?? new Date(Date.parse(departureDate) + 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10));

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });

  let user: { id: string };
  try {
    user = await ensureUserRow(userId);
  } catch (err) {
    console.error('[passport/eligibility-preview] ✕ ensureUserRow failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'user_provision_failed' }, { status: 500 });
  }

  // Origin defaults to the traveler's nationality if known, else 'USA'
  // as a safe default (we don't ship most border rules; unknowns warn).
  const originIso3Param = (url.searchParams.get('origin') ?? '').trim().toUpperCase();
  const originIso3 = ISO3_RE.test(originIso3Param) ? originIso3Param : 'USA';

  const [passport, declared, tenantDefaultNationalityIso3] = await Promise.all([
    readVaultSignals(prisma, {
      tenantId: tenant.id,
      userId: user.id,
      documentVariant: 'passport',
      actor: {
        actorRef: `usr:${userId}`,
        source: 'api/passport/eligibility-preview',
        context: { dest, originIso3 },
      },
    }),
    readDeclaredTravelerSignals(prisma, user.id),
    readTenantDefaultNationality(prisma, tenant.id),
  ]);

  const verdict = verifyTravelDocuments({
    passport,
    declared,
    tenantDefaultNationalityIso3,
    originIso3,
    destinationIso3: dest,
    departureDate,
    returnDate,
    purpose: 'business',
  });

  passportLog('[passport/eligibility-preview] ✓ ok', {
    dest,
    status: verdict.status,
    reasonCount: verdict.reasons.length,
  });

  return NextResponse.json({ verdict, dest, originIso3, departureDate, returnDate });
}
