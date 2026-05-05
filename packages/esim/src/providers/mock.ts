/**
 * Mock eSIM provider — used by tests and dev environments where real
 * provider creds aren't wired. Returns deterministic plans + LPA codes
 * so book_esim flows are exercised end-to-end without external IO.
 *
 * Pricing is set to plausible wholesale rates so the senderoTake math
 * lands in realistic ranges:
 *   - Single-country: $0.50/GB (e.g. 5GB Japan = $2.50)
 *   - Regional (≥2 countries): $0.70/GB
 *   - Global (≥10 countries): $1.20/GB
 */

import { createHash } from 'node:crypto';

import type { EsimProvider } from '../client';
import {
  EsimProviderError,
  type EsimPlan,
  type OrderArgs,
  type OrderResult,
  type QuoteArgs,
} from '../types';

const DOLLAR = 1_000_000n;

function bytesPerGB(): bigint {
  return 1024n;
}

function rateMicroPerGB(countryCount: number): bigint {
  if (countryCount >= 10) return (DOLLAR * 12n) / 10n; // $1.20
  if (countryCount >= 2) return (DOLLAR * 7n) / 10n; // $0.70
  return DOLLAR / 2n; // $0.50
}

// Tiers we surface in listPlans — covers the canonical "cheap / mid /
// heavy / unlimited" rungs so the curated WhatsApp list always gets a
// sensible shape regardless of the requested dataGb hint.
const TIER_GB = [1, 5, 10, 20, 50] as const;

export function makeMockEsimProvider(): EsimProvider {
  function planFor(args: { countries: string[]; days: number; dataGb: number }): EsimPlan {
    const dataGb = Math.max(1, Math.ceil(args.dataGb));
    const days = Math.max(1, Math.ceil(args.days));
    const rate = rateMicroPerGB(args.countries.length);
    const wholesaleMicroUsdc = rate * BigInt(dataGb);
    const label =
      args.countries.length === 1
        ? `${dataGb} GB · ${days} days · ${args.countries[0]}`
        : `${dataGb} GB · ${days} days · ${args.countries.length} countries`;
    return {
      planId: `mock_${args.countries.join('-').toLowerCase()}_${dataGb}gb_${days}d`,
      provider: 'mock',
      label,
      countries: [...args.countries],
      dataMb: dataGb * Number(bytesPerGB()),
      validityDays: days,
      wholesaleMicroUsdc,
    };
  }

  return {
    slug: 'mock',

    async quote(args: QuoteArgs): Promise<EsimPlan | null> {
      if (args.countries.length === 0) return null;
      return planFor({ countries: args.countries, days: args.days, dataGb: args.dataGb });
    },

    async listPlans(args: QuoteArgs & { limit?: number }): Promise<EsimPlan[]> {
      if (args.countries.length === 0) return [];
      const days = Math.max(1, Math.ceil(args.days));
      const limit = Math.max(1, Math.min(args.limit ?? 5, TIER_GB.length));
      return TIER_GB.slice(0, limit).map(gb =>
        planFor({ countries: args.countries, days, dataGb: gb })
      );
    },

    async order(args: OrderArgs): Promise<OrderResult> {
      if (!args.planId.startsWith('mock_')) {
        throw new EsimProviderError(
          'invalid_plan',
          `mock provider cannot order non-mock plan id: ${args.planId}`
        );
      }
      // Deterministic from idempotencyKey — re-orders return the same
      // ICCID + activation, matching real provider semantics. Hashing
      // the full key (rather than slicing the first 16 alphanum chars)
      // is critical: the previous slice landed entirely on the
      // `esim:<tenantId>` prefix, so country/days/GB never reached the
      // seed and Peru / Japan / France all produced the same row. The
      // upsert in book_esim then dropped every subsequent destination.
      const seed = createHash('sha256')
        .update(args.idempotencyKey)
        .digest('hex')
        .slice(0, 16)
        .toUpperCase();
      const padded = (seed + '0000000000000000').slice(0, 16);
      const iccid = `8910${padded}`.slice(0, 20);
      const activationCode = `MOCK-${padded}`;
      const lpaCode = `LPA:1$smdp.mock.sendero.dev$${activationCode}`;
      return {
        providerOrderId: `ord_mock_${seed}`,
        iccid,
        activationCode,
        lpaCode,
        expiresAt: null,
      };
    },
  };
}
