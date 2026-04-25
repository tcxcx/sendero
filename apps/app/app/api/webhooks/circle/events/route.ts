/**
 * POST /api/webhooks/circle/events
 *
 * Receives Circle Smart Contract Platform Event Monitor notifications
 * for the SenderoStamps ERC-1155 contract on Arc-Testnet. Persists
 * mints + transfers to NftStamp + NftStampOwnership so the front-end
 * can read ownership without polling the chain.
 *
 * Sibling route to /api/webhooks/circle (wallet balance sync). Both
 * routes verify Circle's signature the same way (shared helpers in
 * @/lib/circle-webhook-verify) but handle different notificationTypes:
 *
 *   /api/webhooks/circle         → wallets.* + transactions.* + modularWallet.*
 *   /api/webhooks/circle/events  → contracts.eventLog (this file)
 *
 * Event signatures we monitor (registered via
 * scripts/register-stamps-event-monitor.ts):
 *
 *   TokensMinted(address,uint256,string,uint256)
 *     -> upserts NftStamp row by tokenId, fills uri + mint context
 *   TransferSingle(address,address,address,uint256,uint256)
 *     -> updates NftStampOwnership balance for from / to
 *   TransferBatch(address,address,address,uint256[],uint256[])
 *     -> same as TransferSingle, multi-id
 *   URI(string,uint256)
 *     -> updates NftStamp.uri (ItineraryMap refresh)
 *
 * Idempotency goes through processDurableWebhook keyed on
 * notificationId, matching every other Sendero inbound webhook.
 */

import { type NextRequest, NextResponse } from 'next/server';

import { prisma } from '@sendero/database';
import { processDurableWebhook } from '@sendero/webhooks/inbound';

import { gateCircleWebhook } from '@/lib/circle-webhook-verify';
import { webhookEventStore } from '@/lib/webhook-events';

import { handleIdentityEvent } from './handlers/identity';
import { handleReputationEvent } from './handlers/reputation';
import { handleValidationEvent } from './handlers/validation';
import { classifyContract } from './topics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HANDLED_TYPES = new Set(['contracts.eventLog']);

// keccak256(eventSignature) — precomputed, matches what Circle sends in
// `notification.eventSignatureHash` so we can route without re-hashing.
const TOPIC = {
  TransferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  TransferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
  URI: '0x6bb7ff708619ba0610cba295a58592e0451dee2622938c8755667688daf3529b',
  TokensMinted: '0xee8d985f29b696f8a07cc34cdd09c1a4a3b9d5cad99d7c66f4b1cf1a91e5b4d6',
} as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

interface EventLogNotification {
  contractAddress?: string;
  blockchain?: string;
  txHash?: string;
  blockHash?: string;
  blockHeight?: number;
  eventSignature?: string;
  eventSignatureHash?: string;
  topics?: string[];
  data?: string;
  firstConfirmDate?: string;
}

interface DispatchResult {
  matched: boolean;
  // String, not narrow enum: per-handler modules (identity, reputation,
  // validation) emit their own kind labels; widening here keeps the
  // dispatch return type uniform without leaking into the response body.
  kind?: string;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const gate = await gateCircleWebhook<EventLogNotification>({
    rawBody: raw,
    signatureHeader: req.headers.get('x-circle-signature'),
    keyIdHeader: req.headers.get('x-circle-key-id'),
    handledTypes: HANDLED_TYPES,
  });

  if (gate.ok === false) {
    return NextResponse.json(gate.body, { status: gate.status });
  }
  if (gate.ok === 'test') {
    return NextResponse.json({ ok: true, test: true });
  }
  if (gate.ok === 'ignored') {
    return NextResponse.json({ ok: true, ignored: gate.type });
  }

  const event = gate.event;
  const externalId = event.notificationId ?? `${event.notificationType}:${event.timestamp ?? ''}`;

  const result = await processDurableWebhook({
    provider: 'circle-events',
    externalId,
    eventType: event.notificationType ?? 'contracts.eventLog',
    payload: event,
    event,
    store: webhookEventStore,
    dispatch: async parsed => dispatchEventLog(parsed.notification ?? {}),
    acceptedError: dispatchResult =>
      dispatchResult.matched ? null : (dispatchResult.reason ?? 'unmatched'),
    logger: console,
    logPrefix: '[webhooks/circle/events]',
  });

  if (result.ok === false) {
    return NextResponse.json({ error: 'dispatch_failed', message: result.error }, { status: 500 });
  }
  if (result.deduped === true) {
    return NextResponse.json({ ok: true, deduped: true });
  }
  if (result.deduped === false && result.acceptedError) {
    return NextResponse.json({ ok: true, matched: false, reason: result.acceptedError });
  }
  return NextResponse.json({ ok: true });
}

async function dispatchEventLog(log: EventLogNotification): Promise<DispatchResult> {
  const sigHash = log.eventSignatureHash?.toLowerCase();
  const contractAddress = log.contractAddress?.toLowerCase();
  if (!sigHash || !contractAddress) {
    return { matched: false, reason: 'missing_signature_or_address' };
  }

  // Route by contract address: stamps stay in this file (legacy
  // shape, in-line handlers below). Identity / reputation / validation
  // contracts dispatch to per-module handlers under ./handlers/*.
  const classification = classifyContract(contractAddress);
  switch (classification.kind) {
    case 'identity':
      return handleIdentityEvent(log);
    case 'reputation':
      return handleReputationEvent(log);
    case 'validation':
      return handleValidationEvent(log);
    case 'unknown':
      return { matched: false, reason: 'other_contract' };
    case 'stamps':
      // fall through to the local stamp-event switch
      break;
  }

  switch (sigHash) {
    case TOPIC.TokensMinted:
      return handleTokensMinted(log);
    case TOPIC.TransferSingle:
      return handleTransferSingle(log);
    case TOPIC.TransferBatch:
      return handleTransferBatch(log);
    case TOPIC.URI:
      return handleUri(log);
    default:
      return { matched: false, reason: `unhandled_signature_${sigHash}` };
  }
}

// ── Decoders ─────────────────────────────────────────────────────────
//
// Circle delivers `topics` and `data` as raw hex (the same shape
// eth_getLogs would return). We decode minimally — no viem dependency
// because this route runs in nodejs-runtime serverless and we want the
// cold-start tiny.

function topicToAddress(topic: string): string {
  // 32-byte topic, address right-padded — take last 40 hex chars.
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function topicToBigInt(topic: string): bigint {
  return BigInt(topic);
}

function dataToBigInt(data: string, slot: number): bigint {
  // `data` is 0x + hex; each slot is 64 hex chars (32 bytes).
  const start = 2 + slot * 64;
  const slice = data.slice(start, start + 64);
  return BigInt(`0x${slice}`);
}

function dataToString(data: string, lenSlot: number): string {
  // ABI-encoded string: offset slot points to (length, then UTF-8 bytes).
  // For a single string in the data section this is straightforward.
  const lenHex = data.slice(2 + lenSlot * 64, 2 + lenSlot * 64 + 64);
  const len = Number(BigInt(`0x${lenHex}`));
  const start = 2 + (lenSlot + 1) * 64;
  const bytesHex = data.slice(start, start + len * 2);
  return Buffer.from(bytesHex, 'hex').toString('utf8');
}

// ── Handlers ─────────────────────────────────────────────────────────

async function handleTokensMinted(log: EventLogNotification): Promise<DispatchResult> {
  // event TokensMinted(address indexed mintedTo, uint256 indexed tokenIdMinted, string uri, uint256 quantityMinted)
  //   topics: [sig, mintedTo, tokenIdMinted]
  //   data: (uri, quantityMinted) — string is dynamic so it's at offset 0x40
  if (!log.topics || log.topics.length < 3 || !log.data) {
    return { matched: false, reason: 'tokens_minted_malformed' };
  }
  const tokenId = topicToBigInt(log.topics[2]).toString();
  const contract = log.contractAddress!;

  // Find by (contract, tokenId) — we may have a pending row from
  // mint_stamp.handler that needs the on-chain confirmation.
  const stamp = await prisma.nftStamp.findUnique({
    where: { contract_tokenId: { contract, tokenId } },
  });
  if (!stamp) {
    // Direct on-chain mint with no Sendero side row — log + skip.
    // (Could also happen if mint_stamp ran but we failed to persist
    // the assigned tokenId; reconciler can backfill later.)
    return { matched: false, reason: `no_stamp_for_token_${tokenId}` };
  }

  await prisma.nftStamp.update({
    where: { id: stamp.id },
    data: {
      status: stamp.status === 'pending' ? 'minted' : stamp.status,
      mintedAt: stamp.mintedAt ?? new Date(),
      mintTxHash: stamp.mintTxHash ?? log.txHash ?? null,
    },
  });
  return { matched: true, kind: 'minted' };
}

async function handleTransferSingle(log: EventLogNotification): Promise<DispatchResult> {
  // event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
  //   topics: [sig, operator, from, to]
  //   data:   (id, value)
  if (!log.topics || log.topics.length < 4 || !log.data) {
    return { matched: false, reason: 'transfer_single_malformed' };
  }
  const from = topicToAddress(log.topics[2]);
  const to = topicToAddress(log.topics[3]);
  const tokenId = dataToBigInt(log.data, 0).toString();
  const value = dataToBigInt(log.data, 1);
  await applyOwnershipDelta({
    contract: log.contractAddress!,
    tokenId,
    from,
    to,
    value,
    txHash: log.txHash,
    blockHeight: log.blockHeight,
  });
  return { matched: true, kind: 'transfer' };
}

async function handleTransferBatch(log: EventLogNotification): Promise<DispatchResult> {
  // event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
  //   topics: [sig, operator, from, to]
  //   data:   (ids[], values[]) — both dynamic; offsets first
  if (!log.topics || log.topics.length < 4 || !log.data) {
    return { matched: false, reason: 'transfer_batch_malformed' };
  }
  const from = topicToAddress(log.topics[2]);
  const to = topicToAddress(log.topics[3]);

  // Decode ids[] + values[] from data. Layout:
  //   slot 0: offset of ids[] (usually 0x40)
  //   slot 1: offset of values[]
  //   then: <length><items...> for each
  const idsOffset = Number(dataToBigInt(log.data, 0)) / 32;
  const valuesOffset = Number(dataToBigInt(log.data, 1)) / 32;
  const idsLen = Number(dataToBigInt(log.data, idsOffset));
  const valuesLen = Number(dataToBigInt(log.data, valuesOffset));
  if (idsLen !== valuesLen) {
    return { matched: false, reason: 'transfer_batch_length_mismatch' };
  }

  for (let i = 0; i < idsLen; i++) {
    const tokenId = dataToBigInt(log.data, idsOffset + 1 + i).toString();
    const value = dataToBigInt(log.data, valuesOffset + 1 + i);
    await applyOwnershipDelta({
      contract: log.contractAddress!,
      tokenId,
      from,
      to,
      value,
      txHash: log.txHash,
      blockHeight: log.blockHeight,
    });
  }
  return { matched: true, kind: 'transfer' };
}

async function handleUri(log: EventLogNotification): Promise<DispatchResult> {
  // event URI(string value, uint256 indexed id)
  //   topics: [sig, id]
  //   data:   (value)
  if (!log.topics || log.topics.length < 2 || !log.data) {
    return { matched: false, reason: 'uri_malformed' };
  }
  const tokenId = topicToBigInt(log.topics[1]).toString();
  const newUri = dataToString(log.data, 0);
  const contract = log.contractAddress!;
  const stamp = await prisma.nftStamp.findUnique({
    where: { contract_tokenId: { contract, tokenId } },
  });
  if (!stamp) {
    return { matched: false, reason: `no_stamp_for_token_${tokenId}` };
  }
  await prisma.nftStamp.update({
    where: { id: stamp.id },
    data: { uri: newUri, status: 'refreshed' },
  });
  return { matched: true, kind: 'uri' };
}

// ── Ownership rollup ─────────────────────────────────────────────────

async function applyOwnershipDelta(args: {
  contract: string;
  tokenId: string;
  from: string;
  to: string;
  value: bigint;
  txHash?: string;
  blockHeight?: number;
}): Promise<void> {
  const stamp = await prisma.nftStamp.findUnique({
    where: { contract_tokenId: { contract: args.contract, tokenId: args.tokenId } },
    select: { id: true },
  });
  if (!stamp) return; // unknown token — skip the rollup

  // Decrement from-side (skip if mint, from == 0x0).
  if (args.from !== ZERO_ADDRESS) {
    const fromOwnership = await prisma.nftStampOwnership.findUnique({
      where: { stampId_ownerAddress: { stampId: stamp.id, ownerAddress: args.from } },
    });
    if (fromOwnership) {
      const next = fromOwnership.balance - args.value;
      await prisma.nftStampOwnership.update({
        where: { id: fromOwnership.id },
        data: {
          balance: next < 0n ? 0n : next,
          lastTxHash: args.txHash ?? fromOwnership.lastTxHash,
          lastBlock: args.blockHeight ? BigInt(args.blockHeight) : fromOwnership.lastBlock,
        },
      });
    }
  }

  // Increment to-side (skip if burn, to == 0x0).
  if (args.to !== ZERO_ADDRESS) {
    // Resolve owner User if the address matches a known DCW.
    const userId = await resolveUserIdForAddress(args.to);
    await prisma.nftStampOwnership.upsert({
      where: { stampId_ownerAddress: { stampId: stamp.id, ownerAddress: args.to } },
      create: {
        stampId: stamp.id,
        ownerAddress: args.to,
        ownerUserId: userId,
        balance: args.value,
        lastTxHash: args.txHash,
        lastBlock: args.blockHeight ? BigInt(args.blockHeight) : null,
      },
      update: {
        balance: { increment: args.value },
        ownerUserId: userId ?? undefined,
        lastTxHash: args.txHash,
        lastBlock: args.blockHeight ? BigInt(args.blockHeight) : null,
      },
    });
  }
}

async function resolveUserIdForAddress(address: string): Promise<string | null> {
  const wallet = await prisma.circleWallet.findFirst({
    where: { address: address.toLowerCase() },
    select: { tenantId: true },
  });
  // CircleWallet has tenantId, not userId, in this schema. The user
  // mapping comes via Membership for the tenant. For v1 we leave
  // userId null when address is a tenant treasury and only fill it
  // when we wire a per-user wallet table. The collection page can
  // still query by ownerAddress.
  return wallet ? null : null;
}
