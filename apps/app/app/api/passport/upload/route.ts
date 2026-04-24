/**
 * POST /api/passport/upload
 *
 * The single sanctioned intake for traveler identity documents.  Accepts
 * two MRZ lines (preferred — the image can be discarded client-side
 * before this call) or an image payload routed through @sendero/ocr's
 * compliance-gated id_document extractor.
 *
 * Runtime flow:
 *   1. Clerk-auth + org — Passport can only be uploaded by the signed-in
 *      traveler themselves. Operators uploading for a traveler is out
 *      of scope (and would need an attestation flow we don't have).
 *   2. Validate input — two 44-char MRZ lines is the happy path. Image
 *      path is accepted only when `tenant.publicMetadata.vertexZdrApproved`
 *      is true (guarded separately; this route leaves the flag off).
 *   3. Parse + checksum-validate via @sendero/vault extractPassportFromMrz.
 *      Parse failure → 422.
 *   4. Compute imageSha256 (purely for audit / de-duplication — we never
 *      store the image itself).
 *   5. upsertPassportVault → row-level encrypt + access log.
 *   6. Return only sanitized signals. No names, no MRZ, no passport#.
 *
 * What this route intentionally does NOT do:
 *   - Accept the image when MRZ lines are present. Cheaper + safer.
 *   - Log the request body anywhere.
 *   - Broadcast a vault event to the agent. The agent discovers the
 *     vault entry next time it calls check_travel_eligibility.
 */

import { auth } from '@clerk/nextjs/server';
import { prisma } from '@sendero/database';
import { extractPassportFromMrz, upsertPassportVault } from '@sendero/vault';
import { createHash } from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  mrzLine1: z.string().min(30).max(50),
  mrzLine2: z.string().min(30).max(50),
  /**
   * Hex SHA-256 of the original file.  The client computes this from
   * the image buffer before POSTing and discards the image.  Stored
   * inside ciphertext only, for de-duplication + audit.
   */
  imageSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  filename: z.string().max(255).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth();
  if (!userId || !orgId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const payload = BodySchema.safeParse(await req.json().catch(() => null));
  if (!payload.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: payload.error.flatten() },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });
  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true },
  });
  if (!user || !tenant) {
    return NextResponse.json({ error: 'tenant_or_user_not_found' }, { status: 404 });
  }

  const imageSha256 =
    payload.data.imageSha256 ??
    createHash('sha256').update(`${payload.data.mrzLine1}\n${payload.data.mrzLine2}`).digest('hex');

  const extracted = extractPassportFromMrz({
    mrzLine1: payload.data.mrzLine1,
    mrzLine2: payload.data.mrzLine2,
    imageSha256,
    filename: payload.data.filename ?? null,
  });
  if (!extracted) {
    return NextResponse.json(
      {
        error: 'mrz_parse_failed',
        message:
          'The MRZ lines did not parse or failed checksum validation. Re-scan the passport and try again.',
      },
      { status: 422 }
    );
  }

  const signals = await upsertPassportVault(prisma, {
    tenantId: tenant.id,
    userId: user.id,
    documentVariant: 'passport',
    payload: {
      extraction: extracted,
      imageSha256,
      filename: payload.data.filename ?? null,
      uploadedAt: new Date().toISOString(),
    },
    signals: {
      nationalityIso3: extracted.nationality || null,
      expiresOn: extracted.expirationDate ? new Date(extracted.expirationDate) : null,
      mrzChecksumValid: extracted.mrzChecksumValid,
    },
    extractedBy: 'mrz_fast',
    actor: {
      actorRef: `usr:${userId}`,
      source: 'api/passport/upload',
      context: {
        ip: req.headers.get('x-forwarded-for') ?? null,
        userAgent: req.headers.get('user-agent') ?? null,
      },
    },
  });

  // Return ONLY sanitized signals.  No MRZ, no name, no passport#.
  return NextResponse.json({
    vaultId: signals.id,
    documentVariant: signals.documentVariant,
    nationalityIso3: signals.nationalityIso3,
    expiresOn: signals.expiresOn ? signals.expiresOn.toISOString().slice(0, 10) : null,
    mrzChecksumValid: signals.mrzChecksumValid,
    extractedBy: signals.extractedBy,
    extractedAt: signals.extractedAt.toISOString(),
  });
}
