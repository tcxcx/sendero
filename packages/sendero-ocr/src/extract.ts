/**
 * `extractDocument` — the single public entrypoint for @sendero/ocr.
 *
 * Ported from desk-v1 `packages/documents/src/client.ts` (Fantasmita LLC,
 * internal reuse). Adapted: merged desk-v1's DocumentClient.getInvoiceOrReceipt
 * dispatch with per-kind schema selection and the Sendero safety guardrails
 * (ID/card extraction is gated behind an explicit compliance flag).
 *
 * The caller hands in a base64 document + the kind they want extracted.
 * We pick the right zod schema + prompt, call the Gemini provider, and
 * run post-processing (`normalize.ts`) on the return.
 */

import { extractWithGemini } from './providers/gemini-multimodal';
import { normalizeInvoice, normalizeReceipt } from './normalize';
import {
  boardingPassSchema,
  type BoardingPassExtraction,
  type DocumentKind,
  idDocumentSchema,
  type IdDocumentExtraction,
  invoiceSchema,
  type InvoiceExtraction,
  receiptSchema,
  type ReceiptExtraction,
} from './schemas';

/** The universal per-channel file cap mirrors @sendero/whatsapp MAX_MEDIA_BYTES. */
export const MAX_OCR_BYTES = 20 * 1024 * 1024;

/** Document kinds that can contain sensitive PII (government IDs, cards). */
const SENSITIVE_KINDS: ReadonlyArray<DocumentKind> = ['id_document'];

export interface ExtractDocumentArgs {
  /** What to extract. */
  kind: DocumentKind;
  /** Base64 payload (no data: URI prefix) OR a full data URI. Both are accepted. */
  data: string;
  /** MIME type — must be one of the allowed types below. */
  mediaType: string;
  /** Caller-supplied company context (for invoice vendor disambiguation). */
  companyName?: string | null;
  /**
   * Required to run ID/compliance-sensitive extraction. Callers gate this
   * behind tenant config or an explicit user-consent flag.
   */
  allowSensitive?: boolean;
  /** Override the default Gemini model. */
  model?: string;
  /** Abort signal — caller can wire request-scoped cancellation. */
  signal?: AbortSignal;
}

export type ExtractDocumentResult =
  | {
      kind: 'invoice';
      provider: 'vertex' | 'google';
      model: string;
      latencyMs: number;
      data: InvoiceExtraction;
    }
  | {
      kind: 'receipt';
      provider: 'vertex' | 'google';
      model: string;
      latencyMs: number;
      data: ReceiptExtraction;
    }
  | {
      kind: 'boarding_pass';
      provider: 'vertex' | 'google';
      model: string;
      latencyMs: number;
      data: BoardingPassExtraction;
    }
  | {
      kind: 'id_document';
      provider: 'vertex' | 'google';
      model: string;
      latencyMs: number;
      data: IdDocumentExtraction;
    };

export const ALLOWED_OCR_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export function isAllowedOcrMimeType(mimeType: string): boolean {
  return (ALLOWED_OCR_MIME_TYPES as readonly string[]).includes(mimeType.toLowerCase());
}

/** Estimate the byte size of a base64 payload without decoding. */
export function base64ByteSize(data: string): number {
  // Strip data: URI prefix if present.
  const pure = data.startsWith('data:') ? (data.split(',')[1] ?? '') : data;
  const padding = pure.endsWith('==') ? 2 : pure.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((pure.length * 3) / 4) - padding);
}

export async function extractDocument(
  args: ExtractDocumentArgs
): Promise<ExtractDocumentResult> {
  // ── gatekeeping ──────────────────────────────────────────────────────
  if (!isAllowedOcrMimeType(args.mediaType)) {
    throw new Error(
      `mediaType "${args.mediaType}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(', ')}`
    );
  }
  const size = base64ByteSize(args.data);
  if (size > MAX_OCR_BYTES) {
    // NEVER log the payload — even truncated. Only the shape.
    throw new Error(
      `document payload ${size} bytes exceeds ${MAX_OCR_BYTES} byte cap`
    );
  }
  if (SENSITIVE_KINDS.includes(args.kind) && !args.allowSensitive) {
    throw new Error(
      `kind "${args.kind}" requires compliance-mode opt-in (pass allowSensitive: true)`
    );
  }

  // ── data URI normalization — Vertex and Gemini both accept data: URIs
  // or raw base64 with a separate mediaType; we always send the raw form
  // because AI SDK v6 `type: "file"` parts take `data` + `mediaType`.
  const dataPayload = args.data.startsWith('data:')
    ? (args.data.split(',')[1] ?? args.data)
    : args.data;

  // ── dispatch by kind ─────────────────────────────────────────────────
  switch (args.kind) {
    case 'invoice': {
      const run = await extractWithGemini({
        data: dataPayload,
        mediaType: args.mediaType,
        schema: invoiceSchema,
        systemPrompt: buildInvoicePrompt(args.companyName ?? null),
        model: args.model,
        signal: args.signal,
      });
      return {
        kind: 'invoice',
        provider: run.provider,
        model: run.model,
        latencyMs: run.latencyMs,
        data: normalizeInvoice(run.data),
      };
    }
    case 'receipt': {
      const run = await extractWithGemini({
        data: dataPayload,
        mediaType: args.mediaType,
        schema: receiptSchema,
        systemPrompt: buildReceiptPrompt(args.companyName ?? null),
        model: args.model,
        signal: args.signal,
      });
      return {
        kind: 'receipt',
        provider: run.provider,
        model: run.model,
        latencyMs: run.latencyMs,
        data: normalizeReceipt(run.data),
      };
    }
    case 'boarding_pass': {
      const run = await extractWithGemini({
        data: dataPayload,
        mediaType: args.mediaType,
        schema: boardingPassSchema,
        systemPrompt: BOARDING_PASS_PROMPT,
        model: args.model,
        signal: args.signal,
      });
      return {
        kind: 'boarding_pass',
        provider: run.provider,
        model: run.model,
        latencyMs: run.latencyMs,
        data: run.data,
      };
    }
    case 'id_document': {
      const run = await extractWithGemini({
        data: dataPayload,
        mediaType: args.mediaType,
        schema: idDocumentSchema,
        systemPrompt: ID_DOCUMENT_PROMPT,
        model: args.model,
        signal: args.signal,
      });
      return {
        kind: 'id_document',
        provider: run.provider,
        model: run.model,
        latencyMs: run.latencyMs,
        data: run.data,
      };
    }
  }
}

// ─── prompts ──────────────────────────────────────────────────────────
//
// Prompts are intentionally terse compared to desk-v1's multi-file
// `prompts/` tree. The 4-pass extraction engine there reuses elaborate
// chain-of-thought + format-specific hint blocks; for Sendero's v0 we
// optimize for latency and readability. The desk-v1 prompt library can
// be ported later (see ../../TODO_TOOLS.md → OCR section).

function buildInvoicePrompt(companyName: string | null): string {
  const context = companyName
    ? `Context: "${companyName}" is the RECIPIENT on this invoice. The vendor is whichever entity ISSUED the invoice to them — never "${companyName}" itself.`
    : '';
  return [
    'You extract structured invoice data from documents. Follow the schema exactly.',
    'Dates must be ISO 8601 (YYYY-MM-DD). Currencies must be ISO 4217 three-letter codes.',
    "If the document isn't actually an invoice, set document_type to 'other' and leave financial fields null.",
    context,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildReceiptPrompt(companyName: string | null): string {
  const context = companyName
    ? `Context: "${companyName}" is the BUYER on this receipt. The merchant is the store that issued it — never "${companyName}" itself.`
    : '';
  return [
    'You extract structured receipt data from images. Follow the schema exactly.',
    'Dates must be ISO 8601 (YYYY-MM-DD). Currencies must be ISO 4217.',
    "If the document isn't actually a receipt, set document_type to 'other' and leave financial fields null.",
    context,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const BOARDING_PASS_PROMPT = [
  'You extract boarding-pass data from airline boarding passes (mobile, PDF, or paper).',
  'Use IATA codes where possible (2-letter carrier, 3-letter airport). Dates/times in ISO 8601.',
  'If this is not actually a boarding pass, set document_kind null and leave the rest null.',
  "PNR is usually 6 uppercase alphanumeric characters. Don't confuse it with the ticket number (13 digits).",
].join('\n');

const ID_DOCUMENT_PROMPT = [
  'You extract structured fields from government ID documents (passports, national IDs, driver licenses, residence permits).',
  'Use ISO 3166-1 alpha-3 for country codes and ISO 8601 for dates.',
  'Transcribe the MRZ lines verbatim including fillers (<). TD3 passports have 2 MRZ lines; TD1 national IDs have 3.',
  "If this is not actually an ID document, set document_variant null and leave the rest null.",
].join('\n');
