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

import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { prisma } from '@sendero/database';

import { dispatchToTraveler } from '@/lib/channel-dispatch';

import type { StampContext } from '../shared/types';

// DEV-ONLY debug sink so notify-mint failures surface during dogfood
// without trawling the dev terminal (Ponder logs drown them). Same
// shape as the book_flight debug log; never runs in production.
function notifyDebug(label: string, payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV === 'production') return;
  try {
    const line = `${new Date().toISOString()} ${label} ${JSON.stringify(payload)}\n`;
    appendFileSync('/tmp/sendero-notify-mint.log', line);
  } catch {
    /* never block the workflow on a debug-sink error */
  }
}

const ARC_TX_EXPLORER = 'https://testnet.arcscan.app/tx';
const SOL_TX_EXPLORER = 'https://explorer.solana.com/tx';
const SOL_DEVNET_QS = '?cluster=devnet';

function buildExplorerLink(txHash: string, chain: 'arc' | 'sol'): { href: string; label: string } {
  if (chain === 'sol') {
    return {
      href: `${SOL_TX_EXPLORER}/${txHash}${SOL_DEVNET_QS}`,
      label: 'View on Solana Explorer',
    };
  }
  return { href: `${ARC_TX_EXPLORER}/${txHash}`, label: 'View on Arcscan' };
}

const TITLE_BY_KIND: Record<string, string> = {
  BoardingPass: 'Boarding pass NFT minted',
  SettlementReceipt: 'Settlement receipt NFT minted',
  ItineraryMap: 'Itinerary map NFT minted',
  TripPassport: 'Trip passport NFT minted',
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
    notifyDebug('[invoked]', {
      kind: args.ctx.kind,
      primaryKey: args.ctx.primaryKey,
      tokenId: args.tokenId,
      contract: args.contract,
      txHash: args.txHash,
      chain: args.ctx.chain,
      tenantId,
      hasTraveler: !!traveler,
      travelerUserId: traveler?.userId,
      travelerAddress: traveler?.address,
    });
    if (!traveler) {
      console.warn('[stamp-notify] no traveler in context', {
        kind: args.ctx.kind,
        primaryKey: args.ctx.primaryKey,
      });
      notifyDebug('[no-traveler]', { kind: args.ctx.kind, primaryKey: args.ctx.primaryKey });
      return;
    }

    const title = TITLE_BY_KIND[args.ctx.kind] ?? 'Sendero NFT minted';

    const stampRow = await prisma.nftStamp
      .findFirst({
        where: { kind: args.ctx.kind, primaryKey: args.ctx.primaryKey, tokenId: args.tokenId },
        select: { chain: true },
      })
      .catch(() => null);
    // Use the chain the mint ACTUALLY happened on (NftStamp.chain), not
    // the tenant's intended primaryChain. The prior OR fallback caused
    // broken explorer links: when a Sol-primaryChain tenant minted on
    // Arc (legacy default before the StampContext.chain plumbing),
    // tenant.primaryChain='sol' overrode the real Arc chain → users
    // got `https://explorer.solana.com/tx/0x<evm-hash>` (Sol URL +
    // EVM tx hash = always 404). Trust the row.
    const chain: 'arc' | 'sol' = stampRow?.chain === 'sol' ? 'sol' : 'arc';
    const explorerLink = args.txHash ? buildExplorerLink(args.txHash, chain) : null;

    const result = await dispatchToTraveler({
      tenantId,
      travelerUserId: traveler.userId,
      message: {
        kind: 'card',
        id: randomUUID(),
        author: { role: 'agent', name: 'Sendero' },
        title,
        // Body shows the token id + contract only; the explorer URL is
        // exposed ONLY via the CTA button below. Prior body included
        // \n${explorerLink.href}, which combined with the CTA rendered
        // the same URL twice per message on WhatsApp.
        body: `Token #${args.tokenId} · \`${shortAddr(args.contract)}\``,
        imageUrl: args.gatewayUrl,
        ...(explorerLink
          ? {
              ctas: [
                {
                  label: explorerLink.label,
                  kind: 'open_link',
                  href: explorerLink.href,
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
      notifyDebug('[dispatch-skipped]', {
        kind: args.ctx.kind,
        userId: traveler.userId,
        reason: result.reason,
        channel: result.channel,
        detail: (result as { detail?: unknown }).detail,
      });
    } else {
      notifyDebug('[dispatch-ok]', {
        kind: args.ctx.kind,
        userId: traveler.userId,
        channel: result.channel,
      });
    }
  } catch (err) {
    console.warn('[stamp-notify] send failed (non-fatal)', {
      kind: args.ctx.kind,
      primaryKey: args.ctx.primaryKey,
      error: err instanceof Error ? err.message : String(err),
    });
    notifyDebug('[threw]', {
      kind: args.ctx.kind,
      primaryKey: args.ctx.primaryKey,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
  }
};

function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
