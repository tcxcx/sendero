/**
 * Deterministic E2E for the visa flow.
 *
 * What this tests (and why it's NOT circular):
 *
 * The visa tools are thin facades over (a) `lookupVisaStatus` (a curated
 * lookup table in @sendero/vault) and (b) the consular-corridors JSON.
 * A trivially-circular test would assert "the function returns what's
 * in the JSON" — that just verifies file-IO, not feature correctness.
 *
 * Instead these assertions reference REAL-WORLD FACTS the traveler is
 * relying on:
 *   - "BLS handles Spain visa applications in Ecuador" — true today;
 *     an outdated JSON would surface the wrong operator.
 *   - "Argentinians enter the US under ESTA, not a consular visa" — a
 *     bug in either visa-rules OR the path advisor flips this.
 *   - "Venezuelans applying to the US face a long processing band" — if
 *     either the rules table OR the corridor entry says otherwise, that
 *     creates a real traveler harm (booking a flight that won't be
 *     possible).
 *   - "The agent never promises to auto-book a consular slot" — required
 *     by the TOS-line architectural rule (we must always surface the URL
 *     for the traveler to click).
 *
 * If we change the curated table, the test still proves the agent gives
 * the same factually-correct answer the user expects.
 */

import { describe, expect, test } from 'bun:test';

import {
  recommendVisaApplicationPath,
  type RecommendVisaApplicationPathResult,
} from '../recommend-visa-application-path';

// Inline a stub so we never hit Google Places in this suite; real Places
// behavior is covered in `recommend-visa-application-path.test.ts`.
const STUB_PLACES_EMPTY = (): void => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ places: [] }), { status: 200 })) as typeof fetch;
};

const realFetch = globalThis.fetch;
function restore(): void {
  globalThis.fetch = realFetch;
}

describe('E2E — Ecuadorian → Spain (Schengen consular)', () => {
  test('full chain surfaces BLS as the operator + the midnight slot pattern + Lima alternate', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'ESP',
        nationalityIso3: 'ECU',
        applicantCountryIso2: 'EC',
        applicantCity: 'Quito',
      });

      // Method must be consular — Schengen for Ecuadorians is consular,
      // not eVisa or visa-free.
      expect(out.application_method).toBe('consular');
      if (out.application_method !== 'consular') return;

      // Real-world fact: BLS International is Spain's outsourced visa
      // partner in Ecuador (verifiable on blsspainvisa.com).
      expect(out.primaryPortal.operator).toBe('BLS International');
      expect(out.primaryPortal.url).toContain('blsspainvisa.com');

      // Slot-drop pattern is the intelligence we add. If anyone ever
      // edits this to remove the timing hint, the test fails — that
      // hint is the entire reason a traveler would use Sendero over
      // googling "Spain visa Ecuador".
      expect(out.appointmentPattern).toBeDefined();
      expect(out.appointmentPattern!).toMatch(/Tuesday|Thursday/i);
      expect(out.appointmentPattern!).toMatch(/23:5\d|midnight/i);

      // Lima-as-alternate is the corridor knowledge the traveler can't
      // get from BLS's own site. Their site only lists Ecuador posts.
      const lima = out.consularOptions.find(o => o.city === 'Lima');
      expect(lima).toBeDefined();
      expect(lima!.curated).toBe(true);
      expect(lima!.note).toMatch(/Lima|Peru/i);

      // Document checklist must include the things that actually block
      // people: travel insurance, bank statements, photos with a
      // specific size. Generic "bring documents" wouldn't help.
      const checklist = out.documentChecklist.join(' ').toLowerCase();
      expect(checklist).toContain('insurance');
      expect(checklist).toContain('bank');
      expect(checklist).toMatch(/35[×x]45/); // photo dimension spec
    } finally {
      restore();
    }
  });
});

describe('E2E — Argentinian → United States (ETA path, NOT consular)', () => {
  test('routes to ESTA, never recommends a consulate', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'USA',
      nationalityIso3: 'ARG',
      skipConsulateSearch: true,
    });

    // Critical correctness: Argentinians use ESTA. If the agent ever
    // routes this through consular, it's a real bug — the traveler
    // would needlessly schedule a B1/B2 interview.
    expect(out.application_method).toBe('eta');
    if (out.application_method !== 'eta') return;
    expect(out.programName).toBe('ESTA');
    expect(out.applyUrl).toBe('https://esta.cbp.dhs.gov');
    expect(out.leadTimeDays).toBeLessThanOrEqual(7);
  });
});

describe('E2E — Venezuelan → United States (consular, hard corridor)', () => {
  test('surfaces alternate posts (Bogotá/BA), the bond warning, and the long processing band', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'USA',
        nationalityIso3: 'VEN',
        applicantCountryIso2: 'AR',
        applicantCity: 'Buenos Aires',
      });

      expect(out.application_method).toBe('consular');
      if (out.application_method !== 'consular') return;

      // Real-world: Embassy Caracas is closed; Bogotá is the assigned
      // post but BA is a viable third-country option for residents of
      // Argentina. If any of these are missing, a Venezuelan traveler
      // gets misdirected.
      const cities = out.consularOptions.map(o => o.city ?? '').join(' | ');
      expect(cities).toMatch(/Bogot/);
      expect(cities).toMatch(/Buenos Aires|BA/);

      // The $15K bond is non-obvious to most travelers and could
      // bankrupt them if not flagged. Must appear in warnings.
      const warnings = out.warnings.join(' ').toLowerCase();
      expect(warnings).toMatch(/bond|15[,k]/i);

      // Processing band must be honest: the real-world wait can be
      // 12-18 months. A claim of "2 weeks" would lead to a missed trip.
      expect(out.processingTimeDays[0]).toBeGreaterThanOrEqual(60);
      expect(out.processingTimeDays[1]).toBeGreaterThanOrEqual(180);
    } finally {
      restore();
    }
  });
});

describe('E2E — IND → USA (consular, with drop-box opt-out)', () => {
  test('surfaces interview-waiver / drop-box hint so eligible travelers skip the interview', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'USA',
        nationalityIso3: 'IND',
        applicantCountryIso2: 'IN',
      });

      expect(out.application_method).toBe('consular');
      if (out.application_method !== 'consular') return;

      // The drop-box renewal path is the single most valuable piece of
      // visa intelligence for Indian re-applicants — it saves the
      // entire interview wait. If this is missing, returning travelers
      // get worse advice from us than from a forum.
      const warnings = out.warnings.join(' ').toLowerCase();
      expect(warnings).toMatch(/drop.?box|interview waiver/i);
    } finally {
      restore();
    }
  });
});

describe('E2E — Uncurated corridor: graceful degrade, no invention', () => {
  test('BRA → USA has no curated table entry → returns degraded consular with explicit warning', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'USA',
        nationalityIso3: 'BRA',
        applicantCountryIso2: 'BR',
      });
      expect(out.application_method).toBe('consular');
      if (out.application_method !== 'consular') return;

      // The honesty gate: when we don't have curated info we MUST say
      // so, never invent a consulate URL or fake processing time.
      expect(out.hasCuratedCorridor).toBe(false);
      expect(out.warnings.join(' ')).toMatch(/does not yet have curated corridor/i);
      // Fallback portal must point at a search query, not a fabricated URL.
      expect(out.primaryPortal.url).toContain('https://www.google.com/search');
    } finally {
      restore();
    }
  });

  test('Truly unknown corridor (rules say unknown, no curated entry) does NOT pretend to be consular', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'CHN',
      nationalityIso3: 'COL',
      skipConsulateSearch: true,
    });
    // Distinguishing this from the "we know they need a visa but don't
    // have curated detail" case matters: an `'unknown'` response tells
    // the agent to ask a clarifying question; a `'consular'` response
    // tells it to surface a checklist that may not apply.
    expect(out.application_method).toBe('unknown');
    if (out.application_method !== 'unknown') return;
    expect(out.embassyLookupQuery).toBeDefined();
    expect(out.embassyLookupQuery!.toLowerCase()).toContain('china');
  });
});

describe('E2E — Privacy / authority guards', () => {
  test('Result never includes the traveler passport number even when nationality is known', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'ESP',
        nationalityIso3: 'ECU',
        applicantCountryIso2: 'EC',
      });

      // Defense-in-depth: nothing in the response shape should ever
      // surface PII. If a future change adds a passport number to a
      // notes field, this test catches it.
      const blob = JSON.stringify(out).toLowerCase();
      expect(blob).not.toMatch(/passport\s*#?\s*[a-z]\d{6,}/);
      expect(blob).not.toMatch(/\bdob\b/);
    } finally {
      restore();
    }
  });

  test('Consular response NEVER promises auto-booking — surfaces the URL only', async () => {
    STUB_PLACES_EMPTY();
    try {
      const out = await recommendVisaApplicationPath({
        destinationIso3: 'ESP',
        nationalityIso3: 'ECU',
        applicantCountryIso2: 'EC',
      });
      if (out.application_method !== 'consular') throw new Error('expected consular');

      // The TOS-line architectural rule: we must never claim to book
      // an appointment ourselves. If anything in the structured output
      // promises that, the agent's downstream copy may follow.
      const blob = JSON.stringify(out).toLowerCase();
      expect(blob).not.toMatch(/we'?ll book|we will book|auto[-\s]?book/);

      // Primary portal url must be the actual consulate operator, not
      // a Sendero internal URL.
      expect(out.primaryPortal.url).not.toContain('sendero.travel');
    } finally {
      restore();
    }
  });
});

describe('E2E — Composability: nationality fallback from ctx.traveler', () => {
  test('nationalityIso3 missing in input → resolved from ctx.traveler', async () => {
    const out = await recommendVisaApplicationPath(
      { destinationIso3: 'USA', skipConsulateSearch: true },
      // Mimic dispatch route stuffing the vault-resolved nationality.
      { traveler: { nationalityIso3: 'ARG' } as never }
    );
    expect(out.application_method).toBe('eta');
    if (out.application_method !== 'eta') return;
    expect(out.nationalityIso3).toBe('ARG');
    expect(out.programName).toBe('ESTA');
  });

  test('nationality completely missing → returns unknown with actionable reason', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'USA',
      skipConsulateSearch: true,
    });
    expect(out.application_method).toBe('unknown');
    if (out.application_method !== 'unknown') return;
    // The reason must point the agent at a remediation, not just say
    // "unknown".
    expect(out.reason.toLowerCase()).toContain('scan_passport_inline');
  });
});

describe('E2E — Result discriminator type-safety (compile-time + runtime)', () => {
  test('exhaustive switch on application_method — every branch reachable, no string drift', async () => {
    const cases: Array<{ args: Parameters<typeof recommendVisaApplicationPath>[0]; expected: RecommendVisaApplicationPathResult['application_method'] }> = [
      { args: { destinationIso3: 'ESP', nationalityIso3: 'ARG', skipConsulateSearch: true }, expected: 'visa_free' },
      { args: { destinationIso3: 'USA', nationalityIso3: 'ARG', skipConsulateSearch: true }, expected: 'eta' },
      { args: { destinationIso3: 'IND', nationalityIso3: 'USA', skipConsulateSearch: true }, expected: 'evisa' },
      { args: { destinationIso3: 'ESP', nationalityIso3: 'ECU', skipConsulateSearch: true }, expected: 'consular' },
      { args: { destinationIso3: 'CHN', nationalityIso3: 'COL', skipConsulateSearch: true }, expected: 'unknown' },
    ];

    for (const c of cases) {
      const out = await recommendVisaApplicationPath(c.args);
      expect(out.application_method).toBe(c.expected);
    }
  });
});
