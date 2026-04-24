import { z } from 'zod';
import { searchFlights, type FlightSearchParams } from '@sendero/duffel';
import type { ToolDef, ToolContext } from './types';
import { ensureFlightCustomer } from './ensure-flight-customer';

const privateFareCredentialSchema = z
  .object({
    corporate_code: z.string().optional(),
    tour_code: z.string().optional(),
    tracking_reference: z.string().optional(),
    account_number: z.string().optional(),
  })
  .refine(
    v => Boolean(v.corporate_code || v.tour_code || v.tracking_reference || v.account_number),
    {
      message:
        'At least one of corporate_code, tour_code, tracking_reference, or account_number is required.',
    }
  );

const loyaltyAccountSchema = z.object({
  airlineIataCode: z.string().length(2),
  accountNumber: z.string().min(1),
});

const inputSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureDate: z.string(),
  returnDate: z.string().optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
  /**
   * Corporate negotiated fares + corporate loyalty programmes keyed by
   * airline IATA code. E.g. `{ "AA": [{ corporate_code: "AACORP123", tour_code: "CODE12" }] }`.
   * See /guides/accessing-corporate-private-fares + /guides/adding-corporate-loyalty-programme-accounts.
   */
  privateFares: z.record(z.string(), z.array(privateFareCredentialSchema)).optional(),
  /** Per-passenger leisure fare types (student, contract_bulk, etc.). */
  leisureFareTypes: z
    .array(
      z
        .enum([
          'student',
          'senior',
          'contract_bulk',
          'contract_bulk_child',
          'contract_bulk_infant_with_seat',
          'contract_bulk_infant_without_seat',
          'tour',
          'air_crew',
          'visiting_friends_and_family',
        ])
        .optional()
    )
    .optional(),
  /** Per-passenger loyalty-programme accounts (BA Executive Club, etc.). */
  loyaltyProgrammeAccounts: z.array(z.array(loyaltyAccountSchema)).optional(),
  /** Duffel airline credit pool to match against offers. */
  airlineCreditIds: z.array(z.string().min(3)).optional(),
  /** Link the primary passenger to a Duffel CustomerUser. */
  customerUserId: z.string().optional(),
  /** Auto-ensure the session traveler has a Duffel CustomerUser and match it. */
  linkSessionTraveler: z.boolean().default(false),
});

type SearchFlightsInput = z.infer<typeof inputSchema>;

export const searchFlightsTool: ToolDef<SearchFlightsInput> = {
  name: 'search_flights',
  description:
    'Search flights between two airports. Requires IATA codes and a departure date (YYYY-MM-DD). Supports corporate private fares + corporate loyalty programmes via `privateFares`, leisure private fares via per-passenger `leisureFareTypes`, per-passenger loyalty accounts, and airline-credit matching via `airlineCreditIds` or `linkSessionTraveler`.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departureDate'],
    properties: {
      origin: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA, e.g. SFO' },
      destination: { type: 'string', minLength: 3, maxLength: 3, description: 'IATA, e.g. LHR' },
      departureDate: { type: 'string', description: 'YYYY-MM-DD' },
      returnDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
      passengers: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
      cabinClass: {
        type: 'string',
        enum: ['economy', 'premium_economy', 'business', 'first'],
        default: 'economy',
      },
      privateFares: {
        type: 'object',
        description:
          'Keyed by airline IATA code. Each entry is an array of credentials: { corporate_code, tour_code, tracking_reference, account_number }. See /guides/accessing-corporate-private-fares and /guides/adding-corporate-loyalty-programme-accounts.',
        additionalProperties: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              corporate_code: { type: 'string' },
              tour_code: { type: 'string' },
              tracking_reference: { type: 'string' },
              account_number: { type: 'string' },
            },
          },
        },
      },
      leisureFareTypes: {
        type: 'array',
        items: {
          type: 'string',
          enum: [
            'student',
            'senior',
            'contract_bulk',
            'contract_bulk_child',
            'contract_bulk_infant_with_seat',
            'contract_bulk_infant_without_seat',
            'tour',
            'air_crew',
            'visiting_friends_and_family',
          ],
        },
      },
      loyaltyProgrammeAccounts: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['airlineIataCode', 'accountNumber'],
            properties: {
              airlineIataCode: { type: 'string', minLength: 2, maxLength: 2 },
              accountNumber: { type: 'string' },
            },
          },
        },
      },
      airlineCreditIds: { type: 'array', items: { type: 'string' } },
      customerUserId: { type: 'string' },
      linkSessionTraveler: { type: 'boolean', default: false },
    },
  },
  async handler(input, ctx?: ToolContext) {
    let customerUserId = input.customerUserId as FlightSearchParams['customerUserId'];
    if (!customerUserId && input.linkSessionTraveler && ctx?.traveler?.userId) {
      try {
        const identity = await ensureFlightCustomer(
          { clerkUserId: ctx.traveler.userId, tenantId: ctx.traveler.tenantId },
          ctx
        );
        customerUserId = identity.supplierTravelerId as FlightSearchParams['customerUserId'];
      } catch {
        // continue without link
      }
    }

    const loyaltyProgrammeAccounts = input.loyaltyProgrammeAccounts?.map(rows =>
      rows.map(r => ({
        airlineIataCode: r.airlineIataCode ?? '',
        accountNumber: r.accountNumber ?? '',
      }))
    );
    const offers = await searchFlights({
      origin: input.origin,
      destination: input.destination,
      departureDate: input.departureDate,
      returnDate: input.returnDate,
      passengers: input.passengers,
      cabinClass: input.cabinClass,
      privateFares: input.privateFares,
      leisureFareTypes: input.leisureFareTypes,
      loyaltyProgrammeAccounts,
      airlineCreditIds: input.airlineCreditIds as FlightSearchParams['airlineCreditIds'],
      customerUserId,
    });
    return { offers: offers.slice(0, 3) };
  },
};
