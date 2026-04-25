/**
 * `request_validation` — kick off the ERC-8004 ValidationRegistry
 * request side. The owner of an agent NFT (or any wallet acting on
 * its behalf) asks a designated validator address to attest something
 * about it (KYC, KYB, suitability, etc.).
 *
 * The validator wallet completes the loop with `submit_validation_response`.
 *
 * Privileged. Sendero treasury or a tenant admin signs the request;
 * agents don't typically initiate this themselves.
 */

import { z } from 'zod';

import { computeValidationRequestHash, requestValidation } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const inputSchema = z.object({
  /** ERC-8004 agent id of the subject being validated. */
  subjectAgentId: z.string().regex(/^\d+$/),
  /** EVM address of the validator who will respond. */
  validatorAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** What to attest (e.g. "kyb_required", "kyc_passport_l2"). */
  tag: z.string().min(1).max(64),
  /** Optional URI carrying request context (PII, doc hashes, …). */
  requestUri: z.string().default(''),
  /** Wallet that signs the on-chain validationRequest call. */
  ownerWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Optional seed to disambiguate multiple requests for the same (agent, tag). */
  seed: z.string().optional(),
});

type Input = z.infer<typeof inputSchema>;

interface RequestValidationResult {
  ok: true;
  requestHash: string;
  txHash: string;
  txId: string;
  validationCheckId: string;
}

export const requestValidationTool: ToolDef<Input, RequestValidationResult> = {
  name: 'request_validation',
  description:
    'Open an ERC-8004 ValidationRegistry request asking a specific validator address to attest something (KYC, KYB, suitability) about an agent NFT. Returns the requestHash; pair with submit_validation_response.',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['subjectAgentId', 'validatorAddress', 'tag', 'ownerWalletAddress'],
    properties: {
      subjectAgentId: { type: 'string', pattern: '^\\d+$' },
      validatorAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      tag: { type: 'string', minLength: 1, maxLength: 64 },
      requestUri: { type: 'string' },
      ownerWalletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      seed: { type: 'string' },
    },
  },
  async handler(input) {
    const subject = await prisma.onchainIdentity.findFirst({
      where: { agentId: input.subjectAgentId },
      select: { id: true, agentId: true },
    });
    if (!subject) {
      throw new Error(`No OnchainIdentity for agentId ${input.subjectAgentId}`);
    }

    const requestHash = computeValidationRequestHash({
      agentId: BigInt(input.subjectAgentId),
      tag: input.tag,
      seed: input.seed,
    });

    const result = await requestValidation({
      ownerWalletAddress: input.ownerWalletAddress,
      validatorAddress: input.validatorAddress as `0x${string}`,
      agentId: BigInt(input.subjectAgentId),
      requestURI: input.requestUri,
      requestHash,
    });

    const row = await prisma.validationCheck.create({
      data: {
        subjectId: subject.id,
        validatorAddress: input.validatorAddress.toLowerCase(),
        requestUri: input.requestUri,
        requestHash,
        requestTxHash: result.txHash,
        tag: input.tag,
      },
    });

    return {
      ok: true,
      requestHash,
      txHash: result.txHash,
      txId: result.txId,
      validationCheckId: row.id,
    };
  },
};
