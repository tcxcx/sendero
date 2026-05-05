/**
 * recommend_visa_application_path unit tests.
 *
 * Stubs `fetch` so Places lookups stay hermetic. Asserts each branch
 * of the discriminated union and the curated-corridor enrichment for
 * the moat case (consular).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  _listSupportedCorridors,
  recommendVisaApplicationPath,
  recommendVisaApplicationPathTool,
} from './recommend-visa-application-path';

const realFetch = globalThis.fetch;
const realKey = process.env.GOOGLE_MAPS_API_KEY;

function mockPlacesEmpty(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ places: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function mockPlacesWith(
  places: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string }>
): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ places }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = realKey;
});

describe('recommend_visa_application_path — branching', () => {
  test('visa_free for ARG → ESP (mercosur citizen, schengen free)', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'ESP',
      nationalityIso3: 'ARG',
      skipConsulateSearch: true,
    });
    expect(out.application_method).toBe('visa_free');
  });

  test('eta path for ARG → USA returns ESTA', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'USA',
      nationalityIso3: 'ARG',
      skipConsulateSearch: true,
    });
    if (out.application_method !== 'eta') throw new Error('expected eta');
    expect(out.programName).toBe('ESTA');
    expect(out.applyUrl).toBe('https://esta.cbp.dhs.gov');
  });

  test('evisa path for USA → IND returns India e-Visa', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'IND',
      nationalityIso3: 'USA',
      skipConsulateSearch: true,
    });
    if (out.application_method !== 'evisa') throw new Error('expected evisa');
    expect(out.programName).toBe('e-Visa India');
  });

  test('consular path for ECU → ESP enriches with curated corridor + alternates', async () => {
    mockPlacesEmpty();
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'ESP',
      nationalityIso3: 'ECU',
      applicantCountryIso2: 'EC',
      applicantCity: 'Quito',
    });
    if (out.application_method !== 'consular') throw new Error('expected consular');
    expect(out.hasCuratedCorridor).toBe(true);
    expect(out.visaClass).toBe('Schengen Type C');
    expect(out.primaryPortal.name).toBe('BLS Spain Ecuador');
    expect(out.appointmentPattern).toMatch(/Tuesdays/i);
    // Curated alternate: Lima
    expect(out.consularOptions.some(o => o.curated && o.city === 'Lima')).toBe(true);
    expect(out.documentChecklist.length).toBeGreaterThan(5);
  });

  test('consular path merges live Places hits with curated alternates (dedup by name)', async () => {
    mockPlacesWith([
      {
        id: 'place_001',
        displayName: { text: 'Consulado General de España en Quito' },
        formattedAddress: 'Av. 12 de Octubre N24-562, Quito',
      },
    ]);
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'ESP',
      nationalityIso3: 'ECU',
      applicantCountryIso2: 'EC',
      applicantCity: 'Quito',
    });
    if (out.application_method !== 'consular') throw new Error('expected consular');
    expect(out.consularOptions.length).toBeGreaterThanOrEqual(2);
    const live = out.consularOptions.find(o => !o.curated);
    expect(live?.placeId).toBe('place_001');
  });

  test('consular fallback (visa-rules says required, no curated corridor) returns generic checklist + embassy lookup URL', async () => {
    // BRA → USA is in visa-rules as visa_required but not in our curated
    // corridor table — exercises the degraded consular branch.
    mockPlacesEmpty();
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'USA',
      nationalityIso3: 'BRA',
      applicantCountryIso2: 'BR',
    });
    if (out.application_method !== 'consular') throw new Error('expected consular');
    expect(out.hasCuratedCorridor).toBe(false);
    expect(out.primaryPortal.url).toContain('https://www.google.com/search');
    expect(out.warnings[0]).toContain('does not yet have curated corridor');
  });

  test('uncurated + visa-rules unknown returns unknown branch with embassy lookup query', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'CHN',
      nationalityIso3: 'COL',
      applicantCountryIso2: 'CO',
      skipConsulateSearch: true,
    });
    if (out.application_method !== 'unknown') throw new Error('expected unknown');
    expect(out.embassyLookupQuery).toContain('China');
  });

  test('unknown when nationality cannot be resolved', async () => {
    const out = await recommendVisaApplicationPath({
      destinationIso3: 'USA',
      skipConsulateSearch: true,
    });
    if (out.application_method !== 'unknown') throw new Error('expected unknown');
    expect(out.reason).toMatch(/nationality unknown/i);
  });

  test('skipConsulateSearch=true → consular returns curated portal + alternates only (no Places call)', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const out = await recommendVisaApplicationPath({
      destinationIso3: 'ESP',
      nationalityIso3: 'ECU',
      applicantCountryIso2: 'EC',
      skipConsulateSearch: true,
    });
    if (out.application_method !== 'consular') throw new Error('expected consular');
    expect(out.hasCuratedCorridor).toBe(true);
    expect(fetchCalls).toBe(0);
    expect(out.consularOptions.every(o => o.curated)).toBe(true);
  });
});

describe('recommend_visa_application_path — schema', () => {
  test('rejects malformed destination iso3', () => {
    const r = recommendVisaApplicationPathTool.inputSchema.safeParse({
      destinationIso3: 'US',
    });
    expect(r.success).toBe(false);
  });

  test('rejects malformed applicant country iso2', () => {
    const r = recommendVisaApplicationPathTool.inputSchema.safeParse({
      destinationIso3: 'USA',
      applicantCountryIso2: 'USA',
    });
    expect(r.success).toBe(false);
  });
});

describe('recommend_visa_application_path — corridor coverage', () => {
  test('top hard corridors are curated', () => {
    const corridors = _listSupportedCorridors();
    for (const k of ['ECU-ESP', 'VEN-USA', 'IND-USA', 'COL-USA', 'ECU-DEU', 'ARG-GBR', 'VEN-ESP']) {
      expect(corridors).toContain(k);
    }
  });
});
