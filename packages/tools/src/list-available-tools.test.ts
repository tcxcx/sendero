/**
 * list_available_tools unit tests.
 *
 * Verifies the agent-introspection contract:
 *   - Production prod-keys are refused (capability-leak protection).
 *   - Internal tools are hidden from the listing (so the agent can't
 *     accidentally surface them to a customer).
 *   - Scope filter respects the caller's granted scopes — a sandbox
 *     key sees everything; a read-mostly key sees only what it can
 *     actually invoke.
 *   - Keyword search hits both name AND description (a traveler asks
 *     "passport"; we want to surface scan_passport_inline AND
 *     check_visa_requirements which mentions "passport" in its desc).
 *   - Required vs optional input fields are correctly surfaced from
 *     the tool's jsonSchema.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  runListAvailableTools,
  type ListAvailableToolsDeps,
  type ListAvailableToolsInput,
} from './list-available-tools';
import type { ToolContext, ToolDef } from './types';

// Hand-built tiny catalog so the assertions don't drift when real
// tools are added/removed. We're testing the introspection logic,
// not "do all tools exist".
const fakeCatalog: ReadonlyArray<ToolDef> = [
  {
    name: 'search_flights',
    description: 'Search Duffel flight offers by origin, destination, date.',
    inputSchema: {} as never,
    jsonSchema: {
      type: 'object',
      required: ['origin', 'destination', 'departureDate'],
      properties: {
        origin: { type: 'string' },
        destination: { type: 'string' },
        departureDate: { type: 'string' },
        cabinClass: { type: 'string' },
        passengers: { type: 'integer' },
      },
    },
    handler: async () => ({}),
  },
  {
    name: 'book_flight',
    description: 'Book a held flight offer for the signed-in traveler.',
    inputSchema: {} as never,
    jsonSchema: {
      type: 'object',
      required: ['offerId'],
      properties: { offerId: { type: 'string' } },
    },
    handler: async () => ({}),
  },
  {
    name: 'scan_passport_inline',
    description:
      'Extract MRZ from a passport image, validate ICAO 9303 checksum, encrypt + persist to PassportVault.',
    inputSchema: {} as never,
    jsonSchema: {
      type: 'object',
      properties: {
        documentUrl: { type: 'string' },
        data: { type: 'string' },
        mediaType: { type: 'string' },
      },
    },
    handler: async () => ({}),
  },
  {
    name: 'check_visa_requirements',
    description: 'Check if a passport holder needs a visa for a destination.',
    inputSchema: {} as never,
    jsonSchema: {
      type: 'object',
      required: ['nationalityIso3', 'destinationIso3'],
      properties: {
        nationalityIso3: { type: 'string' },
        destinationIso3: { type: 'string' },
      },
    },
    handler: async () => ({}),
  },
  {
    name: 'kapso_activate_phone_number',
    description: 'Internal: activate a tenant Kapso WhatsApp number.',
    inputSchema: {} as never,
    jsonSchema: { type: 'object', properties: {} },
    internal: true, // ← must be hidden from the agent
    handler: async () => ({}),
  },
  {
    name: 'send_tokens',
    description: 'Move USDC between Sendero wallets (treasury op).',
    inputSchema: {} as never,
    jsonSchema: { type: 'object', properties: {} },
    handler: async () => ({}),
  },
];

const deps: ListAvailableToolsDeps = { catalog: fakeCatalog };

const realNodeEnv = process.env.NODE_ENV;
const realVercelEnv = process.env.VERCEL_ENV;
const realOverride = process.env.SENDERO_GAPS_ALLOW_NONDEV;
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  delete process.env.VERCEL_ENV;
  delete process.env.SENDERO_GAPS_ALLOW_NONDEV;
});
afterEach(() => {
  process.env.NODE_ENV = realNodeEnv ?? 'test';
  if (realVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = realVercelEnv;
  if (realOverride === undefined) delete process.env.SENDERO_GAPS_ALLOW_NONDEV;
  else process.env.SENDERO_GAPS_ALLOW_NONDEV = realOverride;
});

const sandboxCtx: ToolContext = {
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

describe('list_available_tools — production gate', () => {
  test('production prod-key is refused', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      { caller: { effectiveKeyType: 'production', keyType: 'production' } },
      deps
    );
    expect(r.status).toBe('production_refused');
    expect(r.tools).toEqual([]);
  });

  test('production sandbox-key in production deploy is REFUSED (env gate fires first)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    expect(r.status).toBe('production_refused');
  });

  test('preview deploy is REFUSED (shared surface)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'preview';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    expect(r.status).toBe('production_refused');
  });

  test('local dev (no VERCEL_ENV) sandbox call IS allowed', async () => {
    delete process.env.NODE_ENV;
    delete process.env.VERCEL_ENV;
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    expect(r.status).toBe('ok');
    expect(r.tools.length).toBeGreaterThan(0);
  });

  test('VERCEL_ENV=development is dev (allowed)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'development';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    expect(r.status).toBe('ok');
  });

  test('SENDERO_GAPS_ALLOW_NONDEV=1 + sandbox bypasses env gate (operator dashboard)', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.SENDERO_GAPS_ALLOW_NONDEV = '1';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    expect(r.status).toBe('ok');
  });

  test('SENDERO_GAPS_ALLOW_NONDEV=1 does NOT bypass prod-key reject', async () => {
    process.env.NODE_ENV = 'production';
    process.env.VERCEL_ENV = 'production';
    process.env.SENDERO_GAPS_ALLOW_NONDEV = '1';
    const r = await runListAvailableTools(
      { limit: 15 } as ListAvailableToolsInput,
      { caller: { effectiveKeyType: 'production', keyType: 'production' } },
      deps
    );
    expect(r.status).toBe('production_refused');
  });
});

describe('list_available_tools — internal-tool hiding', () => {
  test('internal tools are NEVER surfaced to the agent', async () => {
    const r = await runListAvailableTools(
      { limit: 50 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    const names = r.tools.map(t => t.name);
    expect(names).not.toContain('kapso_activate_phone_number');
    // But we DID include `kapso_activate_phone_number` in the
    // fixture catalog. Total != catalog length.
    expect(r.total).toBeLessThan(fakeCatalog.length);
  });
});

describe('list_available_tools — scope filtering', () => {
  test('caller with read-mostly scopes does NOT see treasury tools', async () => {
    const r = await runListAvailableTools(
      { limit: 50 } as ListAvailableToolsInput,
      {
        caller: {
          effectiveKeyType: 'sandbox',
          keyType: 'sandbox',
          scopes: ['search', 'trip_assistance', 'compliance'],
        },
      },
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    const names = r.tools.map(t => t.name);
    // search_flights: scope='search' ✓
    expect(names).toContain('search_flights');
    // book_flight: scope='bookings' (book_* prefix) — not granted
    expect(names).not.toContain('book_flight');
    // send_tokens: scope='treasury' — not granted
    expect(names).not.toContain('send_tokens');
  });

  test('explicit scope filter narrows further', async () => {
    const r = await runListAvailableTools(
      { scope: 'trip_assistance', limit: 50 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    // None of our fixture tools have scope='trip_assistance' (we'd need
    // to register one starting with 'trip_' or matching the explicit
    // trip_assistance allowlist). So result should be empty.
    expect(r.total).toBe(0);
  });

  test('wildcard scopes (sandbox default) see everything non-internal', async () => {
    const r = await runListAvailableTools(
      { limit: 50 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.total).toBe(fakeCatalog.length - 1); // minus the internal one
  });
});

describe('list_available_tools — keyword search', () => {
  test('keyword "passport" finds scan_passport_inline AND check_visa_requirements', async () => {
    const r = await runListAvailableTools(
      { keyword: 'passport', limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    const names = r.tools.map(t => t.name);
    expect(names).toContain('scan_passport_inline');
    // check_visa_requirements has "passport" in description
    expect(names).toContain('check_visa_requirements');
  });

  test('keyword is case-insensitive', async () => {
    const r = await runListAvailableTools(
      { keyword: 'PASSPORT', limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.tools.length).toBeGreaterThan(0);
  });

  test('keyword that matches nothing returns empty (not all tools)', async () => {
    const r = await runListAvailableTools(
      { keyword: 'completely_nonexistent_thing', limit: 15 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.tools).toEqual([]);
    expect(r.total).toBe(0);
  });
});

describe('list_available_tools — input field surfacing', () => {
  test('search_flights shape: required = [origin, destination, departureDate], optional includes cabinClass + passengers', async () => {
    const r = await runListAvailableTools(
      { keyword: 'search_flights', limit: 5 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    const tool = r.tools.find(t => t.name === 'search_flights');
    expect(tool?.requiredInputs).toEqual(['origin', 'destination', 'departureDate']);
    expect(tool?.optionalInputs).toContain('cabinClass');
    expect(tool?.optionalInputs).toContain('passengers');
  });

  test('all returned tools have callMode=call_sendero (Kapso wrapper)', async () => {
    const r = await runListAvailableTools(
      { limit: 50 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    for (const tool of r.tools) {
      expect(tool.callMode).toBe('call_sendero');
    }
  });
});

describe('list_available_tools — pagination', () => {
  test('limit truncates and sets truncated=true when total > limit', async () => {
    const r = await runListAvailableTools(
      { limit: 2 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.tools.length).toBe(2);
    expect(r.total).toBeGreaterThan(2);
    expect(r.truncated).toBe(true);
  });

  test('limit larger than total → truncated=false', async () => {
    const r = await runListAvailableTools(
      { limit: 50 } as ListAvailableToolsInput,
      sandboxCtx,
      deps
    );
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.truncated).toBe(false);
  });
});
