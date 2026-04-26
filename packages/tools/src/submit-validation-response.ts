/**
 * `submit_validation_response` — validator-side reply to a previous
 * `request_validation`. The validator wallet (e.g. the dedicated
 * `kyb-validator` DCW for KYC/KYB attestations) signs
 * `validationResponse(requestHash, response, …)` on the
 * ValidationRegistry. `response = 100` means passed, `0` means failed.
 *
 * Privileged. Only validators who own the validation flow should sign.
 */

import { z } from 'zod';

import { submitValidationResponse } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';

import { resolveWalletUuidByAddress } from './resolve-wallet';
import type { ToolDef } from './types';

const inputSchema = z.object({
  /** Hash returned by request_validation. */
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  /** 100 = passed, 0 = failed. Anything else throws. */
  response: z.union([z.literal(100), z.literal(0)]),
  /** Mirror of the request's `tag` (e.g. "kyb_passed"). */
  tag: z.string().min(1).max(64),
  /** Validator wallet address — must match what request_validation specified. */
  validatorWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Optional response evidence URI. */
  responseUri: z.string().default(''),
});

type Input = z.infer<typeof inputSchema>;

interface SubmitValidationResult {
  ok: true;
  txHash: string;
  txId: string;
  response: 0 | 100;
  validationCheckId: string;
}

export const submitValidationResponseTool: ToolDef<Input, SubmitValidationResult> = {
  name: 'submit_validation_response',
  description:
    'Validator-side response to a pending ERC-8004 ValidationRegistry request. response=100 means passed, 0 means failed. Updates the off-chain ValidationCheck row.',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['requestHash', 'response', 'tag', 'validatorWalletAddress'],
    properties: {
      requestHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
      // Vertex AI's tool-declaration validator rejects non-string enum
      // values; AI Gateway is more lenient. Drop the enum constraint
      // and document the allowed integers in the description so the
      // schema works with both routing paths. Runtime validation still
      // happens via Zod (z.union([z.literal(100), z.literal(0)])).
      response: {
        type: 'integer',
        description: 'Validator verdict. 100 = passed, 0 = failed. No other values are accepted.',
      },
      tag: { type: 'string', minLength: 1, maxLength: 64 },
      validatorWalletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      responseUri: { type: 'string' },
    },
  },
  async handler(input) {
    const check = await prisma.validationCheck.findUnique({
      where: { requestHash: input.requestHash },
      select: { id: true },
    });
    if (!check) {
      throw new Error(`No ValidationCheck row for requestHash ${input.requestHash}`);
    }

    // Circle DCW signs by walletId UUID, not on-chain address.
    const validatorWalletUuid = await resolveWalletUuidByAddress(input.validatorWalletAddress);
    if (!validatorWalletUuid) {
      throw new Error(
        `No Circle wallet UUID for validatorWalletAddress ${input.validatorWalletAddress} — provision the wallet first.`
      );
    }

    const result = await submitValidationResponse({
      validatorWalletAddress: validatorWalletUuid,
      requestHash: input.requestHash as `0x${string}`,
      response: input.response,
      tag: input.tag,
      responseURI: input.responseUri,
    });

    await prisma.validationCheck.update({
      where: { id: check.id },
      data: {
        responseScore: input.response,
        responseTxHash: result.txHash,
        tag: input.tag,
        resolvedAt: new Date(),
      },
    });

    return {
      ok: true,
      txHash: result.txHash,
      txId: result.txId,
      response: input.response,
      validationCheckId: check.id,
    };
  },
};
