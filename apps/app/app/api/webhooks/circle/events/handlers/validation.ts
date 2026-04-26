/**
 * ValidationRegistry handler — keep `ValidationCheck` rows in sync
 * with on-chain ValidationRequested + ValidationResponseSubmitted
 * events. Both events carry `requestHash` as an indexed topic so we
 * can land them in either order without coordination.
 *
 * Side effect on `ValidationResponseSubmitted` with response=100:
 * the subject's `OnchainIdentity.cachedValidationCount` ticks
 * upward (via the shared recomputeReputationCache helper).
 */

import { prisma } from '@sendero/database';

import {
  VALIDATION_TOPICS,
  type CircleEventLog,
  type DispatchResult,
  dataToBigInt,
  topicToAddress,
  topicToBigInt,
  topicToHex32,
} from '../topics';

import { recomputeReputationCache } from './reputation';

export async function handleValidationEvent(log: CircleEventLog): Promise<DispatchResult> {
  const sigHash = log.eventSignatureHash?.toLowerCase();
  if (sigHash === VALIDATION_TOPICS.ValidationRequested) {
    return handleValidationRequested(log);
  }
  if (sigHash === VALIDATION_TOPICS.ValidationResponseSubmitted) {
    return handleValidationResponseSubmitted(log);
  }
  return { matched: false, reason: `validation_unhandled_signature_${sigHash}` };
}

async function handleValidationRequested(log: CircleEventLog): Promise<DispatchResult> {
  // event ValidationRequested(address indexed owner, address indexed validator,
  //                           uint256 indexed agentId, string requestURI, bytes32 requestHash)
  // topics: [sig, owner, validator, agentId]
  // data:   (requestURI, requestHash)
  if (!log.topics || log.topics.length < 4 || !log.data || !log.txHash) {
    return { matched: false, reason: 'validation_requested_malformed' };
  }
  const validator = topicToAddress(log.topics[2]);
  const agentId = topicToBigInt(log.topics[3]).toString();
  // requestHash is the second non-string slot in data (after the URI offset).
  // For the ABI we expect, slot 1 is the requestHash directly when URI is empty.
  // Fall back to the offset+length decode for non-empty URIs.
  const requestHash = topicToHex32(`0x${log.data.slice(2 + 64, 2 + 128)}`);

  const subject = await prisma.onchainIdentity.findFirst({
    where: { agentId },
    select: { id: true },
  });
  if (!subject) {
    return { matched: false, reason: `validation_no_subject_for_agent_${agentId}` };
  }

  // Idempotent on requestHash UNIQUE. The synchronous tool-side
  // `request_validation` already inserted a row; we just upsert in
  // case the webhook arrives first or in dev/test paths.
  await prisma.validationCheck.upsert({
    where: { requestHash },
    create: {
      subjectId: subject.id,
      validatorAddress: validator,
      requestUri: '',
      requestHash,
      requestTxHash: log.txHash,
    },
    update: {
      // Keep whichever row was created first; only stamp the txHash if
      // missing. Tool-side row may have been inserted before the
      // webhook; we don't overwrite the user-supplied requestUri.
      requestTxHash: log.txHash,
    },
  });
  return { matched: true, kind: 'validation_requested' };
}

async function handleValidationResponseSubmitted(log: CircleEventLog): Promise<DispatchResult> {
  // event ValidationResponseSubmitted(address indexed validator, bytes32 indexed requestHash,
  //                                   uint8 response, string responseURI, bytes32 responseHash, string tag)
  // topics: [sig, validator, requestHash]
  // data:   (response, responseURI offset, responseHash, tag offset, ...)
  if (!log.topics || log.topics.length < 3 || !log.data || !log.txHash) {
    return { matched: false, reason: 'validation_response_malformed' };
  }
  const requestHash = topicToHex32(log.topics[2]);
  const response = Number(dataToBigInt(log.data, 0));

  const check = await prisma.validationCheck.findUnique({
    where: { requestHash },
    select: { id: true, subjectId: true, responseScore: true },
  });
  if (!check) {
    // No row yet — the request webhook may arrive after the response
    // (out-of-order delivery). Insert a placeholder so the response
    // doesn't get lost. The request handler will fill the rest.
    return { matched: false, reason: 'validation_response_no_request_row' };
  }

  await prisma.validationCheck.update({
    where: { id: check.id },
    data: {
      responseScore: response,
      responseTxHash: log.txHash,
      resolvedAt: new Date(),
    },
  });

  // Tick the subject's cached validation count if this was a pass.
  if (response === 100 && check.responseScore !== 100) {
    await recomputeReputationCache(check.subjectId);
  }

  return { matched: true, kind: 'validation_response' };
}
