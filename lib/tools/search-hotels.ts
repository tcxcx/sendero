import { z } from 'zod';
import { searchHotels } from '../duffel';
import type { ToolDef } from './types';

const inputSchema = z.object({
  location: z
    .string()
    .describe('City, neighborhood, or airport code. Free-form text works.'),
  checkInDate: z.string().describe('YYYY-MM-DD'),
  checkOutDate: z.string().describe('YYYY-MM-DD'),
  guests: z.number().int().min(1).max(9).default(1),
  rooms: z.number().int().min(1).max(9).default(1),
});

export const searchHotelsTool: ToolDef = {
  name: 'search_hotels',
  description:
    'Search hotels in a city for given dates. Returns up to 6 accommodations with real photos, star rating, review score, cheapest rate, and cancellation policy. Use when the user asks for lodging.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['location', 'checkInDate', 'checkOutDate'],
    properties: {
      location: {
        type: 'string',
        description: 'City, neighborhood, or airport code. Free-form text works.',
      },
      checkInDate: { type: 'string', description: 'YYYY-MM-DD' },
      checkOutDate: { type: 'string', description: 'YYYY-MM-DD' },
      guests: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
      rooms: { type: 'integer', default: 1, minimum: 1, maximum: 9 },
    },
  },
  async handler(input: any) {
    const hotels = await searchHotels(input);
    return { hotels: hotels.slice(0, 6) };
  },
};
