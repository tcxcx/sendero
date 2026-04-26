/**
 * IdentityRegistry handler — backfill `agentId` on pending OnchainIdentity
 * rows when the on-chain Transfer event lands.
 *
 * Flow:
 *   1. `ensureOrgIdentity` / `ensureUserIdentity` insert a pending row +
 *      submit the on-chain `register` call via Circle DCW.
 *   2. The synchronous tool handler usually parses the Transfer event
 *      from the receipt and writes `agentId` itself — but if Circle
 *      returns slowly, the cron sweeper retries, or the network blip
 *      delays the receipt parse, the row stays pending.
 *   3. THIS handler is the catch-all: every Transfer to the holder
 *      address gets matched against any pending OnchainIdentity row
 *      and stamps `agentId` from the topic.
 *
 * Idempotent: if the row already has `agentId`, we no-op. Mints from
 * external wallets (anything not in our `holderAddress` index) are
 * ignored — this is just for our own provisioning catch-up, not a
 * registry crawler.
 */

import { prisma } from '@sendero/database';

import {
  IDENTITY_TOPICS,
  type CircleEventLog,
  type DispatchResult,
  topicToAddress,
  topicToBigInt,
} from '../topics';

export async function handleIdentityEvent(log: CircleEventLog): Promise<DispatchResult> {
  const sigHash = log.eventSignatureHash?.toLowerCase();
  if (sigHash !== IDENTITY_TOPICS.Transfer) {
    return { matched: false, reason: `identity_unhandled_signature_${sigHash}` };
  }
  if (!log.topics || log.topics.length < 4) {
    return { matched: false, reason: 'identity_transfer_malformed' };
  }

  const from = topicToAddress(log.topics[1]);
  const to = topicToAddress(log.topics[2]);
  const tokenId = topicToBigInt(log.topics[3]).toString();

  // Only mints (from == 0x0) backfill our pending rows. Transfers to
  // a different owner mean the agent NFT was sold/migrated; out of
  // scope for v1 since we don't model agent transfer.
  if (from !== '0x0000000000000000000000000000000000000000') {
    return { matched: false, reason: 'identity_transfer_not_mint' };
  }

  const pending = await prisma.onchainIdentity.findFirst({
    where: { holderAddress: to, status: 'pending', agentId: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!pending) {
    // Already minted by the synchronous parser, or mint to a wallet
    // we don't track — both are fine.
    return { matched: false, reason: 'identity_no_pending_row' };
  }

  await prisma.onchainIdentity.update({
    where: { id: pending.id },
    data: {
      agentId: tokenId,
      mintTxHash: log.txHash ?? pending.mintTxHash,
      mintedAt: pending.mintedAt ?? new Date(),
      status: 'minted',
      lastError: null,
    },
  });

  return { matched: true, kind: 'identity_minted' };
}
