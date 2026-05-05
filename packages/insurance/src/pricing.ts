/**
 * PARKED — see packages/insurance/package.json header.
 *
 * Provider resolution. Mirrors `@sendero/esim`'s shape so the resale
 * model + dev-vs-prod gate are identical.
 */

import type { InsuranceProvider } from './client';
import { makeFayeProvider } from './providers/faye';
import { makeMockInsuranceProvider } from './providers/mock';

export interface ResolveInsuranceProviderEnv {
  INSURANCE_PROVIDER?: string;
  FAYE_API_KEY?: string;
  FAYE_BASE_URL?: string;
  FAYE_MODE?: string;
  NODE_ENV?: string;
  VERCEL_ENV?: string;
}

export type FayeMode = 'quote' | 'transaction';

export function resolveFayeMode(env: ResolveInsuranceProviderEnv = process.env): FayeMode {
  const isProd = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production';
  const explicit = env.FAYE_MODE?.toLowerCase();
  if (isProd && explicit === 'quote') {
    console.error(
      '[@sendero/insurance] FAYE_MODE=quote set in production; ignoring and forcing transaction.'
    );
    return 'transaction';
  }
  if (explicit === 'quote') return 'quote';
  if (explicit === 'transaction') return 'transaction';
  return isProd ? 'transaction' : 'quote';
}

export function resolveInsuranceProvider(
  env: ResolveInsuranceProviderEnv = process.env
): InsuranceProvider {
  if (env.INSURANCE_PROVIDER === 'mock') return makeMockInsuranceProvider();
  if (env.FAYE_API_KEY) {
    return makeFayeProvider({
      apiKey: env.FAYE_API_KEY,
      ...(env.FAYE_BASE_URL ? { baseUrl: env.FAYE_BASE_URL } : {}),
    });
  }
  if (env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production') {
    console.warn('[@sendero/insurance] No FAYE_API_KEY in production; falling back to mock.');
  }
  return makeMockInsuranceProvider();
}
