/**
 * check_visa_requirements — Phase D conversational visa lookup.
 *
 * Pure helper around `@sendero/vault` `lookupVisaStatus`. The agent
 * calls this when the traveler asks "do I need a visa for X?" — the
 * tool responds with a structured status + a friendly explanation +
 * an apply-URL when applicable. **Never blocks a booking.** When
 * `book_flight` needs a hard policy decision it calls
 * `verifyTravelDocuments` (which uses the same lookup but layers
 * presence + expiry rules on top). This tool is just for chat.
 *
 * Returns `unknown` when the corridor isn't in the curated table —
 * the agent surfaces a friendly "I'm not 100% sure for this corridor;
 * here's the embassy / consulate page" rather than guessing.
 */

import { z } from 'zod';

import { lookupVisaStatus, type VisaStatus } from '@sendero/vault';

import type { ToolDef } from './types';

const inputSchema = z.object({
  nationalityIso3: z
    .string()
    .length(3)
    .describe(
      "Traveler's nationality as ISO 3166-1 alpha-3 (e.g. ARG, USA, GBR). Read from the traveler's PassportVault when available; otherwise ask the traveler."
    ),
  destinationIso3: z
    .string()
    .length(3)
    .describe('Destination country as ISO 3166-1 alpha-3 (e.g. USA, JPN, CHN).'),
});

type CheckVisaInput = z.infer<typeof inputSchema>;

interface VisaProgramHint {
  programName: string;
  applyUrl: string;
  leadTimeDays: number;
}

const PROGRAM_BY_STATUS: Record<VisaStatus, Record<string, VisaProgramHint>> = {
  eta_required: {
    USA: { programName: 'ESTA', applyUrl: 'https://esta.cbp.dhs.gov', leadTimeDays: 3 },
    CAN: {
      programName: 'eTA',
      applyUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta.html',
      leadTimeDays: 1,
    },
    GBR: {
      programName: 'ETA',
      applyUrl: 'https://www.gov.uk/guidance/apply-for-an-electronic-travel-authorisation-eta',
      leadTimeDays: 3,
    },
    AUS: {
      programName: 'ETA',
      applyUrl: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/electronic-travel-authority-601',
      leadTimeDays: 7,
    },
  },
  evisa_required: {
    IND: { programName: 'e-Visa India', applyUrl: 'https://indianvisaonline.gov.in/evisa', leadTimeDays: 4 },
    TUR: { programName: 'e-Visa Türkiye', applyUrl: 'https://www.evisa.gov.tr', leadTimeDays: 1 },
  },
  visa_on_arrival: {},
  visa_required: {},
  visa_free: {},
  unknown: {},
};

interface CheckVisaResult {
  status: VisaStatus;
  required: boolean;
  message: string;
  programName: string | null;
  applyUrl: string | null;
  leadTimeDays: number | null;
  /** When true, the booking can proceed even though paperwork is needed. */
  bookingAllowed: boolean;
}

export const checkVisaRequirementsTool: ToolDef = {
  name: 'check_visa_requirements',
  description:
    'Look up whether a traveler needs a visa / ETA / e-visa for a destination. Returns a structured status + an apply URL when applicable. Conversational — never blocks a booking. Read the traveler nationality from their PassportVault row when available; otherwise ask.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['nationalityIso3', 'destinationIso3'],
    properties: {
      nationalityIso3: { type: 'string', minLength: 3, maxLength: 3 },
      destinationIso3: { type: 'string', minLength: 3, maxLength: 3 },
    },
  },
  async handler(input: CheckVisaInput): Promise<CheckVisaResult> {
    const status = lookupVisaStatus(input.nationalityIso3, input.destinationIso3);
    const program =
      PROGRAM_BY_STATUS[status]?.[input.destinationIso3.toUpperCase()] ?? null;

    const required = status !== 'visa_free' && status !== 'unknown';
    // ETA / e-visa are paperwork but never gate the actual flight booking
    // — the agent should surface them with apply URL but allow booking.
    // Full consulate visa is the only status worth surfacing as a
    // strong "consider before you commit" signal — still informational.
    const bookingAllowed = true;

    let message: string;
    switch (status) {
      case 'visa_free':
        message = `No visa needed (${input.nationalityIso3} → ${input.destinationIso3}). Bring your passport with at least 6 months validity from your return date.`;
        break;
      case 'visa_on_arrival':
        message = `Visa on arrival — get it at the airport on entry. Most countries take USD cash or card. Bring two passport photos and a printout of your hotel address.`;
        break;
      case 'eta_required':
        message = program
          ? `${program.programName} required — apply online at least ${program.leadTimeDays} days before departure: ${program.applyUrl}`
          : `Electronic Travel Authorization required — apply with the destination's immigration site at least 3 days before departure.`;
        break;
      case 'evisa_required':
        message = program
          ? `e-Visa required — apply online at least ${program.leadTimeDays} days before departure: ${program.applyUrl}`
          : `e-Visa required — apply through the destination's official portal at least 4 days before departure.`;
        break;
      case 'visa_required':
        message = `Full consulate visa required (${input.nationalityIso3} → ${input.destinationIso3}). Plan ahead — most consulates need 2–6 weeks. The booking can still go through; the visa is your responsibility.`;
        break;
      case 'unknown':
      default:
        message = `Sendero hasn't curated this corridor (${input.nationalityIso3} → ${input.destinationIso3}). Check the destination's embassy or consulate website to confirm before traveling.`;
        break;
    }

    return {
      status,
      required,
      message,
      programName: program?.programName ?? null,
      applyUrl: program?.applyUrl ?? null,
      leadTimeDays: program?.leadTimeDays ?? null,
      bookingAllowed,
    };
  },
};
