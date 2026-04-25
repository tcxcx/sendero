/**
 * Upload the generated stamp PNG to Vercel Blob (public access). The
 * returned URL is the hot path for OG previews + dashboard cards —
 * IPFS gateways are too slow for a first paint.
 *
 * Path convention: `stamps/<kind>/<primaryKey>.png`. The pathname
 * doubles as the idempotency key inside Blob: re-running the workflow
 * with the same primaryKey overwrites the same object instead of
 * leaking duplicates.
 */

import { put } from '@vercel/blob';

import type { StampKind } from '../shared/types';

export const uploadStampToBlob = async (args: {
  imageDataUrl: string;
  kind: StampKind;
  primaryKey: string;
}): Promise<string> => {
  'use step';

  const blob = await dataUrlToBlob(args.imageDataUrl);
  const path = `stamps/${args.kind}/${args.primaryKey}.png`;

  const { url } = await put(path, blob, {
    access: 'public',
    contentType: 'image/png',
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  return url;
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}
