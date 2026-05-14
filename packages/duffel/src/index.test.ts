import { test, expect } from 'bun:test';

import { duffelItineraryViewResponseSchema, projectItinerariesResponse } from './index';

/**
 * Codex review (e) follow-up — the itinerary-view response parser now
 * runs through a zod schema before projection. These tests cover the
 * three branches we care about:
 *   (a) valid response → projects clean
 *   (b) null entries inside the nested offers array → filtered, no throw
 *   (c) malformed top-level shape → safeParse fails gracefully
 */

const validResponse = {
  slices: [
    {
      origin: { iata_code: 'JFK' },
      destination: { iata_code: 'LHR' },
      departure_date: '2026-06-01',
      itineraries: [
        {
          brands: [
            {
              offers: [
                {
                  id: 'off_single_1',
                  type: 'single_ticket',
                  total_amount: '420.00',
                  total_currency: 'USD',
                  owner: { iata_code: 'BA', name: 'British Airways' },
                  slices: [
                    {
                      duration: 'PT7H',
                      segments: [
                        {
                          origin: { iata_code: 'JFK', city_name: 'New York' },
                          destination: { iata_code: 'LHR', city_name: 'London' },
                          departing_at: '2026-06-01T18:00:00Z',
                          arriving_at: '2026-06-02T06:00:00Z',
                          passengers: [{ cabin_class: 'economy' }],
                        },
                      ],
                    },
                  ],
                  expires_at: '2026-06-01T17:00:00Z',
                  payment_requirements: { requires_instant_payment: false },
                },
                {
                  id: 'off_split_1',
                  type: 'split_ticket',
                  total_amount: '310.00',
                  total_currency: 'USD',
                  owner: { iata_code: 'IB', name: 'Iberia' },
                  slices: [
                    {
                      duration: 'PT5H',
                      segments: [
                        {
                          origin: { iata_code: 'JFK', city_name: 'New York' },
                          destination: { iata_code: 'MAD', city_name: 'Madrid' },
                          departing_at: '2026-06-01T20:00:00Z',
                          arriving_at: '2026-06-02T08:00:00Z',
                          passengers: [{ cabin_class: 'economy' }],
                        },
                      ],
                    },
                  ],
                  expires_at: '2026-06-01T17:00:00Z',
                  payment_requirements: { requires_instant_payment: true },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

test('zod path (a): valid response parses + projects without throwing', () => {
  const parsed = duffelItineraryViewResponseSchema.safeParse(validResponse);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  const projected = projectItinerariesResponse(parsed.data, 'JFK', 'LHR');
  expect(projected.singleTickets.length).toBe(1);
  expect(projected.singleTickets[0].id).toBe('off_single_1');
  expect(projected.slices.length).toBe(1);
  expect(projected.slices[0].splitTickets.length).toBe(1);
  expect(projected.slices[0].splitTickets[0].id).toBe('off_split_1');
  expect(projected.slices[0].originCode).toBe('JFK');
  expect(projected.slices[0].destinationCode).toBe('LHR');
});

test('zod path (b): null offer + null brand + null itinerary entries get filtered, no throw', () => {
  // This is the exact pattern Codex flagged — a null in the offers array
  // would have thrown under defensive optional-chaining when the iteration
  // hit `.id` on null.
  const responseWithNulls = {
    slices: [
      {
        origin: 'JFK', // string-form origin
        destination: 'LHR',
        departure_date: '2026-06-01',
        itineraries: [
          null, // null itinerary entry
          {
            brands: [
              null, // null brand entry
              {
                offers: [
                  null, // null offer entry — the canonical Codex case
                  {
                    id: 'off_valid_1',
                    type: 'single_ticket',
                    total_amount: '500.00',
                    total_currency: 'USD',
                    owner: { iata_code: 'AA', name: 'American' },
                    slices: [],
                    expires_at: '2026-06-01T17:00:00Z',
                    payment_requirements: { requires_instant_payment: false },
                  },
                  null, // trailing null
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const parsed = duffelItineraryViewResponseSchema.safeParse(responseWithNulls);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;

  // Verify the transform filtered nulls
  const slice0 = parsed.data.slices?.[0];
  expect(slice0).toBeDefined();
  expect(slice0?.itineraries?.length).toBe(1); // null filtered
  const brand0 = slice0?.itineraries?.[0]?.brands?.[0];
  expect(brand0).toBeDefined();
  expect(brand0?.offers?.length).toBe(1); // two nulls filtered

  // Projection runs without throwing — the load-bearing assertion
  const projected = projectItinerariesResponse(parsed.data, 'JFK', 'LHR');
  expect(projected.singleTickets.length).toBe(1);
  expect(projected.singleTickets[0].id).toBe('off_valid_1');
});

test('zod path (c): malformed top-level response does not throw — safeParse contains it', () => {
  // Top-level not-an-object. Schema is permissive but the root must be
  // an object-like shape; primitives + arrays fail safeParse cleanly.
  const malformed = 'not an object';
  const parsed = duffelItineraryViewResponseSchema.safeParse(malformed);
  expect(parsed.success).toBe(false);

  // The caller-side fallback shape is what real `searchFlightsItineraries`
  // returns on parse failure. Verify projecting `undefined` also doesn't
  // throw — defense in depth.
  expect(() => projectItinerariesResponse(undefined, 'JFK', 'LHR')).not.toThrow();
  const empty = projectItinerariesResponse(undefined, 'JFK', 'LHR');
  expect(empty.singleTickets).toEqual([]);
  expect(empty.slices).toEqual([]);
});

test('zod path: missing slices entirely is tolerated (empty object)', () => {
  const parsed = duffelItineraryViewResponseSchema.safeParse({});
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const projected = projectItinerariesResponse(parsed.data, 'JFK', 'LHR');
  expect(projected.singleTickets).toEqual([]);
  expect(projected.slices).toEqual([]);
});

test('zod path: origin/destination as plain string (alternate union branch)', () => {
  const response = {
    slices: [
      {
        origin: 'SFO',
        destination: 'NRT',
        departure_date: '2026-07-01',
        itineraries: [],
      },
    ],
  };
  const parsed = duffelItineraryViewResponseSchema.safeParse(response);
  expect(parsed.success).toBe(true);
  if (!parsed.success) return;
  const projected = projectItinerariesResponse(parsed.data, 'SFO', 'NRT');
  expect(projected.slices[0].originCode).toBe('SFO');
  expect(projected.slices[0].destinationCode).toBe('NRT');
});
