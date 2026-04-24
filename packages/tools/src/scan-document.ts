/**
 * scan_document — structured document extraction tool.
 *
 * Thin wrapper over `@sendero/ocr`'s `extractDocument` that makes the
 * multimodal pipeline callable from the LLM. Accepts either a public
 * URL (fetched server-side) or an inline base64 payload the agent has
 * already been handed via the message content array.
 *
 * Use cases (v0):
 *   - receipts uploaded for expense-report filing
 *   - boarding passes attached to a trip (Duffel PNR cross-check)
 *   - invoices forwarded by corporate buyers for reconciliation
 *
 * ID documents are supported but require explicit compliance-mode
 * opt-in via `allowSensitive: true` at the tool call site — an admin
 * must flag the tenant, we don't honour it from LLM output alone.
 */

import {
  ALLOWED_OCR_MIME_TYPES,
  extractDocument,
  isAllowedOcrMimeType,
  MAX_OCR_BYTES,
  base64ByteSize,
  type ExtractDocumentResult,
} from '@sendero/ocr';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  kind: z
    .enum(['invoice', 'receipt', 'boarding_pass', 'id_document'])
    .describe(
      'Document type to extract. Pick the tightest fit — invoice for bills, receipt for proof of purchase, boarding_pass for airline boarding passes, id_document for passports / national IDs (compliance mode only).'
    ),
  documentUrl: z
    .string()
    .url()
    .optional()
    .describe(
      'HTTPS URL of the document. Either documentUrl OR data+mediaType must be supplied.'
    ),
  data: z
    .string()
    .optional()
    .describe(
      'Base64-encoded document bytes. Prefer documentUrl when the file is already hosted.'
    ),
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
      'Context hint: the buying / receiving company name. Helps the extractor pick the right side of an invoice (vendor vs customer).'
    ),
});

type ScanDocumentInput = z.infer<typeof inputSchema>;

export const scanDocumentTool: ToolDef = {
  name: 'scan_document',
  description:
    'Extract structured fields from a travel / finance document (invoice, receipt, boarding pass, or ID). Accepts either a public URL or inline base64. Returns a typed object plus provider + model + latency.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: {
        type: 'string',
        enum: ['invoice', 'receipt', 'boarding_pass', 'id_document'],
      },
      documentUrl: { type: 'string', format: 'uri' },
      data: { type: 'string' },
      mediaType: { type: 'string' },
      companyName: { type: 'string' },
    },
  },
  async handler(input: ScanDocumentInput, ctx?: ToolContext): Promise<ExtractDocumentResult> {
    const { kind, documentUrl, data, mediaType, companyName } = input;

    // Require one of the two input shapes.
    if (!documentUrl && !(data && mediaType)) {
      throw new Error(
        'scan_document requires either documentUrl, or both data + mediaType. Neither was supplied.'
      );
    }

    // ID documents are compliance-gated — we NEVER honour allowSensitive
    // from the LLM's arguments. Admins set this via tenant config; for
    // hackathon demo scope we pass through `ctx.traveler` and leave the
    // compliance gate off unless the caller explicitly flips it.
    if (kind === 'id_document') {
      // Touch ctx to prove a future admin-flag read is plausible here.
      void ctx;
      throw new Error(
        "scan_document for kind 'id_document' is compliance-gated. Enable the feature flag on the tenant before calling."
      );
    }

    if (documentUrl) {
      const fetched = await fetchDocument(documentUrl);
      return await extractDocument({
        kind,
        data: fetched.base64,
        mediaType: fetched.mediaType,
        companyName: companyName ?? null,
      });
    }

    // Inline base64 path — validate before delegating.
    if (!mediaType || !isAllowedOcrMimeType(mediaType)) {
      throw new Error(
        `scan_document: mediaType "${mediaType ?? ''}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(
          ', '
        )}`
      );
    }
    const size = base64ByteSize(data ?? '');
    if (size > MAX_OCR_BYTES) {
      throw new Error(
        `scan_document: document payload (${size} bytes) exceeds ${MAX_OCR_BYTES} byte cap`
      );
    }

    return await extractDocument({
      kind,
      data: data ?? '',
      mediaType,
      companyName: companyName ?? null,
    });
  },
};

/** Server-side fetch of a document URL, returning base64 + resolved mimetype. */
async function fetchDocument(url: string): Promise<{ base64: string; mediaType: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`scan_document: failed to fetch ${url} — ${response.status}`);
  }
  const mediaType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!isAllowedOcrMimeType(mediaType)) {
    throw new Error(
      `scan_document: remote content-type "${mediaType}" is not allowed. Allowed: ${ALLOWED_OCR_MIME_TYPES.join(
        ', '
      )}`
    );
  }
  const buf = await response.arrayBuffer();
  if (buf.byteLength > MAX_OCR_BYTES) {
    throw new Error(
      `scan_document: remote document (${buf.byteLength} bytes) exceeds ${MAX_OCR_BYTES} byte cap`
    );
  }
  // Node / Bun environments both have global Buffer.
  const base64 = Buffer.from(buf).toString('base64');
  return { base64, mediaType };
}
