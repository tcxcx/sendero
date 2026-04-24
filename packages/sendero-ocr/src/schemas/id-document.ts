/**
 * ID document schema — passport, national ID, driver's license.
 *
 * New for Sendero — desk-v1 had no ID extractor. Field set maps to ICAO 9303
 * MRZ + the common visual zone fields Duffel / agency KYC flows need.
 *
 * Security: callers MUST gate ID extraction behind an explicit tenant
 * "compliance mode" flag. `extractDocument` checks `options.allowSensitive`
 * before running this schema (see `src/extract.ts`).
 */

import { z } from 'zod';

export const idDocumentSchema = z.object({
  document_variant: z
    .enum(['passport', 'national_id', 'drivers_license', 'residence_permit', 'other'])
    .nullable()
    .describe('Kind of ID document'),
  issuing_country: z
    .string()
    .nullable()
    .describe('ISO 3166-1 alpha-3 issuing country code (e.g. USA, ARG, GBR)'),
  document_number: z.string().nullable().describe('ID document number as printed'),
  surname: z.string().nullable().describe('Surname / family name as printed'),
  given_names: z.string().nullable().describe('Given names as printed'),
  date_of_birth: z
    .string()
    .nullable()
    .describe('ISO 8601 date of birth (YYYY-MM-DD)'),
  sex: z.enum(['M', 'F', 'X']).nullable().describe('Sex as printed on document'),
  nationality: z
    .string()
    .nullable()
    .describe('ISO 3166-1 alpha-3 nationality code'),
  date_of_issue: z.string().nullable(),
  date_of_expiry: z
    .string()
    .nullable()
    .describe('ISO 8601 expiry date — critical for travel compliance'),
  place_of_birth: z.string().nullable(),
  mrz_line1: z
    .string()
    .nullable()
    .describe('First Machine Readable Zone line, verbatim'),
  mrz_line2: z.string().nullable().describe('Second MRZ line, verbatim'),
  mrz_line3: z
    .string()
    .nullable()
    .describe('Third MRZ line — present on TD1 (national IDs), null on TD3 (passports)'),
});

export type IdDocumentExtraction = z.infer<typeof idDocumentSchema>;
