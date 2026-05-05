import { describe, expect, test } from 'bun:test';
import { makeMockEsimProvider } from './mock';

describe('mock eSIM provider — quote', () => {
  test('single-country plan rounds data up to next GB', async () => {
    const p = makeMockEsimProvider();
    const plan = await p.quote({ countries: ['JP'], days: 7, dataGb: 4.3 });
    expect(plan).not.toBeNull();
    expect(plan!.dataMb).toBe(5 * 1024);
    expect(plan!.validityDays).toBe(7);
    expect(plan!.label).toContain('JP');
    expect(plan!.label).toContain('5 GB');
  });

  test('regional (>=2 countries) priced higher per GB than single', async () => {
    const p = makeMockEsimProvider();
    const single = await p.quote({ countries: ['JP'], days: 7, dataGb: 5 });
    const regional = await p.quote({ countries: ['JP', 'KR'], days: 7, dataGb: 5 });
    expect(regional!.wholesaleMicroUsdc).toBeGreaterThan(single!.wholesaleMicroUsdc);
  });

  test('global (>=10 countries) priced highest per GB', async () => {
    const p = makeMockEsimProvider();
    const ten = ['JP', 'KR', 'TW', 'TH', 'VN', 'SG', 'MY', 'ID', 'PH', 'IN'];
    const global = await p.quote({ countries: ten, days: 14, dataGb: 5 });
    const regional = await p.quote({ countries: ['JP', 'KR'], days: 14, dataGb: 5 });
    expect(global!.wholesaleMicroUsdc).toBeGreaterThan(regional!.wholesaleMicroUsdc);
  });

  test('empty countries → null (no plan)', async () => {
    const p = makeMockEsimProvider();
    expect(await p.quote({ countries: [], days: 7, dataGb: 5 })).toBeNull();
  });
});

describe('mock eSIM provider — order', () => {
  test('order from quoted plan returns deterministic LPA + ICCID', async () => {
    const p = makeMockEsimProvider();
    const plan = await p.quote({ countries: ['JP'], days: 7, dataGb: 5 });
    const a = await p.order({ planId: plan!.planId, idempotencyKey: 'turn_abc_123' });
    const b = await p.order({ planId: plan!.planId, idempotencyKey: 'turn_abc_123' });
    expect(a.iccid).toBe(b.iccid);
    expect(a.activationCode).toBe(b.activationCode);
    expect(a.lpaCode).toStartWith('LPA:1$smdp.mock.sendero.dev$');
  });

  test('different idempotency keys produce different orders', async () => {
    const p = makeMockEsimProvider();
    const plan = await p.quote({ countries: ['JP'], days: 7, dataGb: 5 });
    const a = await p.order({ planId: plan!.planId, idempotencyKey: 'turn_a' });
    const b = await p.order({ planId: plan!.planId, idempotencyKey: 'turn_b' });
    expect(a.iccid).not.toBe(b.iccid);
  });

  test('rejects non-mock plan ids (catches provider mismatches)', async () => {
    const p = makeMockEsimProvider();
    await expect(
      p.order({ planId: 'esim_go_BUNDLE_JP_5GB', idempotencyKey: 'k' })
    ).rejects.toThrow('mock provider cannot order');
  });
});
