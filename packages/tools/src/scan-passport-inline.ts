/**
 * scan_passport_inline — Phase D ephemeral passport intake.
 *
 * Triggered when the traveler sends a passport photo over WhatsApp
 * (Kapso passes inbound media to the agent as `documentUrl` or inline
 * base64). The tool:
 *
 *   1. Runs `@sendero/ocr` `extractDocument({ kind: 'id_document' })`
 *      with `allowSensitive: true` against the bytes Kapso handed us.
 *   2. Re-validates the MRZ via `@sendero/vault` `extractPassportFromMrz`
 *      so we have ICAO 9303 checksum-sound evidence the extraction
 *      didn't hallucinate.
 *   3. Upserts the encrypted blob via `upsertPassportVault`. Sanitized
 *      signals (nationality + expiry) land on plaintext columns so
 *      visa lookups + expiry reminders don't need to decrypt.
 *   4. **Drops the image.** The bytes are referenced once for SHA-256
 *      hashing and OCR; never written anywhere on disk. The vault
 *      stores the structured fields only.
 *
 * Privacy positioning (echoed in the agent's preceding nudge): "Send a
 * photo of your passport. Sendero reads the MRZ, fills your booking,
 * then drops the image. We never store the photo."
 *
 * Returns ONLY sanitized signals so a careless `console.log(result)`
 * upstream can't leak passport_number / DOB / surname. Decryption goes
 * through `@sendero/vault decryptVaultPayload` with explicit actor
 * audit when `book_flight` needs to fill the Duffel passenger.
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';

import {
  ALLOWED_OCR_MIME_TYPES,
  base64ByteSize,
  extractDocument,
  isAllowedOcrMimeType,
  MAX_OCR_BYTES,
  type IdDocumentExtraction,
} from '@sendero/ocr';
import {
  extractPassportFromMrz,
  upsertPassportVault,
  type PassportVaultVariant,
} from '@sendero/vault';
import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  documentUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'HTTPS URL of the passport image (Kapso media URL or signed S3 link). Either documentUrl OR data+mediaType must be supplied.'
    ),
  data: z
    .string()
    .optional()
    .describe('Base64-encoded image bytes. Use this when Kapso forwarded inline media.'),
  mediaType: z
    .string()
    .optional()
    .describe(
      'MIME type — required when supplying base64 data. Must be image/jpeg, image/png, image/heic, or image/webp.'
    ),
});

type ScanPassportInlineInput = z.infer<typeof inputSchema>;

interface ScanPassportInlineResult {
  status: 'saved' | 'invalid_mrz' | 'no_traveler' | 'unsupported';
  /** Friendly one-line status the agent can repeat to the traveler. */
  message: string;
  /** Sanitized signals — safe to log. Never includes passport_number / DOB / names. */
  signals?: {
    documentVariant: PassportVaultVariant;
    nationalityIso3: string | null;
    expiresOn: string | null;
    mrzChecksumValid: boolean;
  };
}

export const scanPassportInlineTool: ToolDef = {
  name: 'scan_passport_inline',
  description:
    'Extract structured fields from a passport photo and store them in the encrypted PassportVault for the signed-in traveler. Image bytes are NEVER persisted — only the MRZ-derived data plus sanitized signals (nationality + expiry) survive past this call. Returns sanitized signals only; book_flight reads the encrypted blob via the vault when it needs to fill Duffel passenger.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      documentUrl: { type: 'string', format: 'uri' },
      data: { type: 'string' },
      mediaType: { type: 'string' },
    },
  },
  async handler(
    input: ScanPassportInlineInput,
    ctx?: ToolContext
  ): Promise<ScanPassportInlineResult> {
    const tenantId = ctx?.traveler?.tenantId;
    const userId = ctx?.traveler?.userId;
    if (!tenantId || !userId || userId.startsWith('svc:')) {
      return {
        status: 'no_traveler',
        message:
          'No traveler resolved on this turn. Pass `travelerPhone` (E.164) on `call_sendero` so the passport binds to a real Sendero User.',
      };
    }

    if (!input.documentUrl && !(input.data && input.mediaType)) {
      return {
        status: 'unsupported',
        message:
          'scan_passport_inline needs either `documentUrl` or both `data` + `mediaType`. Neither was supplied.',
      };
    }

    let bytes: { base64: string; mediaType: string };
    try {
      bytes = input.documentUrl
        ? await fetchDocument(input.documentUrl)
        : { base64: input.data ?? '', mediaType: input.mediaType ?? '' };
    } catch (err) {
      return {
        status: 'unsupported',
        message: err instanceof Error ? err.message : String(err),
      };
    }

    if (!isAllowedOcrMimeType(bytes.mediaType)) {
      return {
        status: 'unsupported',
        message: `mediaType "${bytes.mediaType}" not allowed. Use one of: ${ALLOWED_OCR_MIME_TYPES.join(', ')}.`,
      };
    }
    const size = base64ByteSize(bytes.base64);
    if (size > MAX_OCR_BYTES) {
      return {
        status: 'unsupported',
        message: `passport image (${size} bytes) exceeds ${MAX_OCR_BYTES} byte cap.`,
      };
    }

    // Run the multimodal extractor. `allowSensitive: true` is set HERE,
    // not from the LLM — this tool only fires when the agent has just
    // received the image as part of an authenticated traveler turn.
    let ocr: IdDocumentExtraction;
    try {
      const res = await extractDocument({
        kind: 'id_document',
        data: bytes.base64,
        mediaType: bytes.mediaType,
        allowSensitive: true,
      });
      if (res.kind !== 'id_document') {
        return {
          status: 'unsupported',
          message: 'OCR returned an unexpected document kind. Re-scan with a clearer image.',
        };
      }
      ocr = res.data;
    } catch (err) {
      return {
        status: 'unsupported',
        message: `OCR failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // Hash the bytes ONCE — used inside the encrypted blob for dedup
    // (so an attacker who somehow obtains a vault row can't do a
    // birthday-attack on which traveler uploaded which image). Bytes
    // discarded after this line.
    const imageSha256 = createHash('sha256')
      .update(Buffer.from(bytes.base64, 'base64'))
      .digest('hex');

    // Re-validate via mrz-fast for the ICAO 9303 checksum proof. When
    // the OCR returned MRZ lines that pass, we trust the extraction —
    // when they don't, we tell the traveler to re-scan rather than
    // persisting hallucinated fields.
    let mrzValidated = ocr;
    let mrzChecksumValid = false;
    if (ocr.mrz_line1 && ocr.mrz_line2) {
      const validated = extractPassportFromMrz({
        mrzLine1: ocr.mrz_line1,
        mrzLine2: ocr.mrz_line2,
        imageSha256,
      });
      if (validated && validated.mrzChecksumValid) {
        mrzChecksumValid = true;
        // Promote MRZ-derived fields where they disagree with the
        // visual zone — MRZ is authoritative on a real passport.
        mrzValidated = {
          ...ocr,
          surname: validated.surname,
          given_names: validated.givenNames,
          document_number: validated.documentNumber,
          nationality: validated.nationality,
          date_of_birth: validated.dateOfBirth,
          date_of_expiry: validated.expirationDate,
          issuing_country: validated.issuingState,
          sex: validated.sex,
        };
      }
    }
    if (!mrzChecksumValid) {
      return {
        status: 'invalid_mrz',
        message:
          'Could not validate the MRZ checksum on this image. Send a clearer photo of the photo page — make sure both bottom lines (the angled letters + numbers) are fully visible.',
      };
    }

    const documentVariant: PassportVaultVariant =
      mrzValidated.document_variant === 'national_id'
        ? 'national_id'
        : mrzValidated.document_variant === 'drivers_license'
          ? 'drivers_license'
          : mrzValidated.document_variant === 'residence_permit'
            ? 'residence_permit'
            : 'passport';

    // Upsert into the vault. The full extraction goes inside ciphertext;
    // nationalityIso3 + expiresOn land on plaintext columns so visa
    // lookups + expiry reminders don't decrypt.
    const expiresOnIso = mrzValidated.date_of_expiry;
    const expiresOn = expiresOnIso ? new Date(expiresOnIso) : null;
    try {
      const signals = await upsertPassportVault(prisma, {
        tenantId,
        userId,
        documentVariant,
        payload: {
          extraction: mrzValidated,
          imageSha256,
          filename: null,
          uploadedAt: new Date().toISOString(),
        },
        signals: {
          nationalityIso3: mrzValidated.nationality ?? null,
          expiresOn: expiresOn && !Number.isNaN(expiresOn.getTime()) ? expiresOn : null,
          mrzChecksumValid,
        },
        extractedBy: 'mrz_fast',
        actor: {
          actorRef: `agent:scan_passport_inline:${userId}`,
          source: 'tool/scan_passport_inline',
        },
      });
      const expiryLabel = signals.expiresOn
        ? signals.expiresOn.toLocaleDateString('en-US', {
            month: 'short',
            year: 'numeric',
          })
        : 'unknown';
      return {
        status: 'saved',
        message: `Passport saved · expires ${expiryLabel}. Image dropped. Future bookings won't ask again.`,
        signals: {
          documentVariant: signals.documentVariant,
          nationalityIso3: signals.nationalityIso3,
          expiresOn: signals.expiresOn?.toISOString().slice(0, 10) ?? null,
          mrzChecksumValid: signals.mrzChecksumValid,
        },
      };
    } catch (err) {
      const kekDiag = `kek_set=${Boolean(process.env.PASSPORT_VAULT_KEK)}, kek_len=${process.env.PASSPORT_VAULT_KEK?.length ?? 0}`;
      return {
        status: 'unsupported',
        message: `vault upsert failed [${kekDiag}]: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

// ── Document fetch with SSRF guards (mirrors scan-document.ts) ─────────

async function fetchDocument(url: string): Promise<{ base64: string; mediaType: string }> {
  assertFetchableUrl(url);
  // Kapso `active_storage/blobs/redirect/…` URLs are signed, but the
  // signed redirect requires Bearer auth — anonymous fetches return
  // 404. When the URL is on app.kapso.ai, attach our project API key
  // so the agent can pass us inbound-media URLs without us having to
  // base64-roundtrip through the prompt.
  const headers: Record<string, string> = {};
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'app.kapso.ai' || host.endsWith('.kapso.ai')) {
      const kapsoKey = process.env.KAPSO_API_KEY;
      if (kapsoKey) {
        headers['X-API-Key'] = kapsoKey;
      }
    }
  } catch {
    /* fall through */
  }
  const response = await fetch(url, { redirect: 'manual', headers });
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get('location');
    if (!next) throw new Error('passport image fetch: redirect without location header');
    assertFetchableUrl(next);
    return fetchDocument(next);
  }
  if (!response.ok) {
    throw new Error(`passport image fetch failed: ${response.status}`);
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!isAllowedOcrMimeType(mediaType)) {
    throw new Error(`remote content-type "${mediaType}" not allowed.`);
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_OCR_BYTES) {
    throw new Error(`remote document (${buf.byteLength} bytes) exceeds ${MAX_OCR_BYTES} byte cap`);
  }
  const base64 = Buffer.from(buf).toString('base64');
  return { base64, mediaType };
}

function assertFetchableUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('invalid passport image URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`only https:// URLs allowed (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === '::1' ||
    host.startsWith('[::1]') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new Error('private-range URL refused');
  }
  if (/^127\./.test(host)) throw new Error('loopback URL refused');
  if (/^10\./.test(host)) throw new Error('private-range URL refused');
  if (/^192\.168\./.test(host)) throw new Error('private-range URL refused');
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) throw new Error('private-range URL refused');
  if (/^169\.254\./.test(host)) throw new Error('link-local / metadata URL refused');
  if (host === '0.0.0.0') throw new Error('wildcard URL refused');
  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'metadata') {
    throw new Error('local hostname refused');
  }
}
