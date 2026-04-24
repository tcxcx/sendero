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

/**
 * Server-side fetch of a document URL, returning base64 + resolved
 * mimetype. Guards against SSRF: the LLM controls `documentUrl`, so a
 * crafted prompt could otherwise pull cloud metadata endpoints or
 * internal services (169.254.169.254, 127.0.0.1, 10.x.x.x, etc.) and
 * leak creds or internal state.
 *
 * Rules:
 *   - https only (http is rejected; data:/file:/ftp: never reach fetch)
 *   - literal IP hostnames are blocked if they fall in private/link-
 *     local/loopback ranges
 *   - loopback + common local hostnames blocked
 *   - redirect chain hops re-enter this guard (fetch's default redirect
 *     follow can smuggle a private IP as the second hop)
 *
 * Limitation: we don't resolve the hostname to an IP before fetching.
 * An attacker-controlled DNS record pointing at 127.0.0.1 would slip
 * through. For a hardened production guard, resolve via `dns.lookup`
 * and re-check. Deferred to avoid a Node-only dependency in this
 * package; the domain-level guard already blocks the common attacks.
 */
async function fetchDocument(url: string): Promise<{ base64: string; mediaType: string }> {
  assertFetchableUrl(url);
  const response = await fetch(url, { redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const next = response.headers.get('location');
    if (!next) throw new Error('scan_document: redirect without location header');
    assertFetchableUrl(next);
    return fetchDocument(next);
  }
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

/** Reject private-range URLs, non-https schemes, and known bad hostnames. */
function assertFetchableUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('scan_document: invalid URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`scan_document: only https:// URLs are allowed (got ${parsed.protocol})`);
  }
  const host = parsed.hostname.toLowerCase();

  // Block IPv6 loopback / link-local / unique-local
  if (
    host === '::1' ||
    host.startsWith('[::1]') ||
    host.startsWith('fc') ||
    host.startsWith('fd')
  ) {
    throw new Error('scan_document: private-range URL refused');
  }
  // Block IPv4 loopback + private + link-local + cloud-metadata
  if (/^127\./.test(host)) throw new Error('scan_document: loopback URL refused');
  if (/^10\./.test(host)) throw new Error('scan_document: private-range URL refused');
  if (/^192\.168\./.test(host)) throw new Error('scan_document: private-range URL refused');
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host))
    throw new Error('scan_document: private-range URL refused');
  if (/^169\.254\./.test(host)) throw new Error('scan_document: link-local / metadata URL refused');
  if (host === '0.0.0.0') throw new Error('scan_document: wildcard URL refused');

  // Common local hostnames.
  if (host === 'localhost' || host === 'metadata.google.internal' || host === 'metadata') {
    throw new Error('scan_document: local hostname refused');
  }
}
