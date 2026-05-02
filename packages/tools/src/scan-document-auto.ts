/**
 * scan_document_auto — auto-detecting document extractor.
 *
 * Sibling of `scan_document` that does NOT require the caller to know
 * the document kind upfront. Useful when an image arrives via any
 * channel (Slack file share, WhatsApp media, web chat attachment, or
 * an internally-injected URL) and the agent doesn't yet know whether
 * it's a passport, invoice, receipt, boarding pass, or noise.
 *
 * Pipeline:
 *   1. Fetch / decode the image (URL or base64), with the same SSRF
 *      guards `scan_document` uses.
 *   2. Classify with a one-shot Gemini vision pass against a tiny Zod
 *      schema returning `{ kind, confidence, hint }`.
 *   3. If `kind === 'unknown'` or confidence is too low, return a
 *      classification-only result so the agent can ask the user.
 *   4. Otherwise dispatch to `extractDocument({ kind, ... })`.
 *   5. For `id_document` with a known traveler in `ctx`, also write to
 *      the PassportVault so the user's vault stays canonical (mirrors
 *      `/api/passport/upload` behavior).
 *
 * Why a separate tool instead of making `scan_document` smarter:
 *   - `scan_document` is a precision tool — agent calls it when it
 *     knows the kind. Adding auto-detect changes its semantics and
 *     adds latency to the precision path.
 *   - Auto-detect costs an extra Gemini round trip (~600ms). Worth it
 *     when kind is unknown, wasted when it's not.
 *   - Keeps the gates separate: the auto-tool can run id_document
 *     extraction for the *signed-in* user without operator opt-in,
 *     because the user is uploading their own document. The precision
 *     tool stays compliance-gated.
 */

import { prisma } from '@sendero/database';
import {
  ALLOWED_OCR_MIME_TYPES,
  base64ByteSize,
  type ExtractDocumentResult,
  extractDocument,
  extractWithGemini,
  isAllowedOcrMimeType,
  MAX_OCR_BYTES,
} from '@sendero/ocr';
import { extractPassportFromMrz, upsertPassportVault } from '@sendero/vault';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';
import { createHash } from 'node:crypto';

const inputSchema = z.object({
  documentUrl: z
    .string()
    .url()
    .optional()
    .describe('HTTPS URL of the document. Either documentUrl OR data+mediaType must be supplied.'),
  data: z
    .string()
    .optional()
    .describe('Base64-encoded document bytes. Prefer documentUrl when the file is already hosted.'),
  mediaType: z
    .string()
    .optional()
    .describe(
      'MIME type — required when supplying base64 data. Must be application/pdf or an allowed image type.'
    ),
  companyName: z
    .string()
    .optional()
    .describe(
      'Optional context hint forwarded to invoice/receipt extraction (vendor disambiguation).'
    ),
  hint: z
    .string()
    .optional()
    .describe(
      'Optional natural-language hint about what the document is, e.g. "this should be a boarding pass". Helps the classifier when the photo is ambiguous.'
    ),
});

type ScanAutoInput = z.infer<typeof inputSchema>;

const classifierSchema = z.object({
  kind: z
    .enum(['invoice', 'receipt', 'boarding_pass', 'id_document', 'unknown'])
    .describe('Best-matching document kind. Use "unknown" when none clearly fits.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Self-rated confidence in the classification, 0..1.'),
  reasoning: z
    .string()
    .describe('One short sentence explaining the classification (e.g. visible MRZ → passport).'),
});

type ClassifierResult = z.infer<typeof classifierSchema>;

interface ScanDocumentAutoResult {
  detectedKind: ClassifierResult['kind'];
  classifierConfidence: number;
  classifierReasoning: string;
  classifierLatencyMs: number;
  extraction: ExtractDocumentResult | null;
  vaultSaved?: {
    vaultId: string;
    documentVariant: string;
    nationalityIso3: string | null;
    expiresOn: string | null;
    mrzChecksumValid: boolean;
  };
  imageSha256: string;
}

const CLASSIFIER_PROMPT = [
  'You are a document classifier. Look at the document image and pick exactly ONE category.',
  '',
  'Categories:',
  '  • invoice — a bill from a vendor with line items, totals, due date',
  '  • receipt — a proof-of-purchase from a store / restaurant / hotel',
  '  • boarding_pass — an airline boarding pass (PNR, flight number, gate, seat)',
  '  • id_document — a passport, national ID, driver license, or residence permit (look for MRZ lines, photo, document number)',
  '  • unknown — none of the above clearly fits',
  '',
  'Return your best confidence (0..1). For ambiguous documents, return confidence < 0.6.',
  'Keep reasoning to one short sentence.',
].join('\n');

const MIN_CONFIDENCE = 0.55;

export const scanDocumentAutoTool: ToolDef = {
  name: 'scan_document_auto',
  description:
    'Auto-detect the kind of a document image (invoice / receipt / boarding pass / passport) and extract structured fields in one shot. Use this when an image arrives in conversation and you do not yet know what kind it is. For known-kind extraction, prefer `scan_document` (cheaper, no classifier round-trip).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      documentUrl: { type: 'string', format: 'uri' },
      data: { type: 'string' },
      mediaType: { type: 'string' },
      companyName: { type: 'string' },
      hint: { type: 'string' },
    },
  },
  async handler(input: ScanAutoInput, ctx?: ToolContext): Promise<ScanDocumentAutoResult> {
    const { documentUrl, data, mediaType, companyName, hint } = input;
    if (!documentUrl && !(data && mediaType)) {
      throw new Error(
        'scan_document_auto requires either documentUrl, or both data + mediaType. Neither was supplied.'
      );
    }

    // ── 1. resolve image bytes ─────────────────────────────────────
    let base64: string;
    let resolvedMediaType: string;
    if (documentUrl) {
      const fetched = await fetchDocument(documentUrl);
      base64 = fetched.base64;
      resolvedMediaType = fetched.mediaType;
    } else {
      if (!mediaType || !isAllowedOcrMimeType(mediaType)) {
        throw new Error(
          `scan_document_auto: mediaType "${mediaType ?? ''}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(', ')}`
        );
      }
      const size = base64ByteSize(data ?? '');
      if (size > MAX_OCR_BYTES) {
        throw new Error(
          `scan_document_auto: document payload (${size} bytes) exceeds ${MAX_OCR_BYTES} byte cap`
        );
      }
      base64 = data ?? '';
      resolvedMediaType = mediaType;
    }

    // Hash for audit + vault dedup. Computed regardless of kind so the
    // result is reproducible across reruns.
    const imageSha256 = createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex');

    // ── 2. classify ────────────────────────────────────────────────
    const tClass = Date.now();
    const classifierRun = await extractWithGemini({
      data: base64,
      mediaType: resolvedMediaType,
      schema: classifierSchema,
      systemPrompt: hint ? `${CLASSIFIER_PROMPT}\n\nUser hint: ${hint}` : CLASSIFIER_PROMPT,
    });
    const classifier = classifierRun.data;
    const classifierLatencyMs = Date.now() - tClass;

    // Below confidence floor or unknown → don't burn a second extraction
    // call; surface the classification so the agent can ask the user.
    if (classifier.kind === 'unknown' || classifier.confidence < MIN_CONFIDENCE) {
      return {
        detectedKind: classifier.kind,
        classifierConfidence: classifier.confidence,
        classifierReasoning: classifier.reasoning,
        classifierLatencyMs,
        extraction: null,
        imageSha256,
      };
    }

    // ── 3. extract per detected kind ───────────────────────────────
    const extraction = await extractDocument({
      kind: classifier.kind,
      data: base64,
      mediaType: resolvedMediaType,
      companyName: companyName ?? null,
      // Auto-tool runs on user-uploaded content from authenticated
      // channels — the user is consenting to scan their own document.
      // The compliance-gate on the precision `scan_document` tool
      // exists to stop a prompt-injected URL from being scanned; here
      // the channel auth is the gate.
      ...(classifier.kind === 'id_document' ? { allowSensitive: true } : {}),
    });

    // ── 4. passport → vault write (when traveler context is known) ─
    let vaultSaved: ScanDocumentAutoResult['vaultSaved'];
    if (
      classifier.kind === 'id_document' &&
      extraction.kind === 'id_document' &&
      ctx?.traveler?.userId &&
      ctx?.traveler?.tenantId
    ) {
      const mrz1 = extraction.data.mrz_line1?.trim().toUpperCase() ?? '';
      const mrz2 = extraction.data.mrz_line2?.trim().toUpperCase() ?? '';
      if (mrz1 && mrz2) {
        const parsed = extractPassportFromMrz({
          mrzLine1: mrz1,
          mrzLine2: mrz2,
          imageSha256,
          filename: null,
        });
        if (parsed) {
          const signals = await upsertPassportVault(prisma, {
            tenantId: ctx.traveler.tenantId,
            userId: ctx.traveler.userId,
            documentVariant: 'passport',
            payload: {
              extraction: parsed,
              imageSha256,
              filename: null,
              uploadedAt: new Date().toISOString(),
            },
            signals: {
              nationalityIso3: parsed.nationality || null,
              expiresOn: parsed.expirationDate ? new Date(parsed.expirationDate) : null,
              mrzChecksumValid: parsed.mrzChecksumValid,
            },
            // Same label as `/api/passport/upload`: Gemini transcribed the
            // lines but mrz-fast did the structured parse + checksum.
            extractedBy: 'mrz_fast',
            actor: {
              actorRef: `usr:${ctx.traveler.userId}`,
              source: 'tool/scan_document_auto',
              context: { detectedConfidence: classifier.confidence },
            },
          });
          vaultSaved = {
            vaultId: signals.id,
            documentVariant: signals.documentVariant,
            nationalityIso3: signals.nationalityIso3,
            expiresOn: signals.expiresOn ? signals.expiresOn.toISOString().slice(0, 10) : null,
            mrzChecksumValid: signals.mrzChecksumValid,
          };
        }
      }
    }

    return {
      detectedKind: classifier.kind,
      classifierConfidence: classifier.confidence,
      classifierReasoning: classifier.reasoning,
      classifierLatencyMs,
      extraction,
      vaultSaved,
      imageSha256,
    };
  },
};

// ── SSRF-guarded URL fetch (mirror of scan-document's helper) ────
//
// Duplicated rather than imported so this tool stays self-contained
// and parallel edits to `scan-document.ts` don't ripple. The guards
// are short and well-tested; dedupe later if both callers grow.

async function fetchDocument(url: string): Promise<{ base64: string; mediaType: string }> {
  assertFetchableUrl(url);
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get('location');
    if (!next) throw new Error('scan_document_auto: redirect without location header');
    assertFetchableUrl(next);
    return fetchDocument(next);
  }
  if (!response.ok) {
    throw new Error(`scan_document_auto: failed to fetch ${url} — ${response.status}`);
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!isAllowedOcrMimeType(mediaType)) {
    throw new Error(
      `scan_document_auto: remote content-type "${mediaType}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(', ')}`
    );
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_OCR_BYTES) {
    throw new Error(
      `scan_document_auto: remote document (${buf.byteLength} bytes) exceeds ${MAX_OCR_BYTES} byte cap`
    );
  }
  const base64 = Buffer.from(buf).toString('base64');
  return { base64, mediaType };
}

function assertFetchableUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (err) {
    console.warn('[scan-document-auto] invalid URL supplied', raw, err);
    throw new Error('scan_document_auto: invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`scan_document_auto: only https:// URLs are allowed (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '::1' ||
    host.startsWith('[::1]') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new Error('scan_document_auto: private-range URL refused');
  }
  if (/^127\./.test(host)) throw new Error('scan_document_auto: loopback URL refused');
  if (/^10\./.test(host)) throw new Error('scan_document_auto: private-range URL refused');
  if (/^192\.168\./.test(host)) throw new Error('scan_document_auto: private-range URL refused');
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host))
    throw new Error('scan_document_auto: private-range URL refused');
  if (/^169\.254\./.test(host))
    throw new Error('scan_document_auto: link-local / metadata URL refused');
  if (host === '0.0.0.0') throw new Error('scan_document_auto: wildcard URL refused');
  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'metadata') {
    throw new Error('scan_document_auto: local hostname refused');
  }
}
