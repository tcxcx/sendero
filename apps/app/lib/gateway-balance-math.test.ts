import { describe, expect, test } from 'bun:test';

import {
  calculateGatewayBalanceTotals,
  decimalUsdcToMicro,
  microUsdcToDecimal,
} from './gateway-balance-math';

describe('gateway balance math', () => {
  test('keeps Solana Gateway balance out of spendable totals', () => {
    const totals = calculateGatewayBalanceTotals({
      perDomain: [
        { domain: 26, balance: '10.000000' },
        { domain: 3, balance: '2.500000' },
        { domain: 5, balance: '7.250000' },
      ],
      pendingCredits: [
        { domain: 26, amount: '1000000' },
        { domain: 5, amount: '2000000' },
      ],
      opsStaging: [
        { chain: 'ARC-TESTNET', usdc: '3000000' },
        { chain: 'SOL-DEVNET', usdc: '4000000' },
      ],
    });

    expect(microUsdcToDecimal(totals.availableMicro)).toBe('19.750000');
    expect(microUsdcToDecimal(totals.spendableAvailableMicro)).toBe('12.500000');
    expect(microUsdcToDecimal(totals.unsupportedSourceMicro)).toBe('7.250000');
    expect(microUsdcToDecimal(totals.grandTotalMicro)).toBe('29.750000');
    expect(microUsdcToDecimal(totals.spendableTotalMicro)).toBe('16.500000');
  });

  test('parses and formats six-decimal USDC exactly', () => {
    expect(decimalUsdcToMicro('98.366900')).toBe(98_366_900n);
    expect(decimalUsdcToMicro('0.01')).toBe(10_000n);
    expect(microUsdcToDecimal(98_366_900n)).toBe('98.366900');
  });
});
