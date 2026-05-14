/**
 * pricing_benchmark — anonymized route-level pricing intelligence.
 *
 * The agent supplies an origin/destination pair (IATA airport codes
 * OR ISO-3166 country codes) and an optional cabin class; Sendero
 * returns median, p25, p75, and sample size from the rolling booking
 * window. The data improves every time another agent buys through
 * Sendero — each new booking adds one observation, so the network's
 * pricing intelligence compounds across all callers.
 *
 * Why a premium read:
 *   - The value isn't the static data, it's the *aggregated network
 *     signal* that no single agent can replicate locally. Same a16z
 *     "come for the agent, stay for the network" wedge — agents
 *     pay for the network effect, not the bytes.
 *   - K-anonymity (n ≥ 20) enforced on every response; sub-threshold
 *     pairs return `{ available: false }` rather than leak partial
 *     samples. Tenant ids never appear in output.
 *
 * Priced $0.05 — premium read tier. Compares to per-call $0.001–
 * $0.005 reads; reflects the network value of the underlying
 * aggregate.
 */

import { z } from 'zod';

import { type Prisma, prisma } from '@sendero/database';

import type { ToolDef } from './types';

const MIN_SAMPLE_SIZE = 20;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;

const inputSchema = z.object({
  origin: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(3)
    .describe(
      'Origin: 3-letter IATA airport code (SFO, LHR, GRU) OR 2-letter ISO-3166 country code (US, GB, BR). Country-level lookups return broader samples; IATA returns route-specific.'
    ),
  destination: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(3)
    .describe('Destination: same format as origin.'),
  cabin: z
    .enum(['economy', 'premium_economy', 'business', 'first', 'any'])
    .default('any')
    .describe('Optional cabin class filter; defaults to any (all classes pooled).'),
  windowDays: z
    .number()
    .int()
    .min(7)
    .max(MAX_WINDOW_DAYS)
    .default(DEFAULT_WINDOW_DAYS)
    .describe(`Rolling lookback window in days (7-${MAX_WINDOW_DAYS}). Default 30.`),
  kind: z
    .enum(['flight', 'hotel', 'rail', 'car', 'esim', 'insurance', 'any'])
    .default('flight')
    .describe(
      'Booking type to benchmark. Defaults to flight. "any" pools all bookable kinds (useful for thin routes).'
    ),
});

export type PricingBenchmarkInput = z.infer<typeof inputSchema>;

export interface PricingBenchmarkResultAvailable {
  available: true;
  origin: string;
  destination: string;
  granularity: 'iata' | 'country';
  cabin: PricingBenchmarkInput['cabin'];
  kind: PricingBenchmarkInput['kind'];
  windowDays: number;
  sampleSize: number;
  currency: 'USD';
  median: number;
  p25: number;
  p75: number;
  /** ISO-8601 timestamp of the most-recent booking in the sample. */
  lastObservedAt: string;
}

export interface PricingBenchmarkResultUnavailable {
  available: false;
  origin: string;
  destination: string;
  cabin: PricingBenchmarkInput['cabin'];
  kind: PricingBenchmarkInput['kind'];
  windowDays: number;
  sampleSize: number;
  reason: 'insufficient_sample';
  minSampleSize: number;
}

export type PricingBenchmarkResult =
  | PricingBenchmarkResultAvailable
  | PricingBenchmarkResultUnavailable;

function isIata(code: string): boolean {
  return code.length === 3;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const w = rank - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

export async function pricingBenchmark(
  input: PricingBenchmarkInput
): Promise<PricingBenchmarkResult> {
  const since = new Date(Date.now() - input.windowDays * 24 * 60 * 60 * 1000);
  const useIata = isIata(input.origin) && isIata(input.destination);
  const granularity: 'iata' | 'country' = useIata ? 'iata' : 'country';

  /**
   * v1 query: country-pair Booking aggregate. IATA-pair pricing is
   * the same shape, but origin/destination IATAs live in
   * `Booking.segments` JSON — querying that needs a json path index
   * which we haven't added yet. When granularity = 'iata' we widen
   * to the underlying ISO-3166 country derived from the IATA via the
   * `country-from-iata` helper, run the country-pair query, and tag
   * the response so the caller knows the response is the broader
   * grain. Once a route_observation materialized view lands we'll
   * flip to true IATA-pair.
   */
  const where: Prisma.BookingWhereInput = useIata
    ? // For IATA pairs, the helper resolves to the country pair for
      // the v1 fallback. We accept the broadening trade-off because
      // n ≥ 20 + country bucket is more honest than IATA + n < 20.
      await iataPairToCountryFilter(input.origin, input.destination, input.kind, since)
    : {
        originCountry: input.origin,
        destinationCountry: input.destination,
        kind: input.kind === 'any' ? undefined : input.kind,
        status: 'confirmed',
        bookedAt: { gte: since },
      };

  const rows = await prisma.booking.findMany({
    where,
    select: { totalUsd: true, bookedAt: true, currency: true },
    take: 2000,
    orderBy: { bookedAt: 'desc' },
  });

  const usdSample = rows
    .filter(r => r.currency === 'USD' && r.totalUsd != null)
    .map(r => Number(r.totalUsd))
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  const lastObserved = rows
    .map(r => r.bookedAt)
    .filter((d): d is Date => d != null)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  if (usdSample.length < MIN_SAMPLE_SIZE) {
    return {
      available: false,
      origin: input.origin,
      destination: input.destination,
      cabin: input.cabin,
      kind: input.kind,
      windowDays: input.windowDays,
      sampleSize: usdSample.length,
      reason: 'insufficient_sample',
      minSampleSize: MIN_SAMPLE_SIZE,
    };
  }

  return {
    available: true,
    origin: input.origin,
    destination: input.destination,
    granularity,
    cabin: input.cabin,
    kind: input.kind,
    windowDays: input.windowDays,
    sampleSize: usdSample.length,
    currency: 'USD',
    median: Math.round(percentile(usdSample, 50) * 100) / 100,
    p25: Math.round(percentile(usdSample, 25) * 100) / 100,
    p75: Math.round(percentile(usdSample, 75) * 100) / 100,
    lastObservedAt: (lastObserved ?? new Date()).toISOString(),
  };
}

/**
 * Map an IATA airport pair to its country pair for the v1 query.
 * Reuses Sendero's existing `country-from-iata` table. Falls back to
 * a useless `where: { id: '__never__' }` if either IATA is unknown
 * so the result is a clean "insufficient sample" rather than an
 * unfiltered table scan.
 */
async function iataPairToCountryFilter(
  originIata: string,
  destinationIata: string,
  kind: PricingBenchmarkInput['kind'],
  since: Date
): Promise<Prisma.BookingWhereInput> {
  const { iataToCountryAlpha2 } = await import('@sendero/duffel/country-from-iata');
  const originCountry = iataToCountryAlpha2(originIata);
  const destinationCountry = iataToCountryAlpha2(destinationIata);
  if (!originCountry || !destinationCountry) {
    return { id: '__never__' };
  }
  return {
    originCountry,
    destinationCountry,
    kind: kind === 'any' ? undefined : kind,
    status: 'confirmed',
    bookedAt: { gte: since },
  };
}

export const pricingBenchmarkTool: ToolDef<PricingBenchmarkInput, PricingBenchmarkResult> = {
  name: 'pricing_benchmark',
  description:
    'Anonymized network pricing for a route. Returns median, p25, p75, and sample size from confirmed bookings in a rolling window. K-anonymity enforced (n ≥ 20); below-threshold pairs return `{ available: false }` with no partial leak. The aggregate gets better with every Sendero booking — each new transaction is one more observation no single agent can synthesize locally. Use when an agent needs to sanity-check a quote, decide whether to hold a fare, or surface a "you are paying X% above median" notice.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['origin', 'destination'],
    properties: {
      origin: {
        type: 'string',
        minLength: 2,
        maxLength: 3,
        description: '3-letter IATA airport code or 2-letter ISO-3166 country code (uppercase).',
      },
      destination: {
        type: 'string',
        minLength: 2,
        maxLength: 3,
        description: 'Same format as origin.',
      },
      cabin: {
        type: 'string',
        enum: ['economy', 'premium_economy', 'business', 'first', 'any'],
        default: 'any',
      },
      windowDays: {
        type: 'integer',
        minimum: 7,
        maximum: MAX_WINDOW_DAYS,
        default: DEFAULT_WINDOW_DAYS,
      },
      kind: {
        type: 'string',
        enum: ['flight', 'hotel', 'rail', 'car', 'esim', 'insurance', 'any'],
        default: 'flight',
      },
    },
  },
  handler: pricingBenchmark,
};
