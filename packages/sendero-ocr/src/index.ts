/**
 * @sendero/ocr — multimodal document extraction.
 *
 * Ported from desk-v1 `packages/documents` (Fantasmita LLC, internal reuse)
 * and adapted for Sendero's Vercel serverless + Vertex/Gemini stack.
 *
 * Public surface:
 *   - `extractDocument({ kind, data, mediaType })` — the single façade
 *   - `ALLOWED_OCR_MIME_TYPES` / `isAllowedOcrMimeType` / `MAX_OCR_BYTES` — channel guardrails
 *   - schemas + types — for callers who want to validate payloads first
 *   - `extractWithGemini` — low-level provider call for custom schemas
 *   - `normalizeInvoice` / `normalizeReceipt` — post-processing utilities
 */

export * from './extract';
export * from './normalize';
export { extractWithGemini } from './providers/gemini-multimodal';
export type { GeminiExtractArgs, GeminiExtractResult } from './providers/gemini-multimodal';
export * from './schemas';
