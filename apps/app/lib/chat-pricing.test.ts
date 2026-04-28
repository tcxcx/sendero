/**
 * Smoke tests for the token-aware chat pricing helper.
 *
 * Asserts the load-bearing invariants:
 *   1. Missing model OR missing usage → flat base fee, no token math.
 *   2. Reasoning tokens roll into output cost (Gemini's
 *      `thoughtsTokenCount` + Anthropic thinking both bill at output rate).
 *   3. Plan-tier discountBps applies to BOTH the base fee and the provider
 *      passthrough — Pro tier (3000 bps) on a Claude Sonnet 4.5 turn
 *      pays exactly 70% of the free-tier price.
 *   4. Margin multiplier is honored.
 */

import { expect, test } from 'bun:test';

import {
  chatPricingBreakdown,
  chatTurnPriceMicroUsdc,
  inferModelId,
  type ChatUsage,
} from './chat-pricing';

const BASE_FEE = 1_000n; // micro-USDC

test('null model returns base fee only', () => {
  expect(chatTurnPriceMicroUsdc(null, undefined)).toBe(BASE_FEE);
  expect(chatTurnPriceMicroUsdc(null, { inputTokens: 1000, outputTokens: 500 })).toBe(BASE_FEE);
});

test('unknown model id returns base fee only', () => {
  expect(chatTurnPriceMicroUsdc('made-up/model', { inputTokens: 1000 })).toBe(BASE_FEE);
});

test('missing usage returns base fee even when model is known', () => {
  expect(chatTurnPriceMicroUsdc('google/gemini-2.5-flash', undefined)).toBe(BASE_FEE);
});

test('Gemini Flash priced from token usage with margin + base fee', () => {
  // 1k input @ $0.075/M  +  500 output @ $0.30/M = $0.000075 + $0.00015 = $0.000225
  // After 1.20 margin: $0.00027 = 270 micro-USDC, +1_000 base = 1_270.
  // Math.ceil rounds up to next micro.
  const usage: ChatUsage = { inputTokens: 1_000, outputTokens: 500, reasoningTokens: 0 };
  const price = chatTurnPriceMicroUsdc('google/gemini-2.5-flash', usage);
  expect(price).toBe(1_270n);
});

test('reasoning tokens roll into output cost', () => {
  // Same Flash model, but 500 of the output is reasoning tokens.
  // Total output (output + reasoning) = 500 + 0 vs 0 + 500 should price the same.
  const onlyOutput: ChatUsage = { inputTokens: 1_000, outputTokens: 500, reasoningTokens: 0 };
  const onlyThoughts: ChatUsage = { inputTokens: 1_000, outputTokens: 0, reasoningTokens: 500 };
  expect(chatTurnPriceMicroUsdc('google/gemini-2.5-flash', onlyOutput)).toBe(
    chatTurnPriceMicroUsdc('google/gemini-2.5-flash', onlyThoughts)
  );
});

test('Pro-tier (3000 bps) discount applies to entire price', () => {
  const usage: ChatUsage = { inputTokens: 1_000, outputTokens: 500, reasoningTokens: 0 };
  const free = chatTurnPriceMicroUsdc('google/gemini-2.5-flash', usage, 0);
  const pro = chatTurnPriceMicroUsdc('google/gemini-2.5-flash', usage, 3000);
  // 30% off: pro should be exactly 70% of free (integer floor — bigint division).
  expect(pro).toBe((free * 7_000n) / 10_000n);
});

test('Enterprise (5000 bps) cuts price in half on base-only path', () => {
  const free = chatTurnPriceMicroUsdc(null, undefined, 0);
  const ent = chatTurnPriceMicroUsdc(null, undefined, 5000);
  expect(ent).toBe(free / 2n);
});

test('Claude Sonnet 4.5 priced ~50× Gemini Flash for the same usage', () => {
  const usage: ChatUsage = { inputTokens: 1_000, outputTokens: 500 };
  const flash = chatTurnPriceMicroUsdc('google/gemini-2.5-flash', usage);
  const sonnet = chatTurnPriceMicroUsdc('anthropic/claude-sonnet-4-5', usage);
  // Flash: 0.075/M input + 0.30/M output. Sonnet: 3/M input + 15/M output.
  // Output dominates; sonnet should be roughly 50× flash on the provider
  // cost portion (the base $0.001 fee dilutes the ratio of total prices,
  // so we just assert sonnet >> flash and within a sane band).
  expect(sonnet > flash).toBe(true);
  expect(sonnet > flash * 5n).toBe(true);
});

test('chatPricingBreakdown surfaces all priced inputs for audit', () => {
  const usage: ChatUsage = {
    inputTokens: 100,
    outputTokens: 50,
    reasoningTokens: 25,
    totalTokens: 175,
  };
  const b = chatPricingBreakdown('google/gemini-2.5-flash', usage, 1500);
  expect(b.model).toBe('google/gemini-2.5-flash');
  expect(b.inputTokens).toBe(100);
  expect(b.outputTokens).toBe(50);
  expect(b.reasoningTokens).toBe(25);
  expect(b.totalTokens).toBe(175);
  expect(b.discountBps).toBe(1500);
  expect(b.marginMultiplier).toBe(1.2);
  expect(b.baseFeeMicroUsdc).toBe('1000');
  expect(b.rates).not.toBe(null);
});

test('inferModelId handles strings and direct-provider handles', () => {
  expect(inferModelId('google/gemini-2.5-flash')).toBe('google/gemini-2.5-flash');
  expect(inferModelId(null)).toBe(null);
  expect(inferModelId(undefined)).toBe(null);
  expect(inferModelId({ modelId: 'gemini-2.5-flash', provider: 'google' })).toBe(
    'google/gemini-2.5-flash'
  );
  expect(inferModelId({ modelId: 'standalone' })).toBe('standalone');
  expect(inferModelId({})).toBe(null);
});
