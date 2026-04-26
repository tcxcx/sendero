/**
 * Wrap the existing `mint_stamp` tool inside a `'use step'` so the
 * WDK can checkpoint around the on-chain call. Goes straight through
 * the tool's idempotency guard — re-running the workflow with the
 * same primaryKey returns the cached tokenId + txHash without
 * re-minting on Arc.
 *
 * For TripPassport with multiple recipients, we mint the first
 * traveler with the auto-assign sentinel and then loop the rest
 * with `existingTokenId` to extend the same class id (same passport
 * NFT, multiple owners). One step per traveler so each gets its own
 * WDK retry envelope.
 */

import { mintStampTool } from '@sendero/tools/mint-stamp';

import type { StampContext } from '../shared/types';

export interface ExecMintResult {
  status: 'minted' | 'cached' | 'extended';
  stampId: string;
  tokenId: string;
  contract: string;
  txHash: string | null;
  txId: string | null;
}

/**
 * First-recipient mint. Uses auto-assign sentinel; persists the
 * canonical NftStamp row (tool-side).
 */
export const execMintFirst = async (args: {
  ctx: StampContext;
  uri: string;
  to: string;
  caption: string;
  blobUrl: string;
}): Promise<ExecMintResult> => {
  'use step';

  const result = await mintStampTool.handler({
    kind: args.ctx.kind,
    primaryKey: args.ctx.primaryKey,
    to: args.to,
    uri: args.uri,
    tenantSlug: args.ctx.tenant.slug,
    quantity: 1,
    tripId: args.ctx.trip.tripId,
    bookingId: args.ctx.booking?.bookingId,
    travelerId: args.ctx.travelers[0]?.userId,
    blobUrl: args.blobUrl,
    caption: args.caption,
    metadata: {
      brand: args.ctx.tenant.displayName,
      route:
        args.ctx.trip.origin && args.ctx.trip.destination
          ? `${args.ctx.trip.origin}→${args.ctx.trip.destination}`
          : null,
    },
  });

  return result;
};

/**
 * Group-passport extension. Adds one unit to an existing class id
 * for an additional traveler DCW. Skipped when only one traveler
 * exists on the trip.
 */
export const execMintExtend = async (args: {
  ctx: StampContext;
  to: string;
  existingTokenId: string;
}): Promise<ExecMintResult> => {
  'use step';

  return mintStampTool.handler({
    kind: args.ctx.kind,
    primaryKey: args.ctx.primaryKey,
    to: args.to,
    uri: '',
    tenantSlug: args.ctx.tenant.slug,
    quantity: 1,
    existingTokenId: args.existingTokenId,
  });
};
