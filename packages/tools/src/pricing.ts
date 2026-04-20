/**
 * Per-tool pricing in USDC. Sub-cent where possible — per the
 * Agentic Economy on Arc hackathon requirement (≤ $0.01).
 *
 * Cost tiers:
 *   - Reads / RPC:            $0.0005 - $0.001
 *   - External API calls:     $0.002  (we pay a provider)
 *   - On-chain writes:        $0.003 - $0.005
 *   - Composed / expensive:   $0.008 - $0.01
 *
 * These prices are quoted in DECIMAL USDC (e.g. "0.0005" = half a
 * tenth of a cent). The meter converts to 6-decimal atomic units
 * when needed.
 */

export const TOOL_PRICING: Record<string, string> = {
  // Reads — cheap
  check_treasury: '0.0005',
  gateway_balance: '0.001',

  // External API reads (Duffel) — we pay a provider
  search_flights: '0.002',
  search_hotels: '0.002',

  // On-chain writes — one Arc tx
  send_tokens: '0.003',
  gateway_transfer: '0.003',
  swap_tokens: '0.005',
  bridge_to_arc: '0.005',

  // Composed workflows — multiple tx or API
  book_flight: '0.008',
  swap_and_bridge: '0.01',

  // Atomic 4-leg commission fan-out
  settle_split: '0.01',
};

/** USDC has 6 decimals on every chain. */
const USDC_DECIMALS = 6;

export function priceFor(toolName: string): string {
  const p = TOOL_PRICING[toolName];
  if (!p) throw new Error(`No price configured for tool: ${toolName}`);
  return p;
}

/** Decimal "0.005" → atomic "5000" (6 decimals). */
export function usdcAtomic(decimalAmount: string): bigint {
  const [whole, frac = ''] = decimalAmount.split('.');
  const padded = (frac + '0'.repeat(USDC_DECIMALS)).slice(0, USDC_DECIMALS);
  return BigInt((whole || '0') + padded);
}

/** Hackathon margin math: what would the same call cost on Ethereum
 *  mainnet at 30 gwei + $3,400 ETH? For every simple transfer:
 *    21,000 gas × 30 gwei = 0.00063 ETH × $3,400 ≈ $2.14.
 *  Per-call that's ~600-4000× more than our Arc nanopayment.
 *  This helper is used by the margin panel. */
export const ETHEREUM_MAINNET_PER_CALL_USD = 2.14;
