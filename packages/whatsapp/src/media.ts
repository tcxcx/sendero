/**
 * MIME-type allowlist + helpers for inbound WhatsApp media.
 * Download is handled by WhatsAppClient.downloadMedia; this module only
 * governs policy (allowed types, max size, ordering).
 */

export const ALLOWED_IMAGE_MIME = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
] as const;

export const ALLOWED_DOCUMENT_MIME = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const ALLOWED_MIME = [...ALLOWED_IMAGE_MIME, ...ALLOWED_DOCUMENT_MIME];

export const MAX_MEDIA_BYTES = 20 * 1024 * 1024; // 20 MB (Meta hard cap)

export function isAllowedMimeType(mimeType: string): boolean {
  return (ALLOWED_MIME as readonly string[]).includes(mimeType.toLowerCase());
}

export function isSupportedMediaKind(kind: string): kind is 'image' | 'document' {
  return kind === 'image' || kind === 'document';
}

/** Best-effort file extension from MIME type. */
export function extensionForMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  return map[mimeType.toLowerCase()] ?? 'bin';
}
