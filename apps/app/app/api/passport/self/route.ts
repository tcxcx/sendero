/**
 * GET /api/passport/self
 *
 * Returns the signed-in traveler's own sanitized passport signals so
 * the /dashboard/passport page can render a status card.  Decrypts the
 * ciphertext ONLY when `?reveal=1` is passed, and only for the vault
 * owner — operators / admins never hit this endpoint.
 *
 * The decrypt path writes an access log row with the actor + a source
 * tag of `dashboard:passport:self`.  Auditable after the fact.
 *
 * DELETE /api/passport/self — revoke (tombstone) the traveler's own
 * vault row.  We keep the row so the access log remains joinable; the
 * ciphertext is zeroed and revokedAt is stamped.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { decryptVaultPayload, readVaultSignals, revokeVault } from '@sendero/vault';
import { type NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveActor() {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) return null;
  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!user || !tenant) return null;
  return { clerkUserId: userId, userId: user.id, tenantId: tenant.id };
}

export async function GET(req: NextRequest) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const reveal = new URL(req.url).searchParams.get('reveal') === '1';

    const signals = await readVaultSignals(prisma, {
      tenantId: actor.tenantId,
      userId: actor.userId,
      documentVariant: 'passport',
      actor: {
        actorRef: `usr:${actor.clerkUserId}`,
        source: 'api/passport/self',
        context: { reveal },
      },
    });
    if (!signals) return NextResponse.json({ vault: null });

    const base = {
      vaultId: signals.id,
      documentVariant: signals.documentVariant,
      nationalityIso3: signals.nationalityIso3,
      expiresOn: signals.expiresOn ? signals.expiresOn.toISOString().slice(0, 10) : null,
      mrzChecksumValid: signals.mrzChecksumValid,
      extractedBy: signals.extractedBy,
      extractedAt: signals.extractedAt.toISOString(),
    };

    if (!reveal) return NextResponse.json({ vault: base, payload: null });

    const payload = await decryptVaultPayload(prisma, {
      vaultId: signals.id,
      tenantId: actor.tenantId,
      actor: {
        actorRef: `usr:${actor.clerkUserId}`,
        source: 'api/passport/self?reveal=1',
      },
    });
    return NextResponse.json({ vault: base, payload });
  } catch (err) {
    console.error('[passport/self] read failed:', err);
    return NextResponse.json(
      {
        error: 'vault_read_failed',
        message: 'Passport vault state could not be loaded. Try again or contact support.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest) {
  const actor = await resolveActor();
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const signals = await readVaultSignals(prisma, {
    tenantId: actor.tenantId,
    userId: actor.userId,
    documentVariant: 'passport',
    actor: {
      actorRef: `usr:${actor.clerkUserId}`,
      source: 'api/passport/self#delete',
    },
  });
  if (!signals) return NextResponse.json({ revoked: false });

  await revokeVault(prisma, {
    vaultId: signals.id,
    tenantId: actor.tenantId,
    actor: {
      actorRef: `usr:${actor.clerkUserId}`,
      source: 'api/passport/self#delete',
    },
  });
  return NextResponse.json({ revoked: true, vaultId: signals.id });
}
