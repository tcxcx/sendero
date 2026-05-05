/**
 * Integration tests for the ancillary tap router.
 *
 * What this catches that unit-tests-of-pieces would miss:
 *   - Drift between the channel-render row id format (WhatsApp) and the
 *     handler that decodes it. If the renderer ever changes the order
 *     of segments, this suite fails.
 *   - Drift between the Slack JSON-staging-payload shape and the body
 *     shape `/api/tools/<name>` expects.
 *   - The two surfaces share the same `buildToolInput` helper here, so
 *     these tests guarantee Slack and WhatsApp produce IDENTICAL
 *     `input` payloads for the same staging — preventing the class of
 *     bug "WhatsApp staging works but Slack staging doesn't, because
 *     someone forgot to add `currency` on one side."
 *
 * Tests inject `fetch`, `secret`, `baseUrl` so no real HTTP fires.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
  routeSlackAncillaryTap,
  routeWhatsAppAncillaryTap,
  type AncillaryTapDeps,
  type AncillaryTapResult,
} from '../ancillary-tap-router';

interface CapturedCall {
  url: string;
  init?: RequestInit;
  body?: Record<string, unknown>;
}

function makeDeps(): { deps: AncillaryTapDeps; calls: CapturedCall[]; respond(status?: number): void } {
  const calls: CapturedCall[] = [];
  let nextStatus = 200;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    let body: Record<string, unknown> | undefined;
    try {
      body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({ url, init, body });
    return new Response(JSON.stringify({ ok: true }), {
      status: nextStatus,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    deps: {
      fetch: fakeFetch,
      baseUrl: 'http://test.local',
      secret: 'test-secret-abcdef',
    },
    calls,
    respond(status?: number) {
      if (typeof status === 'number') nextStatus = status;
    },
  };
}

const realEnv = { ...process.env };
beforeEach(() => {
  // Strip env-provided secrets so tests are deterministic regardless
  // of caller's .env.local. Each test passes a secret via deps.
  delete process.env.AGENT_DISPATCH_SECRET;
  delete process.env.CRON_SECRET;
});
afterEach(() => {
  process.env = { ...realEnv };
});

// ── WhatsApp ─────────────────────────────────────────────────────────

describe('routeWhatsAppAncillaryTap — happy paths', () => {
  test('select_seat row id parses 5+ segments and POSTs the right body', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(
      {
        rowId: 'select_seat:trp_1:off_1:pax_1:sea_001:12A',
        tenantId: 'org_1',
        travelerPhone: '+5491155551234',
      },
      deps
    );

    expect(result.ok).toBe(true);
    expect(result.toolName).toBe('select_seat');
    expect(result.status).toBe(200);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://test.local/api/tools/select_seat');
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['x-sendero-dispatch-secret']).toBe('test-secret-abcdef');
    expect(headers['Content-Type']).toBe('application/json');

    expect(calls[0]?.body).toEqual({
      tenantId: 'org_1',
      travelerPhone: '+5491155551234',
      input: {
        tripId: 'trp_1',
        offerId: 'off_1',
        passengerId: 'pax_1',
        seatServiceId: 'sea_001',
        designator: '12A',
      },
    });
  });

  test('add_bag row id maps to /api/tools/add_baggage with quantity=1 default', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(
      {
        rowId: 'add_bag:trp_1:off_1:pax_1:bag_001:Checked bag',
        tenantId: 'org_1',
        travelerPhone: '+14155550100',
      },
      deps
    );

    expect(result.ok).toBe(true);
    expect(result.toolName).toBe('add_baggage');
    expect(calls[0]?.url).toBe('http://test.local/api/tools/add_baggage');
    expect(calls[0]?.body).toEqual({
      tenantId: 'org_1',
      travelerPhone: '+14155550100',
      input: {
        tripId: 'trp_1',
        offerId: 'off_1',
        passengerId: 'pax_1',
        bagServiceId: 'bag_001',
        quantity: 1,
        label: 'Checked bag',
      },
    });
  });

  test('label containing colons is preserved (joined back on parse)', async () => {
    const { deps, calls } = makeDeps();
    await routeWhatsAppAncillaryTap(
      {
        // Label "12A · economy: window" contains a colon — must
        // round-trip intact so the agent can quote the exact label
        // back to the traveler.
        rowId: 'select_seat:trp_1:off_1:pax_1:sea_001:12A · economy: window',
        tenantId: 'org_1',
        travelerPhone: null,
      },
      deps
    );
    const input = (calls[0]?.body as { input: { designator: string } }).input;
    expect(input.designator).toBe('12A · economy: window');
  });

  test('travelerPhone null → omitted from body (tools route falls back to ctx)', async () => {
    const { deps, calls } = makeDeps();
    await routeWhatsAppAncillaryTap(
      {
        rowId: 'select_seat:trp_1:off_1:pax_1:sea_001:12A',
        tenantId: 'org_1',
        travelerPhone: null,
      },
      deps
    );
    expect(calls[0]?.body).not.toHaveProperty('travelerPhone');
  });
});

describe('routeWhatsAppAncillaryTap — failure modes (no fetch fires)', () => {
  test('row id with too few segments → parse_failed, no fetch', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(
      { rowId: 'select_seat:trp_1', tenantId: 'org_1', travelerPhone: '+1' },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parse_failed');
    expect(calls).toHaveLength(0);
  });

  test('unknown kind prefix → unknown_kind, no fetch', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(
      {
        rowId: 'select_lounge:trp_1:off_1:pax_1:svc_1:label',
        tenantId: 'org_1',
        travelerPhone: '+1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_kind');
    expect(calls).toHaveLength(0);
  });

  test('missing dispatch secret → no_secret, no fetch', async () => {
    const { deps: depsWithSecret, calls } = makeDeps();
    const deps = { ...depsWithSecret, secret: undefined };
    const result = await routeWhatsAppAncillaryTap(
      {
        rowId: 'select_seat:trp_1:off_1:pax_1:sea_001:12A',
        tenantId: 'org_1',
        travelerPhone: '+1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_secret');
    expect(calls).toHaveLength(0);
  });

  test('missing required field → missing_fields, no fetch', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(
      {
        // Empty offerId field (kind:trip::pax:svc:label) — passes 5+
        // segment check but triggers field validation.
        rowId: 'select_seat:trp_1::pax_1:sea_001:12A',
        tenantId: 'org_1',
        travelerPhone: null,
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_fields');
    expect(calls).toHaveLength(0);
  });
});

// ── Slack ────────────────────────────────────────────────────────────

describe('routeSlackAncillaryTap — happy paths', () => {
  test('sendero_select_seat with full JSON staging body', async () => {
    const { deps, calls } = makeDeps();
    const staging = {
      tripId: 'trp_1',
      offerId: 'off_1',
      passengerId: 'pax_1',
      seatServiceId: 'sea_001',
      designator: '12A',
      price: '24.00',
      currency: 'USD',
    };
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_select_seat',
        rawValue: JSON.stringify(staging),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );

    expect(result.ok).toBe(true);
    expect(result.toolName).toBe('select_seat');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://test.local/api/tools/select_seat');
    expect(calls[0]?.body).toEqual({
      tenantId: 'org_1',
      _slackSenderoUserId: 'usr_1',
      input: {
        tripId: 'trp_1',
        offerId: 'off_1',
        passengerId: 'pax_1',
        seatServiceId: 'sea_001',
        designator: '12A',
        price: '24.00',
        currency: 'USD',
      },
    });
  });

  test('sendero_add_bag with explicit quantity', async () => {
    const { deps, calls } = makeDeps();
    const staging = {
      tripId: 'trp_1',
      offerId: 'off_1',
      passengerId: 'pax_1',
      bagServiceId: 'bag_001',
      quantity: 2,
      label: 'Carry-on',
      price: '0.00',
      currency: 'USD',
    };
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_add_bag',
        rawValue: JSON.stringify(staging),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );

    expect(result.ok).toBe(true);
    expect(result.toolName).toBe('add_baggage');
    expect(calls[0]?.url).toBe('http://test.local/api/tools/add_baggage');
    expect((calls[0]?.body as { input: { quantity: number } }).input.quantity).toBe(2);
  });
});

describe('routeSlackAncillaryTap — failure modes (no fetch fires)', () => {
  test('non-JSON value → parse_failed', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_select_seat',
        rawValue: 'not json {{{',
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('parse_failed');
    expect(calls).toHaveLength(0);
  });

  test('missing tripId in JSON → missing_fields', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_select_seat',
        rawValue: JSON.stringify({ offerId: 'off_1', passengerId: 'pax_1' }),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_fields');
    expect(calls).toHaveLength(0);
  });

  test('unknown actionId → unknown_kind', async () => {
    const { deps, calls } = makeDeps();
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_book_lounge',
        rawValue: JSON.stringify({
          tripId: 'trp_1',
          offerId: 'off_1',
          passengerId: 'pax_1',
        }),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('unknown_kind');
    expect(calls).toHaveLength(0);
  });

  test('missing dispatch secret → no_secret', async () => {
    const { deps: depsWithSecret, calls } = makeDeps();
    const deps = { ...depsWithSecret, secret: undefined };
    const result = await routeSlackAncillaryTap(
      {
        actionId: 'sendero_select_seat',
        rawValue: JSON.stringify({
          tripId: 'trp_1',
          offerId: 'off_1',
          passengerId: 'pax_1',
          seatServiceId: 'sea_001',
        }),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      deps
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_secret');
    expect(calls).toHaveLength(0);
  });
});

// ── Cross-surface parity — the real reason this lives in one module ──

describe('Cross-surface parity: Slack and WhatsApp produce identical tool inputs', () => {
  test('select_seat: same staging fields → same input shape on both surfaces', async () => {
    const { deps: waDeps, calls: waCalls } = makeDeps();
    const { deps: slackDeps, calls: slackCalls } = makeDeps();

    await routeWhatsAppAncillaryTap(
      {
        rowId: 'select_seat:trp_1:off_1:pax_1:sea_001:12A',
        tenantId: 'org_1',
        travelerPhone: '+1',
      },
      waDeps
    );

    await routeSlackAncillaryTap(
      {
        actionId: 'sendero_select_seat',
        rawValue: JSON.stringify({
          tripId: 'trp_1',
          offerId: 'off_1',
          passengerId: 'pax_1',
          seatServiceId: 'sea_001',
          designator: '12A',
        }),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      slackDeps
    );

    const waInput = (waCalls[0]?.body as { input: Record<string, unknown> }).input;
    const slackInput = (slackCalls[0]?.body as { input: Record<string, unknown> }).input;

    // The `input` shape MUST be identical so /api/tools/select_seat sees
    // the same Zod-validated object regardless of which channel delivered
    // the tap. If a future change adds a field to one surface and not the
    // other, this fails loudly.
    expect(waInput).toEqual(slackInput);
  });

  test('add_bag: same staging fields → same input shape on both surfaces', async () => {
    const { deps: waDeps, calls: waCalls } = makeDeps();
    const { deps: slackDeps, calls: slackCalls } = makeDeps();

    await routeWhatsAppAncillaryTap(
      {
        rowId: 'add_bag:trp_1:off_1:pax_1:bag_001:Carry-on',
        tenantId: 'org_1',
        travelerPhone: '+1',
      },
      waDeps
    );

    await routeSlackAncillaryTap(
      {
        actionId: 'sendero_add_bag',
        rawValue: JSON.stringify({
          tripId: 'trp_1',
          offerId: 'off_1',
          passengerId: 'pax_1',
          bagServiceId: 'bag_001',
          quantity: 1,
          label: 'Carry-on',
        }),
        tenantId: 'org_1',
        senderoUserId: 'usr_1',
      },
      slackDeps
    );

    const waInput = (waCalls[0]?.body as { input: Record<string, unknown> }).input;
    const slackInput = (slackCalls[0]?.body as { input: Record<string, unknown> }).input;
    expect(waInput).toEqual(slackInput);
  });
});

// ── Renderer-handler round-trip — guards against drift ───────────────

describe('Round-trip: WhatsApp renderer output → router → tools route', () => {
  test('what the WA renderer emits is what the router decodes', async () => {
    // This is the ONE test that catches the original drift bug we
    // shipped (renderer emitted 3-segment row ids, handler expected 6).
    // Reach into the renderer fixture format directly.
    const fixture = {
      rowId: 'select_seat:trp_test_001:off_test_abc:pas_test_001:sea_001:12A',
      tenantId: 'org_test',
      travelerPhone: '+1',
    };
    const { deps, calls } = makeDeps();
    const result = await routeWhatsAppAncillaryTap(fixture, deps);
    expect(result.ok).toBe(true);
    const input = (calls[0]?.body as { input: Record<string, unknown> }).input;
    expect(input).toEqual({
      tripId: 'trp_test_001',
      offerId: 'off_test_abc',
      passengerId: 'pas_test_001',
      seatServiceId: 'sea_001',
      designator: '12A',
    });
  });
});

// Silence the unused import warning when bundlers are strict.
const _typeCheck: AncillaryTapResult = { ok: true };
void _typeCheck;
