import { TREASURY_TEMPLATE_CONFIGS } from '../templates';
import {
  buildBatchInstallCalls,
  buildOperationsWalletUserOp,
  buildTreasurySetupUserOp,
  encodeLimitToTokenDecimals,
} from '../userop-builder';
import { describe, expect, test } from 'bun:test';

describe('encodeLimitToTokenDecimals', () => {
  test('$5000 USD with 6 decimals = 5_000_000_000n', () => {
    expect(encodeLimitToTokenDecimals(5_000, 6)).toBe(5_000_000_000n);
  });
  test('$200 USD with 6 decimals = 200_000_000n', () => {
    expect(encodeLimitToTokenDecimals(200, 6)).toBe(200_000_000n);
  });
  test('$0 returns 0n', () => {
    expect(encodeLimitToTokenDecimals(0, 6)).toBe(0n);
  });
  test('$1 with 18 decimals', () => {
    expect(encodeLimitToTokenDecimals(1, 18)).toBe(1_000_000_000_000_000_000n);
  });
});

describe('workspace wallet builders', () => {
  const walletAddress = '0x6666666666666666666666666666666666666666' as `0x${string}`;
  const publicKey =
    '0x2caa86454963544bbc964f29979ddb953395f1baa9b123b1edb6ed1109bf0cb2ce91893a28a0f9f0c6b85edf44b01e95d46a39eeeab45a0b2583c05cb6414904';
  const usdcAddress = '0x7777777777777777777777777777777777777777' as `0x${string}`;

  test('operations wallet bootstraps multisig and installs cold-storage address book', () => {
    const built = buildOperationsWalletUserOp({
      template: TREASURY_TEMPLATE_CONFIGS.solo_freelancer,
      signers: [{ type: 'passkey', weight: 1000, credentialId: 'cred-ops', publicKey }],
      tier: 'basic',
      walletAddress,
      usdcAddress,
    });

    expect(built.modules).toEqual(['weighted_multisig', 'address_book']);
    expect(built.calls.length).toBe(2);
  });

  test('treasury wallet bootstraps multisig and installs cold-storage address book', () => {
    const built = buildTreasurySetupUserOp({
      template: TREASURY_TEMPLATE_CONFIGS.startup,
      signers: [
        {
          credential: { publicKey },
          role: 'owner',
          weight: 500,
        },
      ],
      tier: 'standard',
      chain: 'ARB-SEPOLIA',
      walletAddress,
      usdcAddress,
    });

    expect(built.modules).toEqual(['weighted_multisig', 'address_book']);
    expect(built.calls.length).toBe(2);
  });
});

describe('buildBatchInstallCalls', () => {
  const mockAddresses = {
    weightedMultisig: '0x1111111111111111111111111111111111111111' as `0x${string}`,
    addressBook: '0x2222222222222222222222222222222222222222' as `0x${string}`,
    usdc: '0x5555555555555555555555555555555555555555' as `0x${string}`,
  };
  const walletAddress = '0x3333333333333333333333333333333333333333' as `0x${string}`;
  const publicKey =
    '0x2caa86454963544bbc964f29979ddb953395f1baa9b123b1edb6ed1109bf0cb2ce91893a28a0f9f0c6b85edf44b01e95d46a39eeeab45a0b2583c05cb6414904';

  test('solo_freelancer produces 1 call (multisig only, basic tier)', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.solo_freelancer;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [{ type: 'passkey', weight: 1000, credentialId: 'cred-1', publicKey }],
      tier: 'basic',
      walletAddress,
      addresses: mockAddresses,
      tokenDecimals: 6,
    });
    expect(calls.length).toBe(1); // bootstrap multisig re-weight only
  });

  test('import_export with enhanced tier re-weights multisig and installs address book', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.import_export;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [{ type: 'passkey', weight: 500, credentialId: 'cred-1', publicKey }],
      tier: 'enhanced',
      walletAddress,
      addresses: mockAddresses,
      tokenDecimals: 6,
    });
    expect(calls.length).toBe(2);
    expect(calls[1]?.data.startsWith('0xf85730f4')).toBe(true); // installPlugin selector
  });

  test('maximum tier on a non-address-book template still installs address book', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.agency;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [{ type: 'passkey', weight: 700, credentialId: 'cred-1', publicKey }],
      tier: 'maximum',
      walletAddress,
      addresses: mockAddresses,
      tokenDecimals: 6,
    });
    expect(calls.length).toBe(2);
    expect(calls[1]?.data.startsWith('0xf85730f4')).toBe(true);
  });

  test('each call targets the wallet itself and has calldata', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.startup;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [{ type: 'passkey', weight: 500, credentialId: 'cred-1', publicKey }],
      tier: 'standard',
      walletAddress,
      addresses: mockAddresses,
      tokenDecimals: 6,
    });
    for (const call of calls) {
      expect(call.target).toBe(walletAddress);
      expect(call.data).toMatch(/^0x/);
      expect(call.value).toBe(0n);
    }
  });

  test('initial allowlist is encoded into the install call data', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.import_export;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [{ type: 'passkey', weight: 500, credentialId: 'cred-1', publicKey }],
      tier: 'enhanced',
      walletAddress,
      initialAllowlist: [
        '0x4444444444444444444444444444444444444444',
        '0x5555555555555555555555555555555555555555',
      ] as `0x${string}`[],
      addresses: mockAddresses,
      tokenDecimals: 6,
    });

    expect(calls.length).toBe(2);
    const installCall = calls[1]!;
    expect(installCall.target).toBe(walletAddress);
    expect(installCall.data.toLowerCase()).toContain('4444444444444444444444444444444444444444');
    expect(installCall.data.toLowerCase()).toContain('5555555555555555555555555555555555555555');
  });

  test('EOA bootstrap signers update owner weights through address owners', () => {
    const config = TREASURY_TEMPLATE_CONFIGS.solo_freelancer;
    const calls = buildBatchInstallCalls({
      template: config,
      signers: [
        {
          type: 'eoa',
          weight: 1000,
          address: '0x4444444444444444444444444444444444444444',
        },
      ],
      tier: 'basic',
      walletAddress,
      addresses: mockAddresses,
      tokenDecimals: 6,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.data).toContain('4444444444444444444444444444444444444444');
  });
});
