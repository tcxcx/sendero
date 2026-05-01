import { guestClaimLinkTool, prefundTripTool } from './guest-escrow';
import { describe, expect, test } from 'bun:test';

const ESCROW = '0x1111111111111111111111111111111111111111';
const GUEST_WALLET = '0x2222222222222222222222222222222222222222';

describe('prefunded guest escrow tools', () => {
  test('prefund_trip creates a claim link whose email code stays out-of-band', async () => {
    const result = (await prefundTripTool.handler({
      budgetUsdc: '250.50',
      require2fa: true,
      escrowAddress: ESCROW,
      linkOrigin: 'https://app.sendero.test',
      buyerName: 'Sendero QA',
      tripSummary: 'QA prefunded trip',
    })) as {
      guestLink: string;
      claimCode: string;
      codeNonce: string;
      require2fa: boolean;
      onchainCalls: Array<{ to: string; data: string; value: string }>;
    };

    expect(result.require2fa).toBe(true);
    expect(result.claimCode).toMatch(/^\d{6}$/);
    expect(result.codeNonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(result.guestLink).toStartWith('https://app.sendero.test/g#');
    expect(result.guestLink).toContain('&n=');
    expect(result.guestLink).not.toContain(result.claimCode);
    expect(result.onchainCalls.length).toBeGreaterThan(0);
  });

  test('guest_claim_link requires email code and link nonce together for 2FA claims', async () => {
    const prefund = (await prefundTripTool.handler({
      budgetUsdc: '100',
      require2fa: true,
      escrowAddress: ESCROW,
      linkOrigin: 'https://app.sendero.test',
    })) as { guestLink: string; claimCode: string; codeNonce: string };

    await expect(
      guestClaimLinkTool.handler({
        guestLink: prefund.guestLink,
        guestWallet: GUEST_WALLET,
        escrowAddress: ESCROW,
        claimCode: prefund.claimCode,
      })
    ).rejects.toThrow('claim_code_pair');

    const claim = (await guestClaimLinkTool.handler({
      guestLink: prefund.guestLink,
      guestWallet: GUEST_WALLET,
      escrowAddress: ESCROW,
      claimCode: prefund.claimCode,
      codeNonce: prefund.codeNonce,
    })) as {
      submitted: boolean;
      claimCodeProvided: boolean;
      onchainCalls: Array<{ to: string; data: string; value: string }>;
    };

    expect(claim.submitted).toBe(false);
    expect(claim.claimCodeProvided).toBe(true);
    expect(claim.onchainCalls).toHaveLength(1);
    expect(claim.onchainCalls[0]?.to.toLowerCase()).toBe(ESCROW);
  });
});
