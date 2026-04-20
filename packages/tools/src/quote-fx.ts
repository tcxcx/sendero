import { z } from 'zod';
import type { ToolDef } from './types';

/**
 * FX quote for corporate travel settlements. Returns the USDC amount
 * needed to cover a local-currency invoice. Cheap pure function with
 * an in-memory rate cache — the demo agent calls it repeatedly for
 * each hotel / ground leg price check.
 *
 * For production this would hit a real FX oracle (Chainlink,
 * ExchangeRate-API, Pyth). The hackathon version uses a frozen
 * snapshot with a small random drift so each call returns a slightly
 * different rate, mimicking live quotes.
 */

const SNAPSHOT: Record<string, number> = {
  // 1 USD = X local currency
  USD: 1,
  USDC: 1,
  MXN: 17.22,
  BRL: 5.01,
  ARS: 1185.5,
  COP: 3950.0,
  PEN: 3.72,
  CLP: 935.0,
  EUR: 0.92,
  GBP: 0.78,
  KES: 130.0,
  INR: 83.8,
  IDR: 15850.0,
};

function drift(base: number): number {
  // ±0.15% random drift so each quote is unique.
  return base * (1 + (Math.random() - 0.5) * 0.003);
}

const inputSchema = z.object({
  fromCurrency: z.string().describe('ISO 4217 code of the local currency on the invoice.'),
  toCurrency: z.enum(['USDC', 'USD', 'EURC']).describe('Settlement currency (USDC / USD / EURC).'),
  amount: z.number().describe('Local-currency amount to convert.'),
});

export const quoteFxTool: ToolDef = {
  name: 'quote_fx',
  description:
    'FX quote for cross-currency settlements. Pass local-currency price, get the USDC (or EURC) equivalent. Use before any off-USD booking.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['fromCurrency', 'toCurrency', 'amount'],
    properties: {
      fromCurrency: { type: 'string' },
      toCurrency: { type: 'string', enum: ['USDC', 'USD', 'EURC'] },
      amount: { type: 'number' },
    },
  },
  async handler(input: any) {
    const from = String(input.fromCurrency).toUpperCase();
    const to = String(input.toCurrency).toUpperCase();
    const fromRate = SNAPSHOT[from];
    const toRate = to === 'USDC' || to === 'USD' ? 1 : to === 'EURC' ? (SNAPSHOT.EUR ?? 1) : 1;
    if (!fromRate) {
      return { error: `unsupported_currency: ${from}` };
    }
    const usd = input.amount / drift(fromRate);
    const settlementAmount = usd * drift(toRate);
    return {
      fromCurrency: from,
      toCurrency: to,
      amount: input.amount,
      quote: Number(settlementAmount.toFixed(6)),
      usdMid: Number(usd.toFixed(6)),
      spreadBps: 15,
      validForSeconds: 30,
    };
  },
};
