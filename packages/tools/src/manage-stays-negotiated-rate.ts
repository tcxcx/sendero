/**
 * manage_stays_negotiated_rate — corporate travel manager tool for
 * Duffel Stays negotiated rates (RACs). Single tool with `action`
 * discriminator so agents can create, update, or delete.
 *
 * https://duffel.com/docs/guides/stays-negotiated-rates
 */

import { z } from 'zod';

import {
  createStaysNegotiatedRate,
  deleteStaysNegotiatedRate,
  updateStaysNegotiatedRate,
} from '@sendero/duffel';

import type { ToolDef } from './types';

const inputSchema = z
  .object({
    action: z.enum(['create', 'update', 'delete']),
    negotiatedRateId: z.string().min(3).optional(),
    displayName: z.string().min(1).max(200).optional(),
    rateAccessCode: z.string().min(1).max(20).optional(),
    accommodationIds: z.array(z.string().min(3)).min(1).max(500).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.action === 'create') {
      for (const field of ['displayName', 'rateAccessCode', 'accommodationIds'] as const) {
        if (!input[field]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when action is create`,
          });
        }
      }
    }
    if ((input.action === 'update' || input.action === 'delete') && !input.negotiatedRateId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['negotiatedRateId'],
        message: 'negotiatedRateId is required when action is update or delete',
      });
    }
  });

export type ManageStaysNegotiatedRateInput = z.infer<typeof inputSchema>;

export interface ManageStaysNegotiatedRateResult {
  action: 'create' | 'update' | 'delete';
  id: string | null;
  displayName?: string;
  rateAccessCode?: string;
  accommodationIds?: string[];
  share: {
    title: string;
    body: string;
  };
}

export async function manageStaysNegotiatedRate(
  input: ManageStaysNegotiatedRateInput
): Promise<ManageStaysNegotiatedRateResult> {
  if (input.action === 'create') {
    const row = await createStaysNegotiatedRate({
      displayName: input.displayName!,
      rateAccessCode: input.rateAccessCode!,
      accommodationIds: input.accommodationIds!,
    });
    return {
      action: 'create',
      id: row.id,
      displayName: row.display_name,
      rateAccessCode: row.rate_access_code,
      accommodationIds: row.accommodation_ids,
      share: {
        title: `Negotiated rate created · ${row.display_name}`,
        body: `RAC ${row.rate_access_code} · ${row.accommodation_ids.length} properties`,
      },
    };
  }
  if (input.action === 'update') {
    const row = await updateStaysNegotiatedRate(input.negotiatedRateId!, {
      displayName: input.displayName,
      rateAccessCode: input.rateAccessCode,
      accommodationIds: input.accommodationIds,
    });
    return {
      action: 'update',
      id: row.id,
      displayName: row.display_name,
      rateAccessCode: row.rate_access_code,
      accommodationIds: row.accommodation_ids,
      share: {
        title: `Negotiated rate updated · ${row.display_name}`,
        body: `RAC ${row.rate_access_code} · ${row.accommodation_ids.length} properties`,
      },
    };
  }
  await deleteStaysNegotiatedRate(input.negotiatedRateId!);
  return {
    action: 'delete',
    id: input.negotiatedRateId!,
    share: {
      title: 'Negotiated rate deleted',
      body: `Removed ${input.negotiatedRateId}`,
    },
  };
}

export const manageStaysNegotiatedRateTool: ToolDef<
  ManageStaysNegotiatedRateInput,
  ManageStaysNegotiatedRateResult
> = {
  name: 'manage_stays_negotiated_rate',
  description:
    'Create, update, or delete a Duffel Stays negotiated rate (corporate RAC). Pass `action: create` with displayName + rateAccessCode + accommodationIds; `action: update` with negotiatedRateId + any field to patch; `action: delete` with negotiatedRateId.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['action'],
    properties: {
      action: { type: 'string', enum: ['create', 'update', 'delete'] },
      negotiatedRateId: {
        type: 'string',
        description: 'Required for update + delete (nre_…).',
      },
      displayName: { type: 'string' },
      rateAccessCode: { type: 'string' },
      accommodationIds: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 500,
      },
    },
  },
  handler: manageStaysNegotiatedRate,
};
