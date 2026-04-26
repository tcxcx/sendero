#!/usr/bin/env bun
/**
 * Track B8 — settlement reconciliation script.
 *
 * Safety net for the "DB writes failed but on-chain succeeded" failure
 * mode that B7's observer cannot recover from on its own (network glitch
 * during prisma write, indexer restart with a stale checkpoint, etc.).
 *
 * What it does:
 *   1. Reads `BookingSettledV2` + `BookingSettled` event logs from the
 *      escrow contract over a configurable block window.
 *   2. For each event, checks whether a `Settlement` row already exists
 *      in Postgres whose `txHashes` array contains the event's tx hash.
 *   3. For any event NOT yet recorded, calls
 *      `persistSettlementFromV{1,2}Event` from `@sendero/billing/settlement`
 *      to backfill the Settlement + SettlementLeg rows (or fire a
 *      SecurityAlert if the off-chain Booking is missing).
 *   4. Prints a summary `{ scanned, missing, recovered, orphans }`.
 *
 * Usage:
 *   bun run scripts/reconcile-settlement-from-events.ts
 *   bun run scripts/reconcile-settlement-from-events.ts --from-block=12345 --to-block=latest
 *   bun run scripts/reconcile-settlement-from-events.ts --escrow=0x… --chain=arc-testnet
 *
 * Env (defaults to arc-testnet via `@sendero/arc`):
 *   ARC_ESCROW_ADDRESS — escrow proxy
 *   SENDERO_RECONCILE_FROM_BLOCK — default starting block (arg overrides)
 *   SENDERO_RECONCILE_LOOKBACK_BLOCKS — how many blocks back to scan if no
 *     `from` is given. Defaults to 50_000 (~ a few days on Arc Testnet).
 *
 * Read-only against the chain; write-only against Postgres for missing
 * rows. Idempotent on the DB side (the `findExistingSettlement` guard
 * inside `@sendero/billing/settlement` short-circuits duplicates).
 */

import { getArcClient } from '@sendero/arc';
import {
  persistSettlementFromV1Event,
  persistSettlementFromV2Event,
  prismaSettlementStore,
} from '@sendero/billing/settlement';
import { SENDERO_GUEST_ESCROW_ABI } from '@sendero/guest';
import { parseAbiItem, type Address, type Hex } from 'viem';

interface Args {
  escrow: Address;
  chain: string;
  fromBlock: bigint | 'auto';
  toBlock: bigint | 'latest';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const flag = argv.find(a => a.startsWith(`--${name}=`));
    return flag ? flag.slice(name.length + 3) : undefined;
  };

  const escrow = (get('escrow') ?? process.env.ARC_ESCROW_ADDRESS) as Address | undefined;
  if (!escrow) {
    throw new Error('--escrow=0x… or ARC_ESCROW_ADDRESS env is required');
  }

  const chain = get('chain') ?? process.env.SENDERO_CHAIN_LABEL ?? 'arc-testnet';

  const fromArg = get('from-block');
  const toArg = get('to-block');
  return {
    escrow,
    chain,
    fromBlock: fromArg ? BigInt(fromArg) : 'auto',
    toBlock: toArg && toArg !== 'latest' ? BigInt(toArg) : 'latest',
  };
}

async function main() {
  const args = parseArgs();
  const client = getArcClient();
  const store = prismaSettlementStore();

  const head = await client.getBlockNumber();
  const lookback = BigInt(process.env.SENDERO_RECONCILE_LOOKBACK_BLOCKS ?? 50_000);
  const fallbackFrom = process.env.SENDERO_RECONCILE_FROM_BLOCK
    ? BigInt(process.env.SENDERO_RECONCILE_FROM_BLOCK)
    : head > lookback
      ? head - lookback
      : 0n;
  const fromBlock = args.fromBlock === 'auto' ? fallbackFrom : args.fromBlock;
  const toBlock = args.toBlock === 'latest' ? head : args.toBlock;

  console.log(
    `[reconcile] escrow=${args.escrow} chain=${args.chain} blocks=${fromBlock}..${toBlock}`
  );

  // Pull both V2 + V1 logs in one round-trip per kind. We use viem's
  // `getLogs` rather than `getContractEvents` so the call stays readable
  // when the ABI grows.
  const v2Event = parseAbiItem(
    'event BookingSettledV2(bytes32 indexed bookingId, address vendor, uint256 vendorAmount, address agencyAddress, uint256 agencyAmount, uint256 feeAmount)'
  );
  const v1Event = parseAbiItem(
    'event BookingSettled(bytes32 indexed bookingId, address vendor, uint256 vendorAmount, uint256 feeAmount)'
  );

  // Sanity — make sure the parsed events match the actual ABI shape.
  // This catches drift between this script and `@sendero/guest` if the
  // event signature changes upstream.
  const abiNames = SENDERO_GUEST_ESCROW_ABI.filter(item => item.type === 'event').map(
    item => (item as { name: string }).name
  );
  if (!abiNames.includes('BookingSettledV2') || !abiNames.includes('BookingSettled')) {
    throw new Error(`Escrow ABI is missing expected events. Found: ${abiNames.join(', ')}`);
  }

  const [v2Logs, v1Logs] = await Promise.all([
    client.getLogs({
      address: args.escrow,
      event: v2Event,
      fromBlock,
      toBlock,
    }),
    client.getLogs({
      address: args.escrow,
      event: v1Event,
      fromBlock,
      toBlock,
    }),
  ]);

  console.log(`[reconcile] scanned ${v2Logs.length} V2 + ${v1Logs.length} V1 events`);

  let scanned = 0;
  let missing = 0;
  let recovered = 0;
  let orphans = 0;

  for (const log of v2Logs) {
    scanned++;
    const ev = log.args as {
      bookingId?: Hex;
      vendor?: Address;
      vendorAmount?: bigint;
      agencyAddress?: Address;
      agencyAmount?: bigint;
      feeAmount?: bigint;
    };
    if (
      !ev.bookingId ||
      !ev.vendor ||
      ev.vendorAmount == null ||
      !ev.agencyAddress ||
      ev.agencyAmount == null ||
      ev.feeAmount == null ||
      !log.transactionHash
    ) {
      console.warn(`[reconcile] V2 event skipped — missing fields, blockNumber=${log.blockNumber}`);
      continue;
    }
    const result = await persistSettlementFromV2Event({
      store,
      event: {
        bookingId: ev.bookingId,
        vendor: ev.vendor,
        vendorAmount: ev.vendorAmount,
        agencyAddress: ev.agencyAddress,
        agencyAmount: ev.agencyAmount,
        feeAmount: ev.feeAmount,
      },
      txHash: log.transactionHash,
      blockNumber: log.blockNumber ?? 0n,
      chain: args.chain,
    });
    if (result.alreadyExisted) continue;
    if (result.orphan) {
      orphans++;
      missing++;
      continue;
    }
    recovered++;
    missing++;
  }

  for (const log of v1Logs) {
    scanned++;
    const ev = log.args as {
      bookingId?: Hex;
      vendor?: Address;
      vendorAmount?: bigint;
      feeAmount?: bigint;
    };
    if (
      !ev.bookingId ||
      !ev.vendor ||
      ev.vendorAmount == null ||
      ev.feeAmount == null ||
      !log.transactionHash
    ) {
      console.warn(`[reconcile] V1 event skipped — missing fields, blockNumber=${log.blockNumber}`);
      continue;
    }
    const result = await persistSettlementFromV1Event({
      store,
      event: {
        bookingId: ev.bookingId,
        vendor: ev.vendor,
        vendorAmount: ev.vendorAmount,
        feeAmount: ev.feeAmount,
      },
      txHash: log.transactionHash,
      blockNumber: log.blockNumber ?? 0n,
      chain: args.chain,
    });
    if (result.alreadyExisted) continue;
    if (result.orphan) {
      orphans++;
      missing++;
      continue;
    }
    recovered++;
    missing++;
  }

  const summary = { scanned, missing, recovered, orphans };
  console.log('[reconcile] summary', summary);
  return summary;
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[reconcile] failed', err);
    process.exit(1);
  });
