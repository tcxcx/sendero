/**
 * POST /api/scan
 *
 * Accepts a multipart/form-data upload + a `kind` discriminator, runs
 * it through @sendero/ocr (Gemini multimodal + Zod-backed structured
 * output), returns the parsed extraction plus provider + model +
 * latency for the UI header.
 *
 * Requires a signed-in Clerk user — this is an interactive surface,
 * not an agent/LLM entry point. For API-key-authenticated scanning
 * use the `scan_document` tool via `/api/agent/dispatch` or MCP.
 */

import { auth } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';

import {
  ALLOWED_OCR_MIME_TYPES,
  base64ByteSize,
  extractDocument,
  isAllowedOcrMimeType,
  MAX_OCR_BYTES,
  type DocumentKind,
} from '@sendero/ocr';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const ALLOWED_KINDS: ReadonlyArray<DocumentKind> = ['invoice', 'receipt', 'boarding_pass'];

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json(
      {
        error: 'invalid_content_type',
        message: 'POST as multipart/form-data with fields `file` and `kind`.',
      },
      { status: 415 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 });
  }

  const rawKind = String(form.get('kind') ?? 'receipt').toLowerCase() as DocumentKind;
  if (!ALLOWED_KINDS.includes(rawKind)) {
    return NextResponse.json(
      { error: 'invalid_kind', message: `kind must be one of ${ALLOWED_KINDS.join(', ')}` },
      { status: 400 }
    );
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json(
      { error: 'missing_file', message: 'Include a `file` field.' },
      { status: 400 }
    );
  }

  const mediaType = file.type || 'application/octet-stream';
  if (!isAllowedOcrMimeType(mediaType)) {
    return NextResponse.json(
      {
        error: 'unsupported_media_type',
        message: `mediaType "${mediaType}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(', ')}.`,
      },
      { status: 415 }
    );
  }

  const buf = await file.arrayBuffer();
  if (buf.byteLength > MAX_OCR_BYTES) {
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
    return NextResponse.json({ error: 'payload_too_large_base64' }, { status: 413 });
  }

  const companyName = form.get('companyName');

  try {
    const result = await extractDocument({
      kind: rawKind,
      data: base64,
      mediaType,
      companyName: typeof companyName === 'string' && companyName ? companyName : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/scan] extraction failed', { userId, kind: rawKind, error: message });
    return NextResponse.json({ error: 'extraction_failed', message }, { status: 500 });
  }
}
