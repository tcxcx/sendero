import {
  getThresholdForTemplate,
  TREASURY_TEMPLATE_CONFIGS,
  type TreasuryTemplateId,
} from '../templates';
import { describe, expect, test } from 'bun:test';

const ALL_IDS: TreasuryTemplateId[] = [
  'solo_freelancer',
  'startup',
  'agency',
  'import_export',
  'saas_platform',
  'dao',
];

describe('TREASURY_TEMPLATE_CONFIGS', () => {
  test('has all 6 non-custom templates', () => {
    expect(Object.keys(TREASURY_TEMPLATE_CONFIGS)).toHaveLength(6);
    for (const id of ALL_IDS) {
      expect(TREASURY_TEMPLATE_CONFIGS[id]).toBeDefined();
    }
  });

  test('each template has required fields', () => {
    for (const id of ALL_IDS) {
      const t = TREASURY_TEMPLATE_CONFIGS[id]!;
      expect(t.id).toBe(id);
      expect(t.ownerWeight).toBeGreaterThan(0);
      expect(t.threshold).toBeGreaterThan(0);
      expect(t.adminDailyLimitUsd).toBeGreaterThanOrEqual(0);
      expect(t.adminPerTxLimitUsd).toBeGreaterThanOrEqual(0);
      expect(t.defaultTier).toBeDefined();
      expect(t.thresholdRule).toMatch(/^(fixed|dynamic)$/);
      expect(t.modules).toContain('weighted_multisig');
    }
  });

  test('solo_freelancer config', () => {
    const t = TREASURY_TEMPLATE_CONFIGS.solo_freelancer!;
    expect(t.ownerWeight).toBe(1000);
    expect(t.threshold).toBe(1000);
    expect(t.defaultTier).toBe('basic');
    expect(t.adminDailyLimitUsd).toBe(500);
    expect(t.adminPerTxLimitUsd).toBe(200);
  });

  test('import_export is enhanced and includes address_book when compatible', () => {
    const t = TREASURY_TEMPLATE_CONFIGS.import_export!;
    expect(t.defaultTier).toBe('enhanced');
    expect(t.modules).toEqual(['weighted_multisig', 'address_book']);
    expect(t.adminDailyLimitUsd).toBe(10_000);
  });

  test('saas_platform has admin weight 150', () => {
    const t = TREASURY_TEMPLATE_CONFIGS.saas_platform!;
    expect(t.adminWeight).toBe(150);
    expect(t.adminDailyLimitUsd).toBe(3_000);
  });

  test('dao threshold is dynamic', () => {
    expect(TREASURY_TEMPLATE_CONFIGS.dao!.thresholdRule).toBe('dynamic');
  });

  test('all non-dao templates have fixed threshold', () => {
    for (const id of ALL_IDS.filter(i => i !== 'dao')) {
      expect(TREASURY_TEMPLATE_CONFIGS[id]!.thresholdRule).toBe('fixed');
    }
  });
});

describe('getThresholdForTemplate', () => {
  test('dao with 3 owners = 200', () => {
    expect(getThresholdForTemplate('dao', 3)).toBe(200);
  });
  test('dao with 5 owners = 300', () => {
    expect(getThresholdForTemplate('dao', 5)).toBe(300);
  });
  test('dao with 2 owners = 200 (unanimous)', () => {
    expect(getThresholdForTemplate('dao', 2)).toBe(200);
  });
  test('startup threshold stays 500 regardless of owner count', () => {
    expect(getThresholdForTemplate('startup', 1)).toBe(500);
    expect(getThresholdForTemplate('startup', 5)).toBe(500);
  });
  test('agency threshold stays 700', () => {
    expect(getThresholdForTemplate('agency', 1)).toBe(700);
    expect(getThresholdForTemplate('agency', 10)).toBe(700);
  });
});
