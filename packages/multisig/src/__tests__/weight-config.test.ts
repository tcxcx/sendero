import { calculateThresholdForTreasury, getWeightForRole, WEIGHT_PRESETS } from '../weight-config';
import { describe, expect, it } from 'bun:test';

describe('WEIGHT_PRESETS', () => {
  it('has all three wallet roles defined', () => {
    expect(WEIGHT_PRESETS).toHaveProperty('personal');
    expect(WEIGHT_PRESETS).toHaveProperty('team');
    expect(WEIGHT_PRESETS).toHaveProperty('treasury');
  });

  describe('personal preset', () => {
    it('has owner weight of 1', () => {
      expect(WEIGHT_PRESETS.personal.ownerWeights).toEqual({ owner: 1 });
    });

    it('has threshold of 1 (single signature)', () => {
      expect(WEIGHT_PRESETS.personal.defaultThreshold).toBe(1);
    });

    it('includes weighted_multisig module', () => {
      expect(WEIGHT_PRESETS.personal.modules).toEqual(['weighted_multisig']);
    });
  });

  describe('team preset', () => {
    it('has admin weight of 100 and member weight of 50', () => {
      expect(WEIGHT_PRESETS.team.ownerWeights).toEqual({ admin: 100, member: 50 });
    });

    it('has threshold of 100 (1 admin OR 2 members)', () => {
      expect(WEIGHT_PRESETS.team.defaultThreshold).toBe(100);
    });

    it('includes weighted_multisig module', () => {
      expect(WEIGHT_PRESETS.team.modules).toEqual(['weighted_multisig']);
    });
  });

  describe('treasury preset', () => {
    it('has owner weight of 100', () => {
      expect(WEIGHT_PRESETS.treasury.ownerWeights).toEqual({ owner: 100 });
    });

    it('has default threshold of 200', () => {
      expect(WEIGHT_PRESETS.treasury.defaultThreshold).toBe(200);
    });

    it('includes weighted_multisig and address_book (address book compatible)', () => {
      expect(WEIGHT_PRESETS.treasury.modules).toEqual(['weighted_multisig', 'address_book']);
    });
  });
});

describe('getWeightForRole', () => {
  describe('personal wallet', () => {
    it('returns 1 for owner role', () => {
      expect(getWeightForRole('personal', 'owner')).toBe(1);
    });

    it('falls back to 50 for admin (no admin weight, no member weight defined)', () => {
      expect(getWeightForRole('personal', 'admin')).toBe(50);
    });

    it('falls back to 50 for member (no member weight defined)', () => {
      expect(getWeightForRole('personal', 'member')).toBe(50);
    });
  });

  describe('team wallet', () => {
    it('returns 100 for admin role', () => {
      expect(getWeightForRole('team', 'admin')).toBe(100);
    });

    it('returns 50 for member role', () => {
      expect(getWeightForRole('team', 'member')).toBe(50);
    });

    it('falls back to member weight (50) for owner role', () => {
      expect(getWeightForRole('team', 'owner')).toBe(50);
    });
  });

  describe('treasury wallet', () => {
    it('returns 100 for owner role', () => {
      expect(getWeightForRole('treasury', 'owner')).toBe(100);
    });

    it('falls back to 50 for admin (no admin weight, no member weight)', () => {
      expect(getWeightForRole('treasury', 'admin')).toBe(50);
    });

    it('falls back to 50 for member (no member weight)', () => {
      expect(getWeightForRole('treasury', 'member')).toBe(50);
    });
  });
});

describe('calculateThresholdForTreasury', () => {
  it('returns 100 for 0 owners (floor(0/2)+1 = 1)', () => {
    expect(calculateThresholdForTreasury(0)).toBe(100);
  });

  it('returns 100 for 1 owner (1 of 1 must sign)', () => {
    expect(calculateThresholdForTreasury(1)).toBe(100);
  });

  it('returns 200 for 2 owners (both must sign)', () => {
    expect(calculateThresholdForTreasury(2)).toBe(200);
  });

  it('returns 200 for 3 owners (2 of 3)', () => {
    expect(calculateThresholdForTreasury(3)).toBe(200);
  });

  it('returns 300 for 4 owners (3 of 4)', () => {
    expect(calculateThresholdForTreasury(4)).toBe(300);
  });

  it('returns 300 for 5 owners (3 of 5)', () => {
    expect(calculateThresholdForTreasury(5)).toBe(300);
  });

  it('returns 600 for 10 owners (6 of 10)', () => {
    expect(calculateThresholdForTreasury(10)).toBe(600);
  });

  it('returns 5100 for 100 owners (51 of 100)', () => {
    expect(calculateThresholdForTreasury(100)).toBe(5100);
  });

  it('always requires strict majority', () => {
    for (const n of [2, 4, 6, 8]) {
      const threshold = calculateThresholdForTreasury(n);
      const halfWeight = (n / 2) * 100;
      expect(threshold).toBeGreaterThan(halfWeight);
    }
  });
});
