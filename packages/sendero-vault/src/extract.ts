/**
 * Passport extraction — the privileged path.
 *
 * Two inputs are supported, one default:
 *
 *   - `mrzText` (default) — two lines of MRZ text from the scanned
 *     passport. Cheapest, most private: the caller (a Vercel function
 *     on the traveler upload route) runs `tesseract` or an MRZ-specific
 *     client-side OCR, gets the two 44-char lines, and hands them to
 *     us. The image bytes can be discarded before this function is
 *     even called.
 *
 *   - `image` (fallback) — base64 PDF/image + mediaType. Routed
 *     through @sendero/ocr `extractDocument({ kind: 'id_document' })`
 *     which requires `allowSensitive: true` and is gated by the
 *     tenant's `vertexZdrApproved` compliance flag. That path sends
 *     the image to Vertex AI under Zero Data Retention.
 *
 * Both paths converge on the same output: a validated, checksum-sound
 * `ExtractedPassport` ready to hand off to `upsertPassportVault`.
 *
 * The checksum is the whole point of routing through MRZ. ICAO 9303
 * gives us a composite check digit that cross-validates the whole
 * record. A successful checksum is machine evidence the extraction
 * didn't hallucinate.  No LLM round-trip is required to trust it.
 */

import { parseMRZ, type ParseResult } from 'mrz-fast';

export interface ExtractedPassport {
  /** Hex-encoded SHA-256 of the original file. Stored inside the
   *  encrypted ciphertext, never in plaintext columns. */
  imageSha256: string;

  /** Original filename as uploaded. Inside ciphertext, not plaintext. */
  filename: string | null;

  /** ICAO document code — 'P' (passport), 'PC', 'IR' (residence), etc. */
  documentCode: string;

  /** ISO 3166-1 alpha-3 issuing state. */
  issuingState: string;

  /** Full name as printed. Stored inside ciphertext only. */
  surname: string;
  givenNames: string;

  /** Passport number as printed. Stored inside ciphertext only. */
  documentNumber: string;

  /** ISO 3166-1 alpha-3 nationality. The one field we promote to the
   *  plaintext signals column because visa rules need it. */
  nationality: string;

  /** Date of birth (ISO 8601 date). Inside ciphertext only. */
  dateOfBirth: string;

  /** Sex as printed. Inside ciphertext only. */
  sex: 'M' | 'F' | 'X' | null;

  /** Expiry date (ISO 8601 date). Promoted to plaintext signals for
   *  6-month-rule checks. */
  expirationDate: string;

  /** Raw MRZ lines — inside ciphertext; never plaintext. */
  mrzLine1: string;
  mrzLine2: string;

  /** Whether every per-field check digit AND the composite check
   *  digit passed. We only promote this to plaintext. */
  mrzChecksumValid: boolean;

  /** Which extractor produced this record. */
  extractedBy: 'mrz_fast' | 'gemini_zdr';
}

export interface ExtractFromMrzInput {
  mrzLine1: string;
  mrzLine2: string;
  imageSha256: string;
  filename?: string | null;
}

/**
 * Parse + validate a pair of MRZ lines with `mrz-fast`.  Returns null
 * when the MRZ is malformed beyond error correction — caller should
 * fall through to the image path (if allowed) or prompt the user to
 * re-scan.
 */
export function extractPassportFromMrz(input: ExtractFromMrzInput): ExtractedPassport | null {
  const parsed: ParseResult = parseMRZ([input.mrzLine1, input.mrzLine2] as const, {
    errorCorrection: true,
  });

  if (!parsed.valid) return null;
  const f = parsed.fields;
  if (
    !f.documentCode ||
    !f.issuingState ||
    !f.lastName ||
    !f.firstName ||
    !f.documentNumber ||
    !f.nationality ||
    !f.birthDate ||
    !f.expirationDate
  ) {
    return null;
  }

  return {
    imageSha256: input.imageSha256,
    filename: input.filename ?? null,
    documentCode: f.documentCode,
    issuingState: f.issuingState,
    surname: f.lastName,
    givenNames: f.firstName,
    documentNumber: f.documentNumber,
    nationality: f.nationality,
    dateOfBirth: mrzDateToIso(f.birthDate),
    sex: normalizeSex(f.sex ?? null),
    expirationDate: mrzDateToIso(f.expirationDate),
    mrzLine1: parsed.lines.line1,
    mrzLine2: parsed.lines.line2,
    mrzChecksumValid: parsed.valid,
    extractedBy: 'mrz_fast',
  };
}

/**
 * MRZ dates are YYMMDD.  We assume the 19xx/20xx cutoff at year 50:
 * "YY < 50 → 20YY; YY >= 50 → 19YY".  This matches ICAO 9303
 * convention for dates of birth; for expiry dates the reverse would
 * technically be more correct (no one has an expiry in 1999) but the
 * same heuristic works for everyone born before 2050.
 */
function mrzDateToIso(mrzDate: string): string {
  const yy = mrzDate.slice(0, 2);
  const mm = mrzDate.slice(2, 4);
  const dd = mrzDate.slice(4, 6);
  const year = Number.parseInt(yy, 10) >= 50 ? `19${yy}` : `20${yy}`;
  return `${year}-${mm}-${dd}`;
}

function normalizeSex(sex: string | null): 'M' | 'F' | 'X' | null {
  if (sex === 'M' || sex === 'F' || sex === 'X') return sex;
  return null;
}
