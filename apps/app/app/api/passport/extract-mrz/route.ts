/**
 * POST /api/passport/extract-mrz
 *
 * Server-side MRZ extraction for the traveler passport upload flow.
 * Accepts a multipart image, runs Gemini multimodal via @sendero/ocr's
 * gated `id_document` extractor, returns the two MRZ lines + the image
 * SHA-256 so the client can immediately POST to /api/passport/upload.
 *
 * The image bytes never persist — we hash them, run the model, and
 * drop them. Only the MRZ + hash leave this route.
 *
 * Auth: Clerk-authenticated user uploading their own passport. Same
 * trust model as /api/passport/upload.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';

import {
  ALLOWED_OCR_MIME_TYPES,
  base64ByteSize,
  extractDocument,
  isAllowedOcrMimeType,
  MAX_OCR_BYTES,
} from '@sendero/ocr';

import { passportLog } from '@/lib/passport-debug';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  passportLog('[passport/extract-mrz] ▶ POST received');

  const { userId } = await auth();
  if (!userId) {
    console.warn('[passport/extract-mrz] ✕ unauthorized');
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    console.warn('[passport/extract-mrz] ✕ invalid_content_type', { contentType });
    return NextResponse.json(
      {
        error: 'invalid_content_type',
        message: 'POST as multipart/form-data with a `file` field.',
      },
      { status: 415 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.warn('[passport/extract-mrz] ✕ invalid_form', { error: String(err) });
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    console.warn('[passport/extract-mrz] ✕ missing_file');
    return NextResponse.json(
      { error: 'missing_file', message: 'Include a `file` field.' },
      { status: 400 }
    );
  }

  const mediaType = file.type || 'application/octet-stream';
  const filename = file instanceof File ? file.name : null;
  passportLog('[passport/extract-mrz] file', {
    userId,
    filename,
    mediaType,
    bytes: file.size,
  });

  if (!isAllowedOcrMimeType(mediaType)) {
    console.warn('[passport/extract-mrz] ✕ unsupported_media_type', { mediaType });
    return NextResponse.json(
      {
        error: 'unsupported_media_type',
        message: `mediaType "${mediaType}" not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(', ')}.`,
      },
      { status: 415 }
    );
  }

  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_OCR_BYTES) {
    console.warn('[passport/extract-mrz] ✕ payload_too_large', {
      bytes: buf.byteLength,
      cap: MAX_OCR_BYTES,
    });
    return NextResponse.json(
      {
        error: 'payload_too_large',
        message: `File (${buf.byteLength} bytes) exceeds ${MAX_OCR_BYTES} byte cap.`,
      },
      { status: 413 }
    );
  }

  const base64 = Buffer.from(buf).toString('base64');
  if (base64ByteSize(base64) > MAX_OCR_BYTES) {
    console.warn('[passport/extract-mrz] ✕ payload_too_large_base64');
    return NextResponse.json({ error: 'payload_too_large_base64' }, { status: 413 });
  }

  const imageSha256 = createHash('sha256').update(Buffer.from(buf)).digest('hex');
  passportLog('[passport/extract-mrz] hashed image', { sha256Prefix: imageSha256.slice(0, 12) });

  try {
    passportLog('[passport/extract-mrz] → extractDocument(id_document)');
    const tExtract = Date.now();
    const result = await extractDocument({
      kind: 'id_document',
      data: base64,
      mediaType,
      allowSensitive: true,
    });
    passportLog('[passport/extract-mrz] ← extractDocument', {
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      wallClockMs: Date.now() - tExtract,
    });

    if (result.kind !== 'id_document') {
      console.error('[passport/extract-mrz] ✕ unexpected_extraction_kind', { kind: result.kind });
      return NextResponse.json({ error: 'unexpected_extraction_kind' }, { status: 500 });
    }

    const mrzLine1 = result.data.mrz_line1?.trim().toUpperCase() ?? '';
    const mrzLine2 = result.data.mrz_line2?.trim().toUpperCase() ?? '';
    const mrzLine3 = result.data.mrz_line3?.trim().toUpperCase() ?? null;
    // Length-only — NEVER log MRZ values.
    passportLog('[passport/extract-mrz] mrz lengths', {
      line1: mrzLine1.length,
      line2: mrzLine2.length,
      line3: mrzLine3?.length ?? 0,
      documentVariant: result.data.document_variant,
    });

    if (!mrzLine1 || !mrzLine2) {
      console.warn('[passport/extract-mrz] ✕ mrz_not_found');
      return NextResponse.json(
        {
          error: 'mrz_not_found',
          message:
            'Could not read both MRZ lines from this image. Use a clearer photo of the photo page (the two long character lines at the bottom must be visible).',
          imageSha256,
        },
        { status: 422 }
      );
    }

    passportLog('[passport/extract-mrz] ✓ ok', { totalMs: Date.now() - t0 });
    return NextResponse.json({
      mrzLine1,
      mrzLine2,
      mrzLine3,
      documentVariant: result.data.document_variant,
      imageSha256,
      filename,
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[passport/extract-mrz] ✕ extraction_failed', {
      userId,
      error: message,
      totalMs: Date.now() - t0,
    });
    return NextResponse.json(
      {
        error: 'extraction_failed',
        message: 'Vision extractor errored. Try again or paste the MRZ lines manually.',
      },
      { status: 500 }
    );
  }
}
