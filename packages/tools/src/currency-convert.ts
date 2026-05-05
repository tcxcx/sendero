/**
 * currency_convert — convert an amount between two ISO-4217 currencies
 * using ECB reference rates from the Frankfurter API.
 *
 * Free, no auth, ECB-sourced. Rates change once daily (~16:00 CET).
 * In-memory TTL cache keeps repeat conversions in the same Fluid
 * Compute instance from re-hitting the wire.
 *
 * Public read-only — not a privileged tool. Safe to expose to all
 * channels (WhatsApp / Slack / web / MCP).
 */

import { z } from 'zod';

import type { ToolDef } from './types';

const ISO_4217 = /^[A-Z]{3}$/;

const inputSchema = z.object({
  amount: z.number().finite().nonnegative(),
  from: z
    .string()
    .regex(ISO_4217, 'Currency code must be 3 uppercase letters (ISO 4217)')
    .transform(s => s.toUpperCase()),
  to: z
    .string()
    .regex(ISO_4217, 'Currency code must be 3 uppercase letters (ISO 4217)')
    .transform(s => s.toUpperCase()),
  /** YYYY-MM-DD; omit for latest. */
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be YYYY-MM-DD')
    .optional(),
});

export type CurrencyConvertInput = z.infer<typeof inputSchema>;

export interface CurrencyConvertResult {
  converted: number;
  rate: number;
  from: string;
  to: string;
  /** ECB publication date used for the rate (YYYY-MM-DD). */
  rateDate: string;
  source: 'frankfurter-ecb';
  fetchedAt: string;
  /** True when the conversion is identity (from === to). */
  identity: boolean;
}

interface FrankfurterResponse {
  amount: number;
  base: string;
  date: string;
  rates: Record<string, number>;
}

interface CacheEntry {
  result: { rate: number; rateDate: string };
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1h
const cache = new Map<string, CacheEntry>();

function cacheKey(from: string, to: string, asOf?: string): string {
  return `${from}:${to}:${asOf ?? 'latest'}`;
}

function readCache(key: string): CacheEntry['result'] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function writeCache(key: string, result: CacheEntry['result']): void {
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function currencyConvert(
  input: CurrencyConvertInput
): Promise<CurrencyConvertResult> {
  const fetchedAt = new Date().toISOString();
  const { amount, from, to, asOf } = input;

  if (from === to) {
    return {
      converted: amount,
      rate: 1,
      from,
      to,
      rateDate: asOf ?? new Date().toISOString().slice(0, 10),
      source: 'frankfurter-ecb',
      fetchedAt,
      identity: true,
    };
  }

  const key = cacheKey(from, to, asOf);
  const cached = readCache(key);
  if (cached) {
    return {
      converted: round2(amount * cached.rate),
      rate: cached.rate,
      from,
      to,
      rateDate: cached.rateDate,
      source: 'frankfurter-ecb',
      fetchedAt,
      identity: false,
    };
  }

  const path = asOf ? asOf : 'latest';
  const url = `https://api.frankfurter.dev/v1/${path}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `currency_convert: Frankfurter API ${response.status} ${response.statusText}`
    );
  }
  const data = (await response.json()) as FrankfurterResponse;
  const rate = data.rates?.[to];
  if (typeof rate !== 'number' || !Number.isFinite(rate)) {
    throw new Error(
      `currency_convert: no rate returned for ${from}->${to} on ${data.date ?? path}`
    );
  }

  writeCache(key, { rate, rateDate: data.date });

  return {
    converted: round2(amount * rate),
    rate,
    from,
    to,
    rateDate: data.date,
    source: 'frankfurter-ecb',
    fetchedAt,
    identity: false,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Test-only — exported to let the suite reset state between runs. */
export function _resetCurrencyCache(): void {
  cache.clear();
}

export const currencyConvertTool: ToolDef<CurrencyConvertInput, CurrencyConvertResult> = {
  name: 'currency_convert',
  description:
    'Convert an amount between two ISO-4217 currencies using ECB reference rates (via Frankfurter). Use this when the user asks "how much is X in Y?" or needs price comparisons across currencies. Pass `asOf` (YYYY-MM-DD) for historical rates; omit for latest. Identity conversions (from===to) return the amount unchanged with rate=1.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['amount', 'from', 'to'],
    properties: {
      amount: { type: 'number', minimum: 0 },
      from: { type: 'string', pattern: '^[A-Z]{3}$', description: 'ISO 4217 currency code' },
      to: { type: 'string', pattern: '^[A-Z]{3}$', description: 'ISO 4217 currency code' },
      asOf: {
        type: 'string',
        pattern: '^\\d{4}-\\d{2}-\\d{2}$',
        description: 'YYYY-MM-DD — omit for latest published rate',
      },
    },
  },
  handler: currencyConvert,
};
