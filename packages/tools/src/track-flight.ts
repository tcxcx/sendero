/**
 * track_flight — wrap FlightAware AeroAPI's `flights/{ident}` via x402.
 *
 * Real-time flight status by airline designator (AAL100, IBE6275),
 * tail number, or FA flight id. One x402 call to stabletravel.dev
 * costs $0.01 USDC; we charge the tenant $0.025 (priced in
 * `pricing.ts`). The outbound spend is recorded as a separate
 * `MeterEvent` tagged `x402_outbound` so admin billing can roll
 * margin per-tool.
 *
 * Use cases the agent reaches for this:
 *   - "Is UA1 on time?" — direct status check.
 *   - Disruption recovery — verify a delay before proposing rebook.
 *   - Pre-departure reminder — fetch ETD/ETA before notifying traveler.
 *
 * Returns a canonical `share` payload so the same call renders
 * identically on Slack, WhatsApp, web traveler, and operator inbox.
 */

import { z } from 'zod';

import type { ToolDef, ToolContext } from './types';
import { x402Fetch, X402Error } from './x402-fetch';

export interface TrackFlightDeps {
  fetch: typeof x402Fetch;
}

const defaultDeps: TrackFlightDeps = { fetch: x402Fetch };

const inputSchema = z.object({
  ident: z
    .string()
    .min(2)
    .max(20)
    .describe('Airline designator (AAL100, AA100), tail number, or fa_flight_id.'),
  max: z
    .number()
    .int()
    .min(1)
    .max(15)
    .optional()
    .default(3)
    .describe('Max recent/upcoming flight instances to return.'),
});

export type TrackFlightInput = z.infer<typeof inputSchema>;

interface FlightAwareEndpoint {
  code?: string;
  code_icao?: string;
  code_iata?: string;
  name?: string;
  city?: string;
}

interface FlightAwareFlight {
  fa_flight_id?: string;
  ident?: string;
  ident_icao?: string;
  ident_iata?: string;
  operator?: string;
  operator_iata?: string;
  flight_number?: string;
  origin?: FlightAwareEndpoint;
  destination?: FlightAwareEndpoint;
  scheduled_out?: string;
  estimated_out?: string;
  actual_out?: string;
  scheduled_in?: string;
  estimated_in?: string;
  actual_in?: string;
  status?: string;
  aircraft_type?: string;
  cancelled?: boolean;
  diverted?: boolean;
  progress_percent?: number;
}

interface FlightAwareResponse {
  flights?: FlightAwareFlight[];
}

export interface TrackFlightResult {
  ident: string;
  flights: Array<{
    faFlightId?: string;
    designator?: string;
    iataDesignator?: string;
    operator?: string;
    flightNumber?: string;
    originCode?: string;
    originName?: string;
    destinationCode?: string;
    destinationName?: string;
    scheduledOut?: string;
    estimatedOut?: string;
    actualOut?: string;
    scheduledIn?: string;
    estimatedIn?: string;
    estimatedActualIn?: string;
    status: string;
    delayMinutesOut?: number;
    delayMinutesIn?: number;
    aircraftType?: string;
    cancelled: boolean;
    diverted: boolean;
    progressPercent?: number;
  }>;
  share: {
    title: string;
    body: string;
    bullets: string[];
  };
}

function minutesBetween(a?: string, b?: string): number | undefined {
  if (!a || !b) return undefined;
  const ma = Date.parse(a);
  const mb = Date.parse(b);
  if (Number.isNaN(ma) || Number.isNaN(mb)) return undefined;
  return Math.round((mb - ma) / 60_000);
}

function shortTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toISOString().slice(11, 16) + 'Z';
}

function toResultFlight(f: FlightAwareFlight): TrackFlightResult['flights'][number] {
  const delayOut = minutesBetween(f.scheduled_out, f.estimated_out ?? f.actual_out);
  const delayIn = minutesBetween(f.scheduled_in, f.estimated_in ?? f.actual_in);
  const status = f.cancelled ? 'Cancelled' : f.diverted ? 'Diverted' : f.status ?? 'Unknown';
  return {
    faFlightId: f.fa_flight_id,
    designator: f.ident_icao ?? f.ident,
    iataDesignator: f.ident_iata,
    operator: f.operator_iata ?? f.operator,
    flightNumber: f.flight_number,
    originCode: f.origin?.code_iata ?? f.origin?.code,
    originName: f.origin?.name,
    destinationCode: f.destination?.code_iata ?? f.destination?.code,
    destinationName: f.destination?.name,
    scheduledOut: f.scheduled_out,
    estimatedOut: f.estimated_out,
    actualOut: f.actual_out,
    scheduledIn: f.scheduled_in,
    estimatedIn: f.estimated_in,
    estimatedActualIn: f.actual_in,
    status,
    delayMinutesOut: delayOut,
    delayMinutesIn: delayIn,
    aircraftType: f.aircraft_type,
    cancelled: Boolean(f.cancelled),
    diverted: Boolean(f.diverted),
    progressPercent: f.progress_percent,
  };
}

function buildShare(ident: string, flights: TrackFlightResult['flights']): TrackFlightResult['share'] {
  if (flights.length === 0) {
    return {
      title: `${ident}: no flights found`,
      body: 'FlightAware returned no instances for this ident in the current window.',
      bullets: [],
    };
  }
  const next = flights[0]!;
  const route =
    next.originCode && next.destinationCode ? `${next.originCode} → ${next.destinationCode}` : next.designator ?? ident;
  const delayLabel =
    typeof next.delayMinutesOut === 'number' && Math.abs(next.delayMinutesOut) >= 5
      ? next.delayMinutesOut > 0
        ? ` · +${next.delayMinutesOut}m delay`
        : ` · ${next.delayMinutesOut}m early`
      : '';
  const title = `${next.designator ?? ident}: ${next.status}${delayLabel}`;
  const body = `${route} · scheduled ${shortTime(next.scheduledOut)} → ${shortTime(next.scheduledIn)}${
    next.aircraftType ? ` · ${next.aircraftType}` : ''
  }`;
  const bullets = flights.slice(0, 3).map(f => {
    const r = f.originCode && f.destinationCode ? `${f.originCode}→${f.destinationCode}` : '—';
    const out = shortTime(f.estimatedOut ?? f.actualOut ?? f.scheduledOut);
    const inn = shortTime(f.estimatedIn ?? f.estimatedActualIn ?? f.scheduledIn);
    return `${r} · ${out} → ${inn} · ${f.status}`;
  });
  return { title, body, bullets };
}

export const trackFlightTool: ToolDef<TrackFlightInput, TrackFlightResult | { error: string }> = {
  name: 'track_flight',
  description:
    'Live flight status from FlightAware (AeroAPI) for an airline designator, tail number, or fa_flight_id. Returns scheduled/estimated/actual times, delay minutes, aircraft type, and route. Use to verify on-time status, confirm delays before rebooking, or surface ETD/ETA. Settles via x402 (~$0.01 USDC outbound; tenant charged $0.025).',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['ident'],
    properties: {
      ident: {
        type: 'string',
        description: 'Airline designator (AAL100, AA100), tail number, or fa_flight_id.',
      },
      max: {
        type: 'integer',
        minimum: 1,
        maximum: 15,
        default: 3,
        description: 'Max recent/upcoming flight instances to return.',
      },
    },
  },
  async handler(input, ctx) {
    return runTrackFlight(input, ctx ?? {}, defaultDeps);
  },
};

export async function runTrackFlight(
  input: TrackFlightInput,
  ctx: ToolContext,
  deps: TrackFlightDeps = defaultDeps
): Promise<TrackFlightResult | { error: string }> {
  const parsed = inputSchema.parse(input);
  const ident = parsed.ident.trim().toUpperCase();
  const url = `https://stabletravel.dev/api/flightaware/flights/${encodeURIComponent(ident)}`;

  try {
    const { data } = await deps.fetch<FlightAwareResponse>(url, {
      method: 'GET',
      toolName: 'track_flight',
      ctx,
    });
    const flights = (data.flights ?? []).slice(0, parsed.max).map(toResultFlight);
    return {
      ident,
      flights,
      share: buildShare(ident, flights),
    };
  } catch (err) {
    if (err instanceof X402Error) {
      return { error: `[${err.code}] ${err.message}` };
    }
    throw err;
  }
}
