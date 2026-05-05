/**
 * set_home_iata — persist the traveler's home airport on `User.homeIata`.
 *
 * Phase B.2 companion to `take_me_home`. When the traveler says
 * "take me home" without a home on file, the agent asks once and
 * calls this to persist. Subsequent "take me home" intents resolve
 * directly without re-asking.
 *
 * Validates the input is a 3-letter IATA-ish code. Doesn't verify
 * against Duffel's airport directory — accepts whatever the
 * traveler provides; if it's invalid, the next `take_me_home` call
 * will surface "no_offers" and the agent prompts again.
 */

import { z } from 'zod';

import { prisma } from '@sendero/database';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z
  .object({
    homeIata: z
      .string()
      .min(3)
      .max(3)
      .regex(/^[A-Za-z]{3}$/, 'IATA must be 3 letters (e.g. EZE, MEX, JFK).'),
  })
  .strict();

export type SetHomeIataInput = z.infer<typeof inputSchema>;

export interface SetHomeIataResult {
  status: 'ok' | 'no_traveler';
  homeIata?: string;
  message?: string;
}

export async function setHomeIata(
  input: SetHomeIataInput,
  ctx?: ToolContext
): Promise<SetHomeIataResult> {
  const userId = ctx?.traveler?.userId;
  if (!userId || userId.startsWith('svc:')) {
    return {
      status: 'no_traveler',
      message:
        'Pass `travelerPhone` on `call_sendero` so I know whose home to update.',
    };
  }

  const homeIata = input.homeIata.toUpperCase();
  await prisma.user.update({
    where: { id: userId },
    data: { homeIata },
  });

  return {
    status: 'ok',
    homeIata,
    message: `Home airport saved: ${homeIata}. I'll fly you back here whenever you say the word.`,
  };
}

export const setHomeIataTool: ToolDef<SetHomeIataInput, SetHomeIataResult> = {
  name: 'set_home_iata',
  description:
    "Save the traveler's home airport (3-letter IATA) on their User row. Call this when the traveler answers a 'where's home?' prompt — typically right after `take_me_home` returned `home_required`. After saving, immediately re-call `take_me_home` to resolve the cheapest return flight from the user's current location.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['homeIata'],
    properties: {
      homeIata: {
        type: 'string',
        minLength: 3,
        maxLength: 3,
        description:
          "3-letter IATA airport code, e.g. 'EZE', 'MEX', 'JFK', 'LHR'. Validated as 3 ASCII letters.",
      },
    },
  },
  async handler(input, ctx) {
    return setHomeIata(input, ctx);
  },
};
