/**
 * Per-segment, per-action nanopayment pricing catalog.
 *
 * Matches the Sendero product description: the same tool called from
 * consumer vs agency vs corporate vs AI-agent can carry a different
 * price. Segments are identified by the consuming Tenant's
 * `billingTier` (mapped in the consuming app) plus explicit overrides.
 *
 * Prices are expressed in micro-USDC (10^-6). A single USDC = 1_000_000.
 */

export type BillingSegment =
  | 'consumer' // B2C — individual traveler on WhatsApp
  | 'agency' // B2B — TMC agency white-label on WhatsApp
  | 'corporate' // B2B — 50-500 employee corp on Slack / web
  | 'ai_agent'; // B2B2AI — calling LLM pays via MCP

export type PricedAction =
  | 'search_flights'
  | 'search_hotels'
  | 'check_policy'
  | 'quote_fx'
  | 'hold_booking'
  | 'confirm_booking'
  | 'modify_booking'
  | 'cancel_booking'
  | 'get_trip_status'
  | 'get_traveler_context'
  | 'recommend_restaurants'
  | 'book_insurance'
  | 'book_car_rental'
  | 'chat_reply'
  | 'mcp_tool_call';

/** Take-rate applied on top of booking gross value (in basis points). */
export interface GmvTakeRate {
  bps: number;
}

export interface PriceCell {
  /** Fixed micro-USDC charge per call. */
  micro: bigint;
  /** Optional GMV take-rate layered on top (only for actions that settle gross). */
  gmv?: GmvTakeRate;
}

type CatalogCell = { [K in BillingSegment]: PriceCell };

const M = (usd: string): bigint => {
  const [whole, frac = ''] = usd.split('.');
  const padded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(padded || '0');
};

/**
 * Default catalog. Numbers taken directly from the Sendero product
 * description. Consuming apps can deep-merge overrides on top (e.g. a
 * strategic TMC deal that waives search cost).
 */
export const DEFAULT_PRICING: Record<PricedAction, CatalogCell> = {
  search_flights: {
    consumer: { micro: M('0.02') },
    agency: { micro: M('0.02') },
    corporate: { micro: M('0.02') },
    ai_agent: { micro: M('0.02') },
  },
  search_hotels: {
    consumer: { micro: M('0.02') },
    agency: { micro: M('0.02') },
    corporate: { micro: M('0.02') },
    ai_agent: { micro: M('0.02') },
  },
  check_policy: {
    consumer: { micro: M('0.00') },
    agency: { micro: M('0.05') },
    corporate: { micro: M('0.10') },
    ai_agent: { micro: M('0.10') },
  },
  quote_fx: {
    consumer: { micro: M('0.01') },
    agency: { micro: M('0.01') },
    corporate: { micro: M('0.01') },
    ai_agent: { micro: M('0.01') },
  },
  hold_booking: {
    consumer: { micro: M('0.15') },
    agency: { micro: M('0.15') },
    corporate: { micro: M('0.15') },
    ai_agent: { micro: M('0.15') },
  },
  confirm_booking: {
    consumer: { micro: M('1.00'), gmv: { bps: 50 } },
    agency: { micro: M('1.00'), gmv: { bps: 50 } },
    corporate: { micro: M('1.00'), gmv: { bps: 50 } },
    ai_agent: { micro: M('1.00'), gmv: { bps: 50 } },
  },
  modify_booking: {
    consumer: { micro: M('1.50') },
    agency: { micro: M('1.50') },
    corporate: { micro: M('1.50') },
    ai_agent: { micro: M('1.50') },
  },
  cancel_booking: {
    consumer: { micro: M('1.50') },
    agency: { micro: M('1.50') },
    corporate: { micro: M('1.50') },
    ai_agent: { micro: M('1.50') },
  },
  get_trip_status: {
    consumer: { micro: M('0.00') },
    agency: { micro: M('0.00') },
    corporate: { micro: M('0.00') },
    ai_agent: { micro: M('0.05') },
  },
  get_traveler_context: {
    consumer: { micro: M('0.00') },
    agency: { micro: M('0.05') },
    corporate: { micro: M('0.05') },
    ai_agent: { micro: M('0.05') },
  },
  recommend_restaurants: {
    consumer: { micro: M('0.02') },
    agency: { micro: M('0.02') },
    corporate: { micro: M('0.02') },
    ai_agent: { micro: M('0.02') },
  },
  book_insurance: {
    consumer: { micro: M('0.50'), gmv: { bps: 50 } },
    agency: { micro: M('0.50'), gmv: { bps: 50 } },
    corporate: { micro: M('0.50'), gmv: { bps: 50 } },
    ai_agent: { micro: M('0.50'), gmv: { bps: 50 } },
  },
  book_car_rental: {
    consumer: { micro: M('0.50'), gmv: { bps: 50 } },
    agency: { micro: M('0.50'), gmv: { bps: 50 } },
    corporate: { micro: M('0.50'), gmv: { bps: 50 } },
    ai_agent: { micro: M('0.50'), gmv: { bps: 50 } },
  },
  chat_reply: {
    consumer: { micro: M('0.01') },
    agency: { micro: M('0.01') },
    corporate: { micro: M('0.01') },
    ai_agent: { micro: M('0.00') },
  },
  mcp_tool_call: {
    consumer: { micro: M('0.00') },
    agency: { micro: M('0.00') },
    corporate: { micro: M('0.00') },
    ai_agent: { micro: M('0.05') },
  },
};

export interface PriceLookupArgs {
  action: PricedAction;
  segment: BillingSegment;
  overrides?: Partial<Record<PricedAction, Partial<CatalogCell>>>;
}

export function priceFor(args: PriceLookupArgs): PriceCell {
  const override = args.overrides?.[args.action]?.[args.segment];
  return override ?? DEFAULT_PRICING[args.action][args.segment];
}

export interface GmvChargeArgs {
  grossMicroUsdc: bigint;
  gmv?: GmvTakeRate;
}

export function gmvMicroCharge({ grossMicroUsdc, gmv }: GmvChargeArgs): bigint {
  if (!gmv) return 0n;
  // basis points → /10_000
  return (grossMicroUsdc * BigInt(gmv.bps)) / 10_000n;
}

export function totalMicroFor(args: PriceLookupArgs & { grossMicroUsdc?: bigint }): bigint {
  const cell = priceFor(args);
  const gmv = args.grossMicroUsdc
    ? gmvMicroCharge({ grossMicroUsdc: args.grossMicroUsdc, gmv: cell.gmv })
    : 0n;
  return cell.micro + gmv;
}

/** Format micro-USDC as a human-readable USDC string with 4 decimals. */
export function formatMicroUsdc(micro: bigint): string {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  return `${whole}.${frac.toString().padStart(6, '0').slice(0, 4)}`;
}
