/**
 * mint_stamp — internal tool that mints a Sendero NFT stamp on Arc
 * via the SenderoStamps ERC-1155 contract (Circle SCP template).
 *
 * Two paths:
 *
 *   - **fresh class** (default) — pass tokenId as null. The contract
 *     auto-assigns the next sequential id; we parse the TokensMinted
 *     event to capture it. Persists a new NftStamp row keyed on
 *     `(kind, primaryKey)`.
 *   - **existing class** (group TripPassport second-and-onward
 *     recipients) — pass the tokenId we already minted in the first
 *     call. Contract adds `quantity` units to the existing supply
 *     and sends them to `to`. No NftStamp row created (the row from
 *     the first mint is the canonical record).
 *
 * Idempotency: before minting, we check `NftStamp.findUnique({ kind,
 * primaryKey })`. If a row exists with `status='minted'`, we skip the
 * on-chain call and return the cached tokenId + txHash. If a row
 * exists with `status='pending'`, we still skip — the workflow runner
 * retries idempotently and we don't want a duplicate on-chain mint.
 *
 * NEVER exposed to the LLM, MCP, or external API keys (`internal: true`
 * + privileged scope). Only the workflow runner + the WDK image-gen
 * workflows call this.
 */

import { z } from 'zod';

import { mintStamp, refreshStampUri, STAMP_NEW_TOKEN_ID } from '@sendero/arc/identity';
import { prisma, Prisma } from '@sendero/database';
import { env } from '@sendero/env';

import type { ToolDef } from './types';

const mintStampInput = z.object({
  /** Stamp kind. Maps to the StampKind enum in the workflow + manifest. */
  kind: z.enum([
    'BoardingPass',
    'SettlementReceipt',
    'ItineraryMap',
    'TripPassport',
    'StayCheckIn',
    'TripCompletion',
  ]),
  /**
   * Domain primary key — bookingId for BoardingPass / Receipt,
   * tripId for ItineraryMap / TripPassport. Used as the (kind,
   * primaryKey) idempotency anchor.
   */
  primaryKey: z.string().min(1),
  /** Recipient DCW address. */
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** IPFS metadata URI: `ipfs://<manifestCid>`. */
  uri: z.string().min(1),
  /** Tenant slug — copied to NftStamp.tenantSlug for off-chain fan-out. */
  tenantSlug: z.string().min(1),
  /** Quantity of units to mint to `to`. Default 1. */
  quantity: z.number().int().positive().default(1),
  /**
   * When set, skip the auto-assign sentinel and mint additional units
   * of this existing class id (group TripPassport: same passport class
   * to second-and-later traveler DCWs). Stored as decimal string to fit
   * uint256.
   */
  existingTokenId: z.string().optional(),
  /** Optional Sendero domain refs for back-relation. */
  tenantId: z.string().optional(),
  tripId: z.string().optional(),
  bookingId: z.string().optional(),
  travelerId: z.string().optional(),
  /** Hot-serve image URL (Vercel Blob). Mirrored on the manifest. */
  blobUrl: z.string().url().optional(),
  /** GPT-5-nano caption — used on the OG page + collection grid. */
  caption: z.string().optional(),
  /** Free-form metadata snapshot (brand colors, source meter events, etc). */
  metadata: z.record(z.unknown()).optional(),
});

interface MintStampResult {
  status: 'minted' | 'cached' | 'extended';
  stampId: string;
  tokenId: string;
  contract: string;
  txHash: string | null;
  txId: string | null;
}

export const mintStampTool: ToolDef<z.infer<typeof mintStampInput>, MintStampResult> = {
  name: 'mint_stamp',
  description:
    'Internal: mint a Sendero NFT stamp into the SenderoStamps ERC-1155 collection on Arc. Treasury wallet signs; gas sponsored by Circle Gas Station. Idempotent on (kind, primaryKey) — re-runs return the cached row. Pass `existingTokenId` to add quantity to an existing class id (group TripPassport second+ recipients).',
  internal: true,
  inputSchema: mintStampInput,
  jsonSchema: {
    type: 'object',
    required: ['kind', 'primaryKey', 'to', 'uri', 'tenantSlug'],
    properties: {
      kind: {
        type: 'string',
        enum: [
          'BoardingPass',
          'SettlementReceipt',
          'ItineraryMap',
          'TripPassport',
          'StayCheckIn',
          'TripCompletion',
        ],
      },
      primaryKey: { type: 'string' },
      to: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      uri: { type: 'string' },
      tenantSlug: { type: 'string' },
      quantity: { type: 'integer', minimum: 1, default: 1 },
      existingTokenId: { type: 'string' },
      tenantId: { type: 'string' },
      tripId: { type: 'string' },
      bookingId: { type: 'string' },
      travelerId: { type: 'string' },
      blobUrl: { type: 'string', format: 'uri' },
      caption: { type: 'string' },
      metadata: { type: 'object' },
    },
  },
  async handler(input) {
    const treasuryWalletId = env.circleTreasuryWalletId();
    const contractAddress = process.env.SENDERO_STAMPS_ADDRESS as `0x${string}` | undefined;
    if (!treasuryWalletId) throw new Error('CIRCLE_TREASURY_WALLET_ID is required');
    if (!contractAddress) throw new Error('SENDERO_STAMPS_ADDRESS is required');

    // ── Group passport second+ recipient: extend an existing class id ──
    if (input.existingTokenId) {
      const tokenIdBig = BigInt(input.existingTokenId);
      const result = await mintStamp({
        treasuryWalletId,
        contractAddress,
        to: input.to as `0x${string}`,
        tokenId: tokenIdBig,
        uri: '',
        amount: BigInt(input.quantity),
      });
      return {
        status: 'extended',
        stampId: '',
        tokenId: result.tokenId.toString(),
        contract: contractAddress,
        txHash: result.txHash,
        txId: result.txId,
      };
    }

    // ── Idempotency check before any on-chain work ──
    const existing = await prisma.nftStamp.findUnique({
      where: { kind_primaryKey: { kind: input.kind, primaryKey: input.primaryKey } },
    });
    if (existing && existing.status === 'minted') {
      return {
        status: 'cached',
        stampId: existing.id,
        tokenId: existing.tokenId,
        contract: existing.contract,
        txHash: existing.mintTxHash,
        txId: existing.mintTxId,
      };
    }
    // If a pending row exists, the prior run died mid-mint (or we were
    // killed between contract call and DB write). Continue — the
    // contract-side dedupe is the (kind, primaryKey)-mapped tokenId.
    // The previous mint may already be on chain; we'll re-mint and
    // overwrite with the latest tokenId. This is rare but safe: the
    // event monitor reconciles ownership later.

    // ── Insert pending row first, so a crash mid-mint can be reasoned about. ──
    const tenantId =
      input.tenantId ??
      (
        await prisma.tenant.findUnique({
          where: { slug: input.tenantSlug },
          select: { id: true },
        })
      )?.id;
    if (!tenantId) {
      throw new Error(`Cannot resolve tenantId for slug ${input.tenantSlug}`);
    }

    const pendingRow = await prisma.nftStamp.upsert({
      where: { kind_primaryKey: { kind: input.kind, primaryKey: input.primaryKey } },
      create: {
        tenantId,
        tripId: input.tripId,
        bookingId: input.bookingId,
        travelerId: input.travelerId,
        kind: input.kind,
        primaryKey: input.primaryKey,
        // tokenId placeholder until the contract assigns one. Use 'pending'
        // sentinel string so the (contract, tokenId) UNIQUE doesn't fire
        // for two concurrent pending rows on different (kind, primaryKey).
        // Replaced with the real assigned id below.
        tokenId: `pending:${input.kind}:${input.primaryKey}`,
        contract: contractAddress,
        tenantSlug: input.tenantSlug,
        uri: input.uri,
        blobUrl: input.blobUrl,
        caption: input.caption,
        metadata: (input.metadata ?? null) as Prisma.InputJsonValue | null,
        status: 'pending',
      },
      update: {
        tripId: input.tripId,
        bookingId: input.bookingId,
        travelerId: input.travelerId,
        uri: input.uri,
        blobUrl: input.blobUrl,
        caption: input.caption,
        metadata: (input.metadata ?? null) as Prisma.InputJsonValue | null,
        status: 'pending',
      },
    });

    // ── On-chain mint with the auto-assign sentinel. ──
    const result = await mintStamp({
      treasuryWalletId,
      contractAddress,
      to: input.to as `0x${string}`,
      tokenId: STAMP_NEW_TOKEN_ID,
      uri: input.uri,
      amount: BigInt(input.quantity),
    });

    // ── Persist the assigned tokenId + tx info. ──
    const minted = await prisma.nftStamp.update({
      where: { id: pendingRow.id },
      data: {
        tokenId: result.tokenId.toString(),
        mintTxHash: result.txHash,
        mintTxId: result.txId,
        status: 'minted',
        mintedAt: new Date(),
      },
    });

    return {
      status: 'minted',
      stampId: minted.id,
      tokenId: minted.tokenId,
      contract: minted.contract,
      txHash: minted.mintTxHash,
      txId: minted.mintTxId,
    };
  },
};

/**
 * refresh_stamp_uri — companion tool for the ItineraryMap kind. Updates
 * the on-chain tokenURI in place and the cached `uri` on NftStamp.
 * Internal + privileged.
 */
const refreshUriInput = z.object({
  kind: z.enum([
    'BoardingPass',
    'SettlementReceipt',
    'ItineraryMap',
    'TripPassport',
    'StayCheckIn',
    'TripCompletion',
  ]),
  primaryKey: z.string().min(1),
  newUri: z.string().min(1),
});

export const refreshStampUriTool: ToolDef<
  z.infer<typeof refreshUriInput>,
  { ok: true; tokenId: string; txHash: string }
> = {
  name: 'refresh_stamp_uri',
  description:
    'Internal: update the tokenURI of an existing Sendero NFT stamp (e.g. ItineraryMap as new flight legs are added). Treasury wallet signs; gas sponsored.',
  internal: true,
  inputSchema: refreshUriInput,
  jsonSchema: {
    type: 'object',
    required: ['kind', 'primaryKey', 'newUri'],
    properties: {
      kind: {
        type: 'string',
        enum: [
          'BoardingPass',
          'SettlementReceipt',
          'ItineraryMap',
          'TripPassport',
          'StayCheckIn',
          'TripCompletion',
        ],
      },
      primaryKey: { type: 'string' },
      newUri: { type: 'string' },
    },
  },
  async handler(input) {
    const treasuryWalletId = env.circleTreasuryWalletId();
    const contractAddress = process.env.SENDERO_STAMPS_ADDRESS as `0x${string}` | undefined;
    if (!treasuryWalletId) throw new Error('CIRCLE_TREASURY_WALLET_ID is required');
    if (!contractAddress) throw new Error('SENDERO_STAMPS_ADDRESS is required');

    const existing = await prisma.nftStamp.findUnique({
      where: { kind_primaryKey: { kind: input.kind, primaryKey: input.primaryKey } },
    });
    if (!existing) throw new Error(`No NftStamp for (${input.kind}, ${input.primaryKey})`);
    if (existing.status !== 'minted') {
      throw new Error(`Cannot refresh stamp in status=${existing.status}`);
    }

    const result = await refreshStampUri({
      treasuryWalletId,
      contractAddress,
      tokenId: BigInt(existing.tokenId),
      newUri: input.newUri,
    });

    await prisma.nftStamp.update({
      where: { id: existing.id },
      data: {
        uri: input.newUri,
        status: 'refreshed',
        mintTxHash: result.txHash,
        mintTxId: result.txId,
      },
    });

    return { ok: true as const, tokenId: existing.tokenId, txHash: result.txHash };
  },
};
