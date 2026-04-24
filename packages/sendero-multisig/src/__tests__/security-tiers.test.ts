import {
  compareTiers,
  evaluateSecurityTier,
  getRequiredUpgrade,
  getTierFromModules,
  getUpgradePath,
  SECURITY_TIERS,
  type SecurityTierLevel,
} from '../security-tiers';
import { describe, expect, it } from 'bun:test';

describe('SECURITY_TIERS', () => {
  it('defines all four tiers', () => {
    expect(SECURITY_TIERS).toHaveProperty('basic');
    expect(SECURITY_TIERS).toHaveProperty('standard');
    expect(SECURITY_TIERS).toHaveProperty('enhanced');
    expect(SECURITY_TIERS).toHaveProperty('maximum');
  });

  it('basic tier starts at $0 with weighted_multisig', () => {
    const tier = SECURITY_TIERS.basic;
    expect(tier.minBalance).toBe(0);
    expect(tier.modules).toEqual(['weighted_multisig']);
    expect(tier.requiresMultisig).toBe(false);
    expect(tier.requiresTimelock).toBe(false);
  });

  it('standard tier starts at $1,000', () => {
    const tier = SECURITY_TIERS.standard;
    expect(tier.minBalance).toBe(100_000);
    expect(tier.modules).toEqual(['weighted_multisig']);
    expect(tier.requiresMultisig).toBe(false);
  });

  it('enhanced tier starts at $50,000 with weighted multisig + address_book', () => {
    const tier = SECURITY_TIERS.enhanced;
    expect(tier.minBalance).toBe(5_000_000);
    expect(tier.modules).toEqual(['weighted_multisig', 'address_book']);
    expect(tier.requiresMultisig).toBe(true);
    expect(tier.requiresTimelock).toBe(false);
  });

  it('maximum tier starts at $250,000 with app-layer timelock', () => {
    const tier = SECURITY_TIERS.maximum;
    expect(tier.minBalance).toBe(25_000_000);
    expect(tier.modules).toEqual(['weighted_multisig', 'address_book']);
    expect(tier.requiresMultisig).toBe(true);
    expect(tier.requiresTimelock).toBe(true);
  });

  it('each tier has a level matching its key', () => {
    for (const [key, tier] of Object.entries(SECURITY_TIERS)) {
      expect(tier.level).toBe(key);
    }
  });

  it('each tier has a non-empty description', () => {
    for (const tier of Object.values(SECURITY_TIERS)) {
      expect(tier.description.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateSecurityTier', () => {
  it('returns basic for $0', () => {
    expect(evaluateSecurityTier(0)).toBe('basic');
  });

  it('returns basic for $999.99 (99_999 cents)', () => {
    expect(evaluateSecurityTier(99_999)).toBe('basic');
  });

  it('returns standard at exactly $1,000 (100_000 cents)', () => {
    expect(evaluateSecurityTier(100_000)).toBe('standard');
  });

  it('returns standard for $49,999.99', () => {
    expect(evaluateSecurityTier(4_999_999)).toBe('standard');
  });

  it('returns enhanced at exactly $50,000', () => {
    expect(evaluateSecurityTier(5_000_000)).toBe('enhanced');
  });

  it('returns enhanced for $249,999.99', () => {
    expect(evaluateSecurityTier(24_999_999)).toBe('enhanced');
  });

  it('returns maximum at exactly $250,000', () => {
    expect(evaluateSecurityTier(25_000_000)).toBe('maximum');
  });

  it('returns maximum for very large balances ($10M)', () => {
    expect(evaluateSecurityTier(1_000_000_000)).toBe('maximum');
  });

  it('returns basic for negative balance', () => {
    expect(evaluateSecurityTier(-1)).toBe('basic');
  });
});

describe('compareTiers', () => {
  it('returns 0 for equal tiers', () => {
    const tiers: SecurityTierLevel[] = ['basic', 'standard', 'enhanced', 'maximum'];
    for (const tier of tiers) {
      expect(compareTiers(tier, tier)).toBe(0);
    }
  });

  it('returns negative when a < b', () => {
    expect(compareTiers('basic', 'standard')).toBeLessThan(0);
    expect(compareTiers('basic', 'enhanced')).toBeLessThan(0);
    expect(compareTiers('basic', 'maximum')).toBeLessThan(0);
    expect(compareTiers('standard', 'enhanced')).toBeLessThan(0);
    expect(compareTiers('standard', 'maximum')).toBeLessThan(0);
    expect(compareTiers('enhanced', 'maximum')).toBeLessThan(0);
  });

  it('returns positive when a > b', () => {
    expect(compareTiers('maximum', 'basic')).toBeGreaterThan(0);
    expect(compareTiers('enhanced', 'basic')).toBeGreaterThan(0);
    expect(compareTiers('maximum', 'enhanced')).toBeGreaterThan(0);
  });
});

describe('getRequiredUpgrade', () => {
  it('returns null when current tier matches recommended', () => {
    expect(getRequiredUpgrade('basic', 0)).toBeNull();
    expect(getRequiredUpgrade('standard', 100_000)).toBeNull();
    expect(getRequiredUpgrade('enhanced', 5_000_000)).toBeNull();
    expect(getRequiredUpgrade('maximum', 25_000_000)).toBeNull();
  });

  it('returns null when current tier is higher than recommended', () => {
    expect(getRequiredUpgrade('maximum', 0)).toBeNull();
    expect(getRequiredUpgrade('enhanced', 100)).toBeNull();
    expect(getRequiredUpgrade('standard', 50)).toBeNull();
  });

  it('returns enhanced when basic wallet hits $50k', () => {
    expect(getRequiredUpgrade('basic', 5_000_000)).toBe('enhanced');
  });

  it('returns maximum when basic wallet hits $250k', () => {
    expect(getRequiredUpgrade('basic', 25_000_000)).toBe('maximum');
  });

  it('returns maximum when enhanced wallet hits $250k', () => {
    expect(getRequiredUpgrade('enhanced', 25_000_000)).toBe('maximum');
  });

  it('returns standard when basic wallet hits $1k', () => {
    expect(getRequiredUpgrade('basic', 100_000)).toBe('standard');
  });

  it('returns enhanced when standard wallet hits $50k', () => {
    expect(getRequiredUpgrade('standard', 5_000_000)).toBe('enhanced');
  });
});

describe('getUpgradePath', () => {
  it('returns empty array when from and to are the same tier', () => {
    expect(getUpgradePath('basic', 'basic')).toEqual([]);
    expect(getUpgradePath('maximum', 'maximum')).toEqual([]);
  });

  it('returns empty from basic to standard (same modules)', () => {
    expect(getUpgradePath('basic', 'standard')).toEqual([]);
  });

  it('adds address_book when upgrading basic → enhanced', () => {
    expect(getUpgradePath('basic', 'enhanced')).toEqual(['address_book']);
  });

  it('adds address_book when upgrading basic → maximum', () => {
    expect(getUpgradePath('basic', 'maximum')).toEqual(['address_book']);
  });

  it('returns empty from enhanced to maximum (same on-chain modules)', () => {
    expect(getUpgradePath('enhanced', 'maximum')).toEqual([]);
  });

  it('returns empty for downgrade', () => {
    expect(getUpgradePath('maximum', 'basic')).toEqual([]);
  });
});

describe('getTierFromModules', () => {
  it('returns basic for empty module list', () => {
    expect(getTierFromModules([])).toBe('basic');
  });

  it('returns standard for weighted_multisig only', () => {
    // max/enhanced need address_book (missing) → falls back to standard
    expect(getTierFromModules(['weighted_multisig'])).toBe('standard');
  });

  it('returns maximum for weighted_multisig + address_book (both installed)', () => {
    expect(getTierFromModules(['weighted_multisig', 'address_book'])).toBe('maximum');
  });

  it('returns maximum regardless of module order', () => {
    expect(getTierFromModules(['address_book', 'weighted_multisig'])).toBe('maximum');
  });

  it('returns maximum with extra unknown modules', () => {
    expect(getTierFromModules(['weighted_multisig', 'address_book', 'custom'])).toBe('maximum');
  });

  it('returns basic when only unrecognized modules installed', () => {
    expect(getTierFromModules(['foo', 'bar'])).toBe('basic');
  });
});
