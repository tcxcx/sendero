/**
 * Final-step persistence: append the manifest CID + caption + blob URL
 * back onto the NftStamp row. mint_stamp already wrote `tokenId`,
 * `mintTxHash`, `mintTxId`, `status='minted'`, but the manifest CID
 * + caption are computed by the workflow (not the tool) and we want
 * them durable so the OG page can render even when the run is
 * garbage-collected.
 *
 * We update by `(kind, primaryKey)` so this is safe to retry — there's
 * exactly one row per stamp and the update is idempotent.
 */

import { prisma, type Prisma } from '@sendero/database';

import type { StampContext } from '../shared/types';

export const persistStampMetadata = async (args: {
  ctx: StampContext;
  blobUrl: string;
  manifestCid: string;
  caption: string;
}): Promise<void> => {
  'use step';

  // Phase 4.x: this Arc-side workflow updates the Arc-chain row.
  // The Solana counterpart (when Phase 4.x.y lands) will write its
  // own row with chain='sol' from a parallel workflow.
  await prisma.nftStamp.update({
    where: {
      kind_primaryKey_chain: { kind: args.ctx.kind, primaryKey: args.ctx.primaryKey, chain: 'arc' },
    },
    data: {
      blobUrl: args.blobUrl,
      caption: args.caption,
      uri: `ipfs://${args.manifestCid}`,
      metadata: {
        manifestCid: args.manifestCid,
        brand: args.ctx.tenant.displayName,
        route:
          args.ctx.trip.origin && args.ctx.trip.destination
            ? `${args.ctx.trip.origin}→${args.ctx.trip.destination}`
            : null,
      } as Prisma.InputJsonValue,
    },
  });
};
