import {
  buildSingleTransferExecuteData,
  buildTransferCallData,
  buildTransferWithFeeExecuteData,
} from '../transfer';
import { describe, expect, test } from 'bun:test';

describe('buildTransferCallData', () => {
  test('returns hex starting with transfer selector 0xa9059cbb', () => {
    const data = buildTransferCallData({
      tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1_000_000n,
    });
    expect(data).toMatch(/^0x/);
    expect(data.slice(0, 10)).toBe('0xa9059cbb');
  });

  test('encodes recipient address', () => {
    const data = buildTransferCallData({
      tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1_000_000n,
    });
    expect(data.toLowerCase()).toContain('742d35cc6634c0532925a3b844bc9e7595f2bd18');
  });
});

describe('buildSingleTransferExecuteData', () => {
  test('wraps transfer in execute() call', () => {
    const data = buildSingleTransferExecuteData({
      tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1_000_000n,
    });
    expect(data).toMatch(/^0x/);
    // execute(address,uint256,bytes) selector = 0xb61d27f6
    expect(data.slice(0, 10)).toBe('0xb61d27f6');
  });
});

describe('buildTransferWithFeeExecuteData', () => {
  test('with zero fee falls back to single execute', () => {
    const data = buildTransferWithFeeExecuteData({
      tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1_000_000n,
      feeRecipient: '0x0000000000000000000000000000000000000001',
      feeAmount: 0n,
    });
    expect(data.slice(0, 10)).toBe('0xb61d27f6');
  });

  test('with non-zero fee uses executeBatch', () => {
    const data = buildTransferWithFeeExecuteData({
      tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
      to: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      amount: 1_000_000n,
      feeRecipient: '0x0000000000000000000000000000000000000001',
      feeAmount: 10_000n,
    });
    expect(data).toMatch(/^0x/);
    // executeBatch selector = 0x34fcd5be
    expect(data.slice(0, 10)).toBe('0x34fcd5be');
  });
});
