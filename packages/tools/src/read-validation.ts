/**
 * `read_validation` — read the on-chain status of an ERC-8004
 * ValidationRegistry check. Public scope; any party can verify
 * whether a counterparty has passed (e.g.) KYB.
 *
 * Cache-first via `ValidationCheck`; chain RPC fallback for external
 * checks not in our index.
 */

import { z } from 'zod';

import { getValidationStatus } from '@sendero/arc/identity';
import { prisma } from '@sendero/database';

import type { ToolDef } from './types';

const inputSchema = z.object({
  requestHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

type Input = z.infer<typeof inputSchema>;

interface ReadValidationResult {
  requestHash: string;
  /** 100 passed, 0 failed, null pending. */
  response: number | null;
  validatorAddress: string | null;
  tag: string | null;
  resolvedAt: string | null;
  source: 'cache' | 'chain' | 'unknown';
}

export const readValidationTool: ToolDef<Input, ReadValidationResult> = {
  name: 'read_validation',
  description:
    'Read the verdict of an ERC-8004 ValidationRegistry check by its requestHash. Returns 100=passed, 0=failed, null=pending.',
  internal: false,
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['requestHash'],
    properties: {
      requestHash: { type: 'string', pattern: '^0x[a-fA-F0-9]{64}$' },
    },
  },
  async handler(input) {
    const cached = await prisma.validationCheck.findUnique({
      where: { requestHash: input.requestHash },
      select: {
        responseScore: true,
        validatorAddress: true,
        tag: true,
        resolvedAt: true,
      },
    });
    if (cached) {
      return {
        requestHash: input.requestHash,
        response: cached.responseScore,
        validatorAddress: cached.validatorAddress,
        tag: cached.tag,
        resolvedAt: cached.resolvedAt?.toISOString() ?? null,
        source: 'cache',
      };
    }

    const onchain = await getValidationStatus(input.requestHash as `0x${string}`);
    if (onchain) {
      return {
        requestHash: input.requestHash,
        response: onchain.response,
        validatorAddress: onchain.validatorAddress,
        tag: onchain.tag,
        resolvedAt: onchain.lastUpdate
          ? new Date(Number(onchain.lastUpdate) * 1000).toISOString()
          : null,
        source: 'chain',
      };
    }

    return {
      requestHash: input.requestHash,
      response: null,
      validatorAddress: null,
      tag: null,
      resolvedAt: null,
      source: 'unknown',
    };
  },
};
