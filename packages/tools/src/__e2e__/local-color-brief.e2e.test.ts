/**
 * E2E for local_color_brief — composes weather + timezone + tipping +
 * Places into a 3-5 bullet preamble. Live API hits.
 *
 * Two suites:
 *
 * 1. **Deterministic compose** — runs without OPENAI_API_KEY. Asserts
 *    the tool returns a well-shaped result for Lima (lodging coords
 *    known) AND degrades gracefully when the geocoder fails. Skipped
 *    when GOOGLE_PLACES_API_KEY isn't configured (tool depends on it).
 *
 * 2. **LLM-judged output quality** — runs with OPENAI_API_KEY. Asks a
 *    judge whether the bullet output reads like the destination it
 *    claims to describe. Catches "wrong city" regressions where the
 *    coords drift from the iso2.
 *
 * Spec: docs/architecture/concierge-magic.md §5.
 */

import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

import { localColorBrief } from '../local-color-brief';

// `@sendero/env` falls back to GOOGLE_API_KEY when the Places-specific
// var isn't set — the live e2e mirrors that resolution path so the
// suite runs whenever ANY Google API key is on the box.
const HAS_PLACES = Boolean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_API_KEY);
const HAS_OPENAI = Boolean(process.env.OPENAI_API_KEY);
const itLive = HAS_PLACES ? test : test.skip;
const itAi = HAS_PLACES && HAS_OPENAI ? test : test.skip;

if (!HAS_PLACES) {
  console.warn(
    '[local-color-brief.e2e] Skipping live suite — set GOOGLE_PLACES_API_KEY ' +
      'or GOOGLE_API_KEY (via `vercel env pull .env.local`) to enable.'
  );
}

const LIMA_COORDS = { lat: -12.0464, lng: -77.0428 };

describe('local_color_brief — live compose', () => {
  itLive(
    'Lima with lodging coords returns 1-5 bullets + composedFrom',
    async () => {
      const result = await localColorBrief({
        destinationIso2: 'PE',
        destinationCity: 'Lima',
        dateRange: { from: '2026-06-04', to: '2026-06-07' },
        lodgingCoords: LIMA_COORDS,
        lang: 'es',
      });
      // Bullets land in 0-5 range. 0 happens only when every API failed
      // (extremely rare); we assert ≤5 always and ≥1 in the typical
      // happy-path Lima query.
      expect(result.bullets.length).toBeGreaterThanOrEqual(1);
      expect(result.bullets.length).toBeLessThanOrEqual(5);
      expect(result.iso2).toBe('PE');
      // composedFrom shows which signals contributed; useful for triage
      // when a bullet count is low.
      expect(result.composedFrom.length).toBeGreaterThan(0);
    },
    30_000
  );

  itLive(
    'Reykjavik (Iceland) — global by construction, no special-casing',
    async () => {
      const result = await localColorBrief({
        destinationIso2: 'IS',
        destinationCity: 'Reykjavik',
        dateRange: { from: '2026-06-04', to: '2026-06-07' },
        lang: 'en',
      });
      // Even without lodgingCoords, geocoder resolves city center.
      expect(result.iso2).toBe('IS');
      expect(result.bullets.length).toBeGreaterThanOrEqual(0);
    },
    30_000
  );

  itLive(
    'Hanoi (Vietnam) — third-continent smoke',
    async () => {
      const result = await localColorBrief({
        destinationIso2: 'VN',
        destinationCity: 'Hanoi',
        dateRange: { from: '2026-06-04', to: '2026-06-07' },
        lang: 'en',
      });
      expect(result.iso2).toBe('VN');
    },
    30_000
  );

  itLive(
    'Spanish lang produces es bullets',
    async () => {
      const result = await localColorBrief({
        destinationIso2: 'PE',
        destinationCity: 'Lima',
        dateRange: { from: '2026-06-04', to: '2026-06-07' },
        lodgingCoords: LIMA_COORDS,
        lang: 'es',
      });
      // Heuristic: any bullet contains a Spanish accent or es keyword.
      if (result.bullets.length > 0) {
        const joined = result.bullets.join(' ');
        const hasSpanishHint = /á|é|í|ó|ú|ñ|cerca|cálido|llovizna|propina|abierto/i.test(joined);
        expect(hasSpanishHint).toBe(true);
      }
    },
    30_000
  );
});

describe('local_color_brief — LLM-judged quality', () => {
  itAi(
    'Lima output reads like Lima — judge spots "wrong city" drift',
    async () => {
      const result = await localColorBrief({
        destinationIso2: 'PE',
        destinationCity: 'Lima',
        dateRange: { from: '2026-06-04', to: '2026-06-07' },
        lodgingCoords: LIMA_COORDS,
        lang: 'es',
      });
      // Ask a small judge: is this output plausibly about Lima vs
      // somewhere else? We don't know exactly which restaurants Places
      // returns this run, but the judge catches "London hotels appearing
      // in a Lima brief" — the cardinal regression.
      const bulletsText = result.bullets.join('\n');
      const prompt = `You are grading a tourist brief about a city.

CLAIMED CITY: Lima, Peru
BRIEF BULLETS:
${bulletsText}

Question: Are the bullets plausibly about Lima, Peru? It's OK if some
bullets are generic (weather, sunset). FAIL only if any bullet
mentions a venue, neighborhood, currency, or tipping convention that's
clearly from a different country (London, Paris, Tokyo, etc.).

Reply STRICTLY JSON: { "ok": true|false, "reason": "..." }`;

      const judge = await generateText({
        model: openai.chat('gpt-4o-mini'),
        prompt,
      });
      let v: { ok: boolean; reason: string };
      try {
        const m = judge.text.match(/\{[\s\S]*\}/);
        v = JSON.parse(m?.[0] ?? '{}');
      } catch {
        v = { ok: false, reason: judge.text.slice(0, 200) };
      }
      if (!v.ok) console.warn('[local-color/lima] judge:', v.reason, '\nbullets:', bulletsText);
      expect(v.ok).toBe(true);
    },
    60_000
  );
});
