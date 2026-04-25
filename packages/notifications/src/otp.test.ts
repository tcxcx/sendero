import { describe, expect, it } from 'bun:test';
import { generateOtpPreimage, otpClaimCodeHash, selectOtpChannel } from './otp';

describe('generateOtpPreimage', () => {
  it('returns a 13-character cleartext in 4-4-5 hyphen-grouped form', () => {
    const otp = generateOtpPreimage();
    // Two hyphens + 13 alphabet chars = 15 chars total
    expect(otp.length).toBe(15);
    expect(otp[4]).toBe('-');
    expect(otp[9]).toBe('-');
    const groups = otp.split('-');
    expect(groups.length).toBe(3);
    expect(groups[0]!.length).toBe(4);
    expect(groups[1]!.length).toBe(4);
    expect(groups[2]!.length).toBe(5);
  });

  it('uses only the Crockford base32 alphabet (no 0/O/1/I)', () => {
    const allowed = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789-]+$/;
    for (let i = 0; i < 200; i++) {
      const otp = generateOtpPreimage();
      expect(allowed.test(otp)).toBe(true);
      // Belt-and-suspenders: the easily-confused glyphs 0/O/1/I are
      // out. (L stays — it's in the design-doc alphabet at position
      // 11, between K and M.)
      expect(/[0O1I]/.test(otp)).toBe(false);
    }
  });

  it('has no duplicates across 1000 calls (entropy sanity)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateOtpPreimage());
    }
    expect(seen.size).toBe(1000);
  });
});

describe('otpClaimCodeHash', () => {
  const tripId = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
  const otherTripId = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;

  it('produces a deterministic 0x-prefixed bytes32 for a fixed (tripId, preimage)', () => {
    const a = otpClaimCodeHash(tripId, 'K8N4-7XM2-PQ3WR');
    const b = otpClaimCodeHash(tripId, 'K8N4-7XM2-PQ3WR');
    expect(a).toBe(b);
    expect(a.startsWith('0x')).toBe(true);
    expect(a.length).toBe(66); // 0x + 64 hex chars
  });

  it('produces a different hash when only the preimage changes', () => {
    const a = otpClaimCodeHash(tripId, 'AAAA-BBBB-CCCCC');
    const b = otpClaimCodeHash(tripId, 'AAAA-BBBB-CCCCD');
    expect(a).not.toBe(b);
  });

  it('produces a different hash for the same preimage across tripIds (cross-trip replay defense)', () => {
    const preimage = 'K8N4-7XM2-PQ3WR';
    const a = otpClaimCodeHash(tripId, preimage);
    const b = otpClaimCodeHash(otherTripId, preimage);
    expect(a).not.toBe(b);
  });
});

describe('selectOtpChannel', () => {
  const tripId = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;

  it('prefers WhatsApp when both phone+email available + linkChannel=email', () => {
    const channel = selectOtpChannel({
      tripId,
      guestVerifiedContacts: { phone: '+12025551234', email: 'g@example.com' },
      linkChannel: 'email',
      tenantPolicy: { requireDifferentChannelForOtp: true },
    });
    expect(channel).toBe('whatsapp');
  });

  it('falls back to the same channel as link when guest only has one contact', () => {
    const channel = selectOtpChannel({
      tripId,
      guestVerifiedContacts: { email: 'g@example.com' },
      linkChannel: 'email',
      tenantPolicy: { requireDifferentChannelForOtp: true },
    });
    // Policy wants different, but email is the only thing available — degrade gracefully.
    expect(channel).toBe('email');
  });

  it('returns null when no contacts at all', () => {
    const channel = selectOtpChannel({
      tripId,
      guestVerifiedContacts: {},
      linkChannel: 'email',
      tenantPolicy: { requireDifferentChannelForOtp: true },
    });
    expect(channel).toBeNull();
  });

  it('honors policy=false by returning the highest-priority available channel even if it matches linkChannel', () => {
    const channel = selectOtpChannel({
      tripId,
      guestVerifiedContacts: { phone: '+12025551234', email: 'g@example.com' },
      linkChannel: 'whatsapp',
      tenantPolicy: { requireDifferentChannelForOtp: false },
    });
    // No diff-channel constraint → priority order wins → whatsapp.
    expect(channel).toBe('whatsapp');
  });

  it('skips link channel and picks next priority when policy demands different and a match exists', () => {
    const channel = selectOtpChannel({
      tripId,
      guestVerifiedContacts: { phone: '+12025551234', email: 'g@example.com' },
      linkChannel: 'whatsapp',
      tenantPolicy: { requireDifferentChannelForOtp: true },
    });
    // whatsapp ruled out → sms next (phone present) → returns sms.
    expect(channel).toBe('sms');
  });
});
