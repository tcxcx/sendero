/**
 * Circle Gateway x402 discovery — single source of chain catalog.
 *
 * Sendero advertises payment requirements for every network the facilitator
 * supports, sourced from:
 *
 *   GET {CIRCLE_GATEWAY_FACILITATOR_URL}/v1/x402/supported
 *
 * Each kind in the response is one (network, asset, verifyingContract,
 * minValiditySeconds) tuple. We cache the result so we hit the facilitator
 * at most once per `CACHE_TTL_MS`; transient fetch failures fall back to
 * the last good snapshot so the edge worker never 500s on a Circle blip.
 *
 * Flip mainnet by changing one env var. Discovery automatically returns
 * the mainnet kinds, the middleware advertises them, no hardcoded chain
 * constants anywhere.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export interface X402SupportedKindAsset {
  symbol: string;
  /** Token contract address (lowercase, hex). */
  address: string;
  decimals: number;
}

export interface X402SupportedKind {
  x402Version: 2;
  scheme: 'exact';
  /** CAIP-2 network identifier, e.g. `eip155:5042002`. */
  network: string;
  extra: {
    /** Contract name for EIP-712 signing. */
    name: string;
    version: string;
    /** GatewayWallet contract address (the EIP-712 verifyingContract). */
    verifyingContract: string;
    /** Floor for the buyer's EIP-3009 `validBefore` window, in seconds. */
    minValiditySeconds: number;
    assets: X402SupportedKindAsset[];
  };
}

interface CacheEntry {
  kinds: X402SupportedKind[];
  fetchedAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<X402SupportedKind[]> | null = null;

/**
 * Returns the supported kinds, cached for `CACHE_TTL_MS`. If discovery
 * fails and we have a stale snapshot, the stale snapshot wins — better
 * than failing closed on a Circle facilitator outage.
 */
export async function getSupportedKinds(facilitatorUrl: string): Promise<X402SupportedKind[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.kinds;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${facilitatorUrl}/v1/x402/supported`);
      if (!res.ok) {
        throw new Error(`circle x402 discovery ${res.status}: ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as { kinds?: X402SupportedKind[] };
      if (!body.kinds?.length) throw new Error('circle x402 discovery returned empty kinds');
      cache = { kinds: body.kinds, fetchedAt: Date.now() };
      return body.kinds;
    } catch (err) {
      if (cache) {
        console.warn(
          `[x402-discovery] using stale cache after fetch failure: ${(err as Error).message}`
        );
        return cache.kinds;
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Test hook only — never call from production code paths. */
export function _resetCacheForTests(): void {
  cache = null;
  inFlight = null;
}
