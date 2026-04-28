/**
 * Generic stamp generator. The four kind-specific entrypoints
 * (`generate-boarding-pass.ts`, etc.) just wrap this with a fixed
 * `kind` so the WDK registry can list them as separate workflows
 * (each gets its own dashboard row + retry envelope).
 *
 * Sequence (locked by plan v3 §3.v3):
 *
 *   1. Load context (tenant brand, trip, booking, traveler DCWs).
 *   2. In parallel: generate image (Gemini 2.5 Flash Image) + caption (GPT-5-nano).
 *   3. Sequentially: upload PNG to Vercel Blob, pin PNG to IPFS, pin manifest to IPFS.
 *   4. Mint via mint_stamp tool (idempotent on (kind, primaryKey)).
 *   5. Mint extension steps for additional traveler DCWs (TripPassport).
 *   6. Persist manifest CID + caption back onto NftStamp.
 *
 * Failure modes: art/pin retries via WDK; mint failures bubble up
 * with the pinned manifest already persisted, so a re-run short-
 * circuits to mint without burning a fresh CID.
 *
 * The art lands on-chain as `ipfs://<manifestCid>` — no placeholder
 * URI, no second `setTokenURI` tx, one event for indexers.
 */

import { FatalError } from 'workflow';

import { loadStampContext } from './shared/load-context';
import {
  captionPromptForKind,
  imagePromptForKind,
  imageReferencesForKind,
  manifestNameForKind,
} from './shared/prompts';
import type { StampKind, StampManifest, StampWorkflowResult } from './shared/types';

import { generateStampCaption } from './steps/generate-caption';
import { generateStampImage } from './steps/generate-image';
import { execMintExtend, execMintFirst } from './steps/exec-mint';
import { persistStampMetadata } from './steps/persist-stamp-row';
import { pinStampImageToIpfs, pinStampManifestToIpfs } from './steps/pin-to-ipfs';
import { closeStampProgress, writeStampProgress } from './steps/stream-progress';

/**
 * Pinata gateway URL the OG unfurler / dashboard reads. We use the
 * public Pinata gateway by default (works for any unfurl bot) and let
 * `PINATA_GATEWAY` override to a paid sub-domain when latency matters.
 * Vercel Blob is intentionally NOT in this path — the Sendero Blob
 * store is private (signed-URL only), and the OG unfurl path needs
 * unauthenticated HTTPS. IPFS via Pinata gives us that for free.
 */
function pinataGatewayUrl(cid: string): string {
  const host = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud';
  return `https://${host}/ipfs/${cid}`;
}

export const generateStamp = async (args: {
  kind: StampKind;
  tripId: string;
  bookingId: string | null;
}): Promise<StampWorkflowResult> => {
  'use workflow';

  const ctx = await loadStampContext({
    kind: args.kind,
    tripId: args.tripId,
    bookingId: args.bookingId,
  });
  if (!ctx) {
    throw new FatalError(
      `Stamp context missing for ${args.kind} (tripId=${args.tripId}, bookingId=${args.bookingId})`
    );
  }
  if (ctx.travelers.length === 0) {
    throw new FatalError(
      `No traveler DCW for ${args.kind} on trip ${args.tripId} — did ensureTravelerWallet fail?`
    );
  }

  try {
    await writeStampProgress({ type: 'progress', step: 'generate-image', status: 'in_progress' });
    await writeStampProgress({ type: 'progress', step: 'generate-caption', status: 'in_progress' });

    // Resolve both prompts in parallel before kicking off the model
    // calls — getPromptWithFallback round-trips to Langfuse on cache
    // miss and we want both fetches overlapping with each other, not
    // serialized inside the generate steps.
    const [imagePrompt, captionPrompt] = await Promise.all([
      imagePromptForKind(ctx),
      captionPromptForKind(ctx),
    ]);
    const [imageDataUrl, caption] = await Promise.all([
      generateStampImage(imagePrompt, imageReferencesForKind(ctx)),
      generateStampCaption(captionPrompt),
    ]);

    await writeStampProgress({
      type: 'progress',
      step: 'generate-image',
      status: 'completed',
      image: imageDataUrl,
    });
    await writeStampProgress({
      type: 'progress',
      step: 'generate-caption',
      status: 'completed',
      caption,
    });

    await writeStampProgress({ type: 'progress', step: 'pin-image', status: 'in_progress' });
    const imageCid = await pinStampImageToIpfs(imageDataUrl);
    const gatewayUrl = pinataGatewayUrl(imageCid);
    await writeStampProgress({
      type: 'progress',
      step: 'pin-image',
      status: 'completed',
      imageCid,
    });
    await writeStampProgress({
      type: 'progress',
      step: 'gateway-url',
      status: 'completed',
      gatewayUrl,
    });

    const manifest: StampManifest = {
      name: manifestNameForKind(ctx),
      description: caption,
      image: `ipfs://${imageCid}`,
      image_https: gatewayUrl,
      external_url: `https://app.sendero.travel/stamps/${ctx.primaryKey}`,
      attributes: buildAttributes(ctx),
    };

    await writeStampProgress({ type: 'progress', step: 'pin-manifest', status: 'in_progress' });
    const manifestCid = await pinStampManifestToIpfs(manifest);
    const ipfsUri = `ipfs://${manifestCid}`;
    await writeStampProgress({
      type: 'progress',
      step: 'pin-manifest',
      status: 'completed',
      manifestCid,
    });

    // Mint to the first traveler with the auto-assign sentinel; the
    // tool returns the contract-assigned tokenId.
    await writeStampProgress({ type: 'progress', step: 'mint', status: 'in_progress' });
    const firstMint = await execMintFirst({
      ctx,
      uri: ipfsUri,
      to: ctx.travelers[0].address,
      caption,
      blobUrl: gatewayUrl,
    });

    // Group passport (or any future multi-recipient kind): extend the
    // class id to each additional traveler. One step per recipient so
    // each gets WDK retry isolation.
    if (ctx.travelers.length > 1) {
      for (const t of ctx.travelers.slice(1)) {
        await execMintExtend({ ctx, to: t.address, existingTokenId: firstMint.tokenId });
      }
    }

    await writeStampProgress({
      type: 'progress',
      step: 'mint',
      status: 'completed',
      tokenId: firstMint.tokenId,
      txHash: firstMint.txHash ?? undefined,
    });

    // Persist the manifest CID + caption (mint_stamp wrote the row
    // with the on-chain URI placeholder during pending → minted; this
    // updates the off-chain mirror to match).
    await persistStampMetadata({ ctx, blobUrl: gatewayUrl, manifestCid, caption });

    return {
      kind: ctx.kind,
      primaryKey: ctx.primaryKey,
      tokenId: firstMint.tokenId,
      contract: firstMint.contract,
      txHash: firstMint.txHash,
      gatewayUrl,
      ipfsUri,
      caption,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown stamp workflow error';
    try {
      await writeStampProgress({ type: 'error', message });
    } catch {
      // Stream may already be closed — swallow so the original error wins.
    }
    throw err;
  } finally {
    try {
      await closeStampProgress();
    } catch {
      // Idempotent close; ignore.
    }
  }
};

function buildAttributes(ctx: import('./shared/types').StampContext) {
  const attrs: Array<{ trait_type: string; value: string | number }> = [
    { trait_type: 'Kind', value: ctx.kind },
    { trait_type: 'Tenant', value: ctx.tenant.displayName },
  ];
  if (ctx.trip.origin) attrs.push({ trait_type: 'Origin', value: ctx.trip.origin });
  if (ctx.trip.destination) attrs.push({ trait_type: 'Destination', value: ctx.trip.destination });
  if (ctx.trip.startDate) attrs.push({ trait_type: 'Start', value: ctx.trip.startDate });
  if (ctx.trip.endDate) attrs.push({ trait_type: 'End', value: ctx.trip.endDate });
  if (ctx.booking?.carrier) attrs.push({ trait_type: 'Carrier', value: ctx.booking.carrier });
  if (ctx.booking?.cabin) attrs.push({ trait_type: 'Cabin', value: ctx.booking.cabin });
  if (ctx.booking?.ref) attrs.push({ trait_type: 'Reference', value: ctx.booking.ref });
  if (ctx.booking?.totalUsd) attrs.push({ trait_type: 'AmountUsd', value: ctx.booking.totalUsd });
  return attrs;
}
