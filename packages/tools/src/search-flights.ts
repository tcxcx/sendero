import { z } from 'zod';
import { searchFlights } from '@sendero/duffel';
import type { ToolDef } from './types';

const inputSchema = z.object({
  origin: z.string().length(3),
  destination: z.string().length(3),
  departureDate: z.string(),
  returnDate: z.string().optional(),
  passengers: z.number().int().min(1).max(9).default(1),
  cabinClass: z.enum(['economy', 'premium_economy', 'business', 'first']).default('economy'),
});

export const searchFlightsTool: ToolDef = {
  name: 'search_flights',
  description:
    'Search flights between two airports. Requires IATA codes and a departure date (YYYY-MM-DD).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['origin', 'destination', 'departureDate'],
    properties: {
      origin: {
        type: 'string',
        description: 'IATA code, e.g. SFO',
        minLength: 3,
        maxLength: 3,
      },
      destination: {
        type: 'string',
        description: 'IATA code, e.g. LHR',
        minLength: 3,
        maxLength: 3,
      },
      departureDate: { type: 'string', description: 'YYYY-MM-DD' },
      returnDate: { type: 'string', description: 'YYYY-MM-DD (optional)' },
      passengers: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
      cabinClass: {
        type: 'string',
        enum: ['economy', 'premium_economy', 'business', 'first'],
        default: 'economy',
      },
    },
  },
  async handler(input: any) {
    const offers = await searchFlights(input);
    return { offers: offers.slice(0, 3) };
  },
};
