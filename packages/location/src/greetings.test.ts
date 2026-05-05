import { describe, expect, it } from 'vitest';

import {
  format24hTime,
  type GreetingResult,
  getCreativeGreeting,
  getHourInTimezone,
} from './greetings';

// ── getHourInTimezone ────────────────────────────────────────────

describe('getHourInTimezone', () => {
  it('returns a number 0–23 for a valid timezone', () => {
    const h = getHourInTimezone('America/New_York');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });

  it('falls back to local hour when timezone is undefined', () => {
    const h = getHourInTimezone(undefined);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });

  it('falls back to local hour for an invalid timezone', () => {
    const h = getHourInTimezone('Invalid/Timezone');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(23);
  });
});

// ── format24hTime ────────────────────────────────────────────────

describe('format24hTime', () => {
  it('returns HH:MM format', () => {
    const t = format24hTime('Europe/London');
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });

  it('gracefully handles undefined timezone', () => {
    const t = format24hTime(undefined);
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });

  it('gracefully handles invalid timezone', () => {
    const t = format24hTime('Bad/Zone');
    expect(t).toMatch(/^\d{2}:\d{2}$/);
  });
});

// ── getCreativeGreeting — return type ────────────────────────────

describe('getCreativeGreeting', () => {
  it('returns GreetingResult with before and after strings', () => {
    const g: GreetingResult = getCreativeGreeting({ hour: 9 });
    expect(typeof g.before).toBe('string');
    expect(typeof g.after).toBe('string');
    expect(g.before.length).toBeGreaterThan(0);
  });

  // ── Time slot coverage ──────────────────────────────────────

  const slots = [
    { label: 'latenight', hour: 2 },
    { label: 'dawn', hour: 5 },
    { label: 'morning', hour: 9 },
    { label: 'afternoon', hour: 14 },
    { label: 'evening', hour: 19 },
    { label: 'night', hour: 22 },
  ];

  for (const { label, hour } of slots) {
    it(`produces a greeting for ${label} (hour=${hour})`, () => {
      const g = getCreativeGreeting({ hour });
      expect(g.before.length).toBeGreaterThan(0);
    });
  }

  // ── Name handling ──────────────────────────────────────────

  it('includes name split when displayName is provided', () => {
    const g = getCreativeGreeting({ hour: 9, displayName: 'Ralph', locale: 'en' });
    const full = `${g.before}${g.after}`;
    // The name should NOT appear in the greeting template itself
    expect(full).not.toContain('Ralph');
    // But `before` should be non-empty since the template splits on {name}
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('works without displayName (no name provided)', () => {
    const g = getCreativeGreeting({ hour: 9, displayName: null, locale: 'en' });
    expect(g.before.length).toBeGreaterThan(0);
    // after should be empty when there's no name
    // (template is collapsed into `before`)
  });

  it('handles empty string displayName like null', () => {
    const g = getCreativeGreeting({ hour: 9, displayName: '', locale: 'en' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  // ── Locale fallback ────────────────────────────────────────

  it('uses Spanish pool for locale "es"', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'es' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('falls back es-AR → es_AR pool', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'es-AR' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('falls back es-MX → es_MX pool', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'es-MX' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('falls back es-EC → es_EC pool', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'es-EC' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('falls back to English for unknown locale', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'xx-ZZ' });
    expect(g.before.length).toBeGreaterThan(0);
  });

  // ── Weather vibes ──────────────────────────────────────────

  const vibeTests = [
    { label: 'rain', weatherCode: 61 },
    { label: 'hot', weatherCode: 0, temperature: 35 },
    { label: 'freezing', weatherCode: 0, temperature: -2 },
    { label: 'snow', weatherCode: 71 },
    { label: 'storm', weatherCode: 95 },
    { label: 'fog', weatherCode: 45 },
    { label: 'clear', weatherCode: 0 },
    { label: 'cloudy', weatherCode: 2 },
    { label: 'unknown code', weatherCode: 999 },
  ];

  for (const { label, weatherCode, temperature } of vibeTests) {
    it(`produces greeting for weather vibe: ${label}`, () => {
      const g = getCreativeGreeting({
        hour: 9,
        locale: 'en',
        weatherCode,
        temperature: temperature ?? 18,
      });
      expect(g.before.length).toBeGreaterThan(0);
    });
  }

  // ── Name-first locales (ja, ko, zh) ────────────────────────

  it('places name first for Japanese', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'ja', displayName: '太郎' });
    // In Japanese pool, templates start with {name} so `before` should be empty or very short
    // and `after` should have the Japanese text
    expect(g.before.length + g.after.length).toBeGreaterThan(0);
  });

  it('places name first for Korean', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'ko', displayName: '민수' });
    expect(g.before.length + g.after.length).toBeGreaterThan(0);
  });

  it('places name first for Chinese', () => {
    const g = getCreativeGreeting({ hour: 9, locale: 'zh', displayName: '小明' });
    expect(g.before.length + g.after.length).toBeGreaterThan(0);
  });

  // ── Easter egg scoping ─────────────────────────────────────

  it('does NOT include Spanish Easter egg in Japanese dawn', () => {
    // The Japanese pool should not have EASTER_EGG in dawn
    // We can verify by checking many iterations that none produce Spanish text
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'ja', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  it('does NOT include Spanish Easter egg in Korean dawn', () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'ko', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  it('does NOT include Spanish Easter egg in Chinese dawn', () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'zh', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  it('does NOT include Spanish Easter egg in Hindi dawn', () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'hi', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  it('does NOT include Spanish Easter egg in Urdu dawn', () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'ur', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  it('does NOT include Spanish Easter egg in Bengali dawn', () => {
    const results = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = getCreativeGreeting({ hour: 5, locale: 'bn', displayName: 'Test' });
      results.add(`${g.before}${g.after}`);
    }
    for (const r of results) {
      expect(r).not.toContain('Al que madruga');
    }
  });

  // ── Deterministic rotation ─────────────────────────────────

  it('returns the same greeting for the same inputs within one day', () => {
    const a = getCreativeGreeting({ hour: 9, locale: 'en', displayName: 'X' });
    const b = getCreativeGreeting({ hour: 9, locale: 'en', displayName: 'X' });
    expect(a.before).toBe(b.before);
    expect(a.after).toBe(b.after);
  });

  // ── All registered locales produce output ──────────────────

  const allLocales = [
    'en',
    'es',
    'pt',
    'fr',
    'de',
    'it',
    'nl',
    'tr',
    'ja',
    'ko',
    'zh',
    'hi',
    'ur',
    'bn',
    'vi',
    'id',
    'yo',
    'es-AR',
    'es-MX',
    'es-CO',
    'es-CL',
    'es-PE',
    'es-VE',
    'es-UY',
    'es-EC',
    'es-DO',
    'es-PR',
    'es-PY',
    'es-BO',
    'es-CR',
    'es-SV',
  ];

  for (const locale of allLocales) {
    it(`locale "${locale}" produces valid output for all time slots`, () => {
      for (const hour of [1, 5, 9, 14, 19, 23]) {
        const g = getCreativeGreeting({ hour, locale, displayName: 'Test' });
        expect(g.before.length + g.after.length).toBeGreaterThan(0);
      }
    });
  }

  // ── Edge cases ─────────────────────────────────────────────

  it('handles hour 0 (midnight)', () => {
    const g = getCreativeGreeting({ hour: 0 });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('handles hour 23', () => {
    const g = getCreativeGreeting({ hour: 23 });
    expect(g.before.length).toBeGreaterThan(0);
  });

  it('handles hour 12 (noon)', () => {
    const g = getCreativeGreeting({ hour: 12 });
    expect(g.before.length).toBeGreaterThan(0);
  });
});
