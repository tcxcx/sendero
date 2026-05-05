/**
 * Provider resolution. Single source of truth for which concrete
 * `EsimProvider` `book_esim` runs against AND which order mode
 * (validate vs transaction) it operates in.
 *
 * Resale model — IMPORTANT:
 *
 *   Sendero owns the eSIM Go organisation (FANTASMITA LLC, org 62178).
 *   Tenants (travel agencies, corporate travel offices) resell the
 *   inventory we already own. They don't manage eSIM Go credentials,
 *   webhooks, or balance — they just configure their agency markup
 *   via `TenantPricingPolicy.markupConfig.esim`. Sendero's prepaid
 *   balance funds every order; we charge the tenant (or traveler,
 *   per `Trip.paymentMode`) at retail through the existing
 *   `confirm_booking` settlement legs.
 *
 *   So: one `ESIM_GO_API_KEY`. One webhook signing path. One balance.
 *
 *   (If a big enterprise tenant ever needs to bring their own eSIM Go
 *   account — multi-org white-label — that's a future option. For
 *   now we don't carry the credential-lookup complexity.)
 *
 * Order-mode resolution:
 *
 *   ESIM_GO_MODE=validate    → validate-only (no balance debits)
 *   ESIM_GO_MODE=transaction → real orders, real money
 *   default                  → 'validate' in dev/preview, 'transaction'
 *                              in production
 *
 *   Rationale: every preview deployment behind ngrok exercises the real
 *   eSIM Go API + real validation responses (bundle existence, country
 *   eligibility) without burning Sendero's prepaid balance. Production
 *   (Vercel `production` env) gets the real transaction path.
 */

import type { EsimProvider } from './client';
import { makeEsimGoProvider } from './providers/esim-go';
import { makeMockEsimProvider } from './providers/mock';

export interface ResolveEsimProviderEnv {
  ESIM_PROVIDER?: string;
  ESIM_GO_API_KEY?: string;
  ESIM_GO_BASE_URL?: string;
  /** 'validate' | 'transaction'; see module docstring for default. */
  ESIM_GO_MODE?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export type EsimGoMode = 'validate' | 'transaction';

export function resolveEsimGoMode(env: ResolveEsimProviderEnv = process.env): EsimGoMode {
  const isProd = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';

  // PRODUCTION GUARD — validate mode is a dev/preview convenience that
  // skips real settlement and tolerates `valid: false` from eSIM Go (a
  // signal that often just means "balance < subTotal"). In production
  // we MUST commit real orders. Reject `ESIM_GO_MODE=validate` if it
  // ever leaks into a prod deployment, log loudly, force transaction.
  const explicit = env.ESIM_GO_MODE?.toLowerCase();
  if (isProd && explicit === 'validate') {
    console.error(
      '[@sendero/esim] ESIM_GO_MODE=validate set in production; ignoring and forcing transaction. ' +
        'Validate-only mode is dev/preview ONLY — production must commit real eSIM Go orders.'
    );
    return 'transaction';
  }

  if (explicit === 'validate') return 'validate';
  if (explicit === 'transaction') return 'transaction';
  // Default — production hits real money; everywhere else (dev,
  // preview, ngrok, CI) runs validate-only against the live API.
  return isProd ? 'transaction' : 'validate';
}

export function resolveEsimProvider(env: ResolveEsimProviderEnv = process.env): EsimProvider {
  if (env.ESIM_PROVIDER === 'mock') return makeMockEsimProvider();

  if (env.ESIM_GO_API_KEY) {
    return makeEsimGoProvider({
      apiKey: env.ESIM_GO_API_KEY,
      ...(env.ESIM_GO_BASE_URL ? { baseUrl: env.ESIM_GO_BASE_URL } : {}),
      validateOnly: resolveEsimGoMode(env) === 'validate',
    });
  }

  // No API key set — fall back to mock with a console warning so
  // dev/preview deployments surface the misconfig rather than no-op
  // silently. Production WITHOUT a key is a misconfig — book_esim
  // surfaces an actionable error to the agent at call time.
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    console.warn('[@sendero/esim] No ESIM_GO_API_KEY in production; falling back to mock.');
  }
  return makeMockEsimProvider();
}
