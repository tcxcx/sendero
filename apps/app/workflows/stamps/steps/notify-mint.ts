/**
 * Post-mint traveler notify step. Runs at the tail of generateStamp
 * after persistStampMetadata, sends the IPFS-pinned NFT art to the
 * traveler's WhatsApp with a caption carrying the tokenId, contract,
 * and the on-chain mint tx hash.
 *
 * Mirrors `apps/app/lib/booking-boarding-pass.ts` — same auth path,
 * same WhatsApp install lookup, same fail-soft error handling. The
 * difference is the image source (Pinata IPFS gateway URL instead of
 * Satori PNG) and the caption (NFT-mint claim instead of trip recap).
 *
 * Fail-soft: a missing channel identity / disabled install / send
 * failure logs and returns. The mint already succeeded on-chain at
 * this point — the row is durable, the OG page renders, and the
 * traveler can still find the stamp via the dashboard.
 */

import { randomUUID } from 'node:crypto';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

import type { StampContext } from '../shared/types';

const ARC_TX_EXPLORER = 'https://testnet.arcscan.app/tx';

const TITLE_BY_KIND: Record<string, string> = {
  BoardingPass: '🎟 Boarding pass NFT minted',
  SettlementReceipt: '🧾 Settlement receipt NFT minted',
  ItineraryMap: '🗺 Itinerary map NFT minted',
  TripPassport: '🛂 Trip passport NFT minted',
};

export const notifyStampMint = async (args: {
  ctx: StampContext;
  tokenId: string;
  txHash: string | null;
  contract: string;
  gatewayUrl: string;
}): Promise<void> => {
  'use step';

  try {
    const tenantId = args.ctx.tenant.tenantId;
    const traveler = args.ctx.travelers[0];
    if (!traveler) {
      console.warn('[stamp-notify] no traveler in context', {
        kind: args.ctx.kind,
        primaryKey: args.ctx.primaryKey,
      });
      return;
    }

    const title = TITLE_BY_KIND[args.ctx.kind] ?? 'Sendero NFT minted';
    const txLink = args.txHash ? `${ARC_TX_EXPLORER}/${args.txHash}` : null;

    const result = await dispatchToTraveler({
      tenantId,
      travelerUserId: traveler.userId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title,
        body: `Token #${args.tokenId} · \`${shortAddr(args.contract)}\`${txLink ? `\n🔗 ${txLink}` : ''}`,
        imageUrl: args.gatewayUrl,
        ...(txLink
          ? {
              ctas: [
                {
                  label: 'View on Arcscan',
                  kind: 'open_link',
                  href: txLink,
                  emphasis: 'secondary',
                },
              ],
            }
          : {}),
        createdAt: new Date().toISOString(),
      },
    });
    if (result.sent === false) {
      console.warn('[stamp-notify] dispatch skipped', {
        kind: args.ctx.kind,
        userId: traveler.userId,
        reason: result.reason,
        channel: result.channel,
      });
    }
  } catch (err) {
    console.warn('[stamp-notify] send failed (non-fatal)', {
      kind: args.ctx.kind,
      primaryKey: args.ctx.primaryKey,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
