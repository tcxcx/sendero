/**
 * Boarding pass schema — PNR, carrier, flight, seat, traveler.
 *
 * New for Sendero — desk-v1 had no boarding-pass extractor. Field set is
 * aligned with IATA BCBP (Bar-Coded Boarding Pass) Resolution 792 and what
 * Sendero's Duffel integration already tracks on the trip object.
 */

import { z } from 'zod';

import { documentKindSchema } from './common';

export const boardingPassSchema = z.object({
  document_kind: documentKindSchema
    .nullable()
    .describe("Confirm this is a boarding pass — leave other fields null if it isn't."),
  passenger_name: z
    .string()
    .nullable()
    .describe('Full passenger name as printed (typically SURNAME/FIRSTNAME format)'),
  pnr: z.string().nullable().describe('6-character booking reference / record locator'),
  ticket_number: z.string().nullable().describe('13-digit airline ticket number if visible'),
  carrier_code: z.string().nullable().describe('2-letter IATA carrier code (e.g. AA, BA, LH)'),
  carrier_name: z.string().nullable().describe('Full airline name'),
  flight_number: z.string().nullable().describe('Flight number without carrier prefix'),
  origin_iata: z.string().nullable().describe('3-letter IATA origin airport code'),
  destination_iata: z.string().nullable().describe('3-letter IATA destination airport code'),
  departure_at: z
    .string()
    .nullable()
    .describe('Local scheduled departure in ISO 8601 (YYYY-MM-DDTHH:mm) — date only is fine'),
  boarding_at: z.string().nullable().describe('Local boarding time in ISO 8601'),
  cabin_class: z
    .string()
    .nullable()
    .describe('Cabin class printed on the pass (economy, premium_economy, business, first)'),
  seat: z.string().nullable().describe('Seat assignment, e.g. 14A'),
  gate: z.string().nullable().describe('Departure gate if printed'),
  sequence_number: z.string().nullable().describe('Boarding sequence / check-in order number'),
  frequent_flyer: z.string().nullable().describe('Frequent flyer number if visible'),
  language: z.string().nullable(),
});

export type BoardingPassExtraction = z.infer<typeof boardingPassSchema>;
