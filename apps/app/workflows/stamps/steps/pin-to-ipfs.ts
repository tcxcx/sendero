/**
 * Pinata pinning steps — image (PNG bytes) and manifest (JSON).
 *
 * Pinata's `upload.public.file` and `upload.public.json` are content-
 * addressed — re-uploading byte-identical content returns the same
 * CID without an extra pinned-file charge. That's the property the
 * workflow relies on for retry-safety: a re-run with the same
 * primaryKey re-uploads, gets the same CID, and proceeds to mint.
 *
 * Env: requires PINATA_JWT in the runtime. PINATA_GATEWAY is
 * optional — we don't need it for upload, only for fetching back
 * (the OG page uses the public ipfs.io gateway as a fallback).
 */

import { PinataSDK } from 'pinata';

import { env } from '@sendero/env';

import type { StampManifest } from '../shared/types';

function getPinata(): PinataSDK {
  const jwt = env.pinataJwt();
  if (!jwt) throw new Error('PINATA_JWT missing — cannot pin stamp art');
  return new PinataSDK({
    pinataJwt: jwt,
    pinataGateway: env.pinataGateway(),
  });
}

export const pinStampImageToIpfs = async (imageDataUrl: string): Promise<string> => {
  'use step';
  const pinata = getPinata();
  const res = await fetch(imageDataUrl);
  const blob = await res.blob();
  const file = new File([blob], 'stamp.png', { type: 'image/png' });
  const upload = await pinata.upload.public.file(file);
  return upload.cid;
};

export const pinStampManifestToIpfs = async (manifest: StampManifest): Promise<string> => {
  'use step';
  const pinata = getPinata();
  const upload = await pinata.upload.public.json(manifest as unknown as Record<string, unknown>);
  return upload.cid;
};
