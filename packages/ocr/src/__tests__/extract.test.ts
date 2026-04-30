import { describe, expect, it } from 'bun:test';

import {
  ALLOWED_OCR_MIME_TYPES,
  MAX_OCR_BYTES,
  base64ByteSize,
  extractDocument,
  isAllowedOcrMimeType,
} from '../extract';

describe('mime + size gatekeeping', () => {
  it('accepts every allowlisted mime type', () => {
    for (const mime of ALLOWED_OCR_MIME_TYPES) {
      expect(isAllowedOcrMimeType(mime)).toBe(true);
    }
  });

  it('rejects non-document mime types', () => {
    expect(isAllowedOcrMimeType('application/zip')).toBe(false);
    expect(isAllowedOcrMimeType('text/html')).toBe(false);
    expect(isAllowedOcrMimeType('audio/mpeg')).toBe(false);
  });

  it('estimates base64 byte size within 3 bytes', () => {
    const raw = 'hello, world!';
    const b64 = Buffer.from(raw).toString('base64');
    const estimated = base64ByteSize(b64);
    expect(Math.abs(estimated - raw.length)).toBeLessThanOrEqual(3);
  });

  it('handles data: URI prefixes', () => {
    const b64 = Buffer.from('abc').toString('base64');
    expect(base64ByteSize(`data:image/png;base64,${b64}`)).toBeLessThanOrEqual(3);
  });

  it('throws for disallowed mime types', async () => {
    await expect(
      extractDocument({
        kind: 'invoice',
        data: Buffer.from('x').toString('base64'),
        mediaType: 'application/zip',
      })
    ).rejects.toThrow(/not allowed/);
  });

  it('throws when ID documents run without allowSensitive', async () => {
    await expect(
      extractDocument({
        kind: 'id_document',
        data: Buffer.from('x').toString('base64'),
        mediaType: 'image/png',
      })
    ).rejects.toThrow(/compliance-mode opt-in/);
  });

  it('throws when payload exceeds the size cap', async () => {
    const padding = 'A'.repeat(MAX_OCR_BYTES * 2); // base64 encoded is ~4/3 the raw byte size
    await expect(
      extractDocument({
        kind: 'invoice',
        data: padding,
        mediaType: 'application/pdf',
      })
    ).rejects.toThrow(/exceeds/);
  });
});
