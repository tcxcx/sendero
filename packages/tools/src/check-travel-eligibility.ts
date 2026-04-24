/**
 * check_travel_eligibility — sanitized travel-document verdict for the agent.
 *
 * Reads the traveler's passport vault signals (plaintext columns only,
 * never ciphertext), checks the 6-month-validity rule against the
 * trip's departure + return dates, runs the visa-rules lookup, and
 * returns a TravelEligibilityVerdict of { status, reasons[], actions[] }
 * where every reason/action is an enum code — no PII, no free-form
 * prose, no names, no passport numbers, no dates of birth.
 *
 * The agent can reason about the verdict (and drive UI like "upload
 * your visa" or "renew your passport") without ever seeing the
 * underlying document.  The trip page decorates the verdict with
 * human-readable copy on the server side, joining against a
 * translation table the agent never touches.
 *
 * Contract:
 *   - tenantId + travelerUserId must resolve to a live vault entry,
 *     OR the verdict will be { status: 'block', reasons:[passport_missing] }.
 *   - Origin and destination are 3-letter ISO country codes — caller
 *     is responsible for converting airport IATA codes upstream.
 *   - If the traveler's nationality isn't stamped on the vault
 *     (nationalityIso3 is null), visa rules are skipped and we emit a
 *     `nationality_unknown` warn.
 */

import { prisma } from '@sendero/database';
import {
  readDeclaredTravelerSignals,
  readTenantDefaultNationality,
  readVaultSignals,
  type TravelEligibilityVerdict,
  verifyTravelDocuments,
} from '@sendero/vault';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

const inputSchema = z.object({
  travelerUserId: z
    .string()
    .describe('User.id of the traveler whose documents to verify (not clerkUserId).'),
  originIso3: z
    .string()
    .length(3)
    .describe('ISO 3166-1 alpha-3 origin country code (not airport IATA).'),
  destinationIso3: z.string().length(3).describe('ISO 3166-1 alpha-3 destination country code.'),
  departureDate: z.string().describe('ISO 8601 date (YYYY-MM-DD) of departure.'),
  returnDate: z
    .string()
    .nullable()
    .optional()
    .describe('ISO 8601 return date; null for one-way trips.'),
  purpose: z
    .enum(['business', 'leisure', 'transit', 'study', 'medical'])
    .describe('Trip purpose — feeds visa category selection.'),
});

type CheckTravelEligibilityInput = z.infer<typeof inputSchema>;

export const checkTravelEligibilityTool: ToolDef = {
  name: 'check_travel_eligibility',
  description:
    'Verify a traveler is eligible for an upcoming trip. Reads their passport from the encrypted vault (signals only, never PII), checks expiry + 6-month rule, runs visa-rules lookup, returns a pass/warn/block verdict with enum reason codes the UI renders into human copy. Safe for agents — no names, dates of birth, or passport numbers in the response.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['travelerUserId', 'originIso3', 'destinationIso3', 'departureDate', 'purpose'],
    properties: {
      travelerUserId: { type: 'string' },
      originIso3: { type: 'string', minLength: 3, maxLength: 3 },
      destinationIso3: { type: 'string', minLength: 3, maxLength: 3 },
      departureDate: { type: 'string' },
      returnDate: { type: 'string' },
      purpose: {
        type: 'string',
        enum: ['business', 'leisure', 'transit', 'study', 'medical'],
      },
    },
  },
  async handler(
    input: CheckTravelEligibilityInput,
    ctx?: ToolContext
  ): Promise<TravelEligibilityVerdict> {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) {
      throw new Error(
        'check_travel_eligibility requires traveler.tenantId in ToolContext — call is rejected.'
      );
    }

    const actorRef = ctx?.traveler?.userId ? `usr:${ctx.traveler.userId}` : 'svc:agent';

    // Pull all three tiers in parallel. verifyTravelDocuments picks the
    // highest-confidence one (vault > declared > tenant default) and
    // emits tier-aware reason codes so the UI can show "verified" vs
    // "self-declared" vs "tenant default" badges.
    const [passport, declared, tenantDefaultNationalityIso3] = await Promise.all([
      readVaultSignals(prisma, {
        tenantId,
        userId: input.travelerUserId,
        documentVariant: 'passport',
        actor: {
          actorRef,
          source: 'tool:check_travel_eligibility',
          context: {
            destinationIso3: input.destinationIso3,
            purpose: input.purpose,
          },
        },
      }),
      readDeclaredTravelerSignals(prisma, input.travelerUserId),
      readTenantDefaultNationality(prisma, tenantId),
    ]);

    const verdict = verifyTravelDocuments({
      passport,
      declared,
      tenantDefaultNationalityIso3,
      originIso3: input.originIso3,
      destinationIso3: input.destinationIso3,
      departureDate: input.departureDate,
      returnDate: input.returnDate ?? null,
      purpose: input.purpose,
    });

    return verdict;
  },
};
