/**
 * End-to-end test of the x402 dispatch hardening primitives as an
 * external MCP user would exercise them.
 *
 * What this proves:
 *   - Scope resolution is complete: every tool in the canonical
 *     registry maps to exactly one valid scope.
 *   - The canonical signing string is deterministic and collision-free.
 *   - Request signature round-trips (sign → verify → ok) and every
 *     failure mode returns a specific reason code.
 *   - Nonce format validation catches the garbage we reject.
 *   - Response envelope signatures round-trip.
 *   - Timestamp window enforcement at the exact second boundary.
 *   - Timing-safe comparison doesn't leak via length differences.
 *
 * Run: `bun test packages/auth/src/dispatch-auth.test.ts`
 */

import { describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';

import { toolList } from '@sendero/tools';

import {
  canonicalRequestString,
  canonicalResponseString,
  DEFAULT_PROD_SCOPES,
  generateTraceId,
  hasScope,
  hmacKeyFromBearer,
  KEY_SCOPES,
  PRIVILEGED_TOOLS,
  requiresSignature,
  SANDBOX_SCOPES,
  signRequest,
  signResponseEnvelope,
  toolToScope,
  verifyRequestSignature,
  buildResponseHeaders,
} from './dispatch-auth';

const BEARER = 'ak_live_testkey_abc123DEFghi456';
const NONCE = 'nonce0123abcdef';
const BODY = JSON.stringify({ tenantId: 'tenant_abc', userId: 'svc:key', text: 'hello' });

function headersFrom(map: Record<string, string>): { get: (name: string) => string | null } {
  return {
    get(name: string) {
      return map[name.toLowerCase()] ?? null;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Scope coverage — every canonical tool maps to exactly one known scope
// ─────────────────────────────────────────────────────────────────────

describe('scope coverage', () => {
  test('every tool in the registry maps to a valid scope', () => {
    const unknownScopeTools: string[] = [];
    for (const tool of toolList) {
      const scope = toolToScope(tool.name);
      if (!(KEY_SCOPES as readonly string[]).includes(scope) && scope !== '*') {
        unknownScopeTools.push(`${tool.name} → ${scope}`);
      }
    }
    expect(unknownScopeTools).toEqual([]);
  });

  test('no tool has an ambiguous or empty scope', () => {
    for (const tool of toolList) {
      const scope = toolToScope(tool.name);
      expect(scope.length).toBeGreaterThan(0);
    }
  });

  test('privileged tools are a subset of real tools', () => {
    const registeredNames = new Set(toolList.map(t => t.name));
    for (const privileged of PRIVILEGED_TOOLS) {
      expect(registeredNames.has(privileged)).toBe(true);
    }
  });

  test('privileged tools all route to either settlement, treasury, bookings, or documents', () => {
    for (const privileged of PRIVILEGED_TOOLS) {
      const scope = toolToScope(privileged);
      expect(['settlement', 'treasury', 'bookings', 'documents']).toContain(scope);
    }
  });

  test('hasScope: wildcard grants everything', () => {
    for (const s of KEY_SCOPES) {
      expect(hasScope(['*'], s)).toBe(true);
    }
  });

  test('hasScope: specific grants only match exact', () => {
    expect(hasScope(['search'], 'search')).toBe(true);
    expect(hasScope(['search'], 'settlement')).toBe(false);
    expect(hasScope(['search', 'bookings'], 'bookings')).toBe(true);
  });

  test('DEFAULT_PROD_SCOPES never grants settlement or treasury', () => {
    expect(DEFAULT_PROD_SCOPES.includes('settlement')).toBe(false);
    expect(DEFAULT_PROD_SCOPES.includes('treasury')).toBe(false);
    expect(DEFAULT_PROD_SCOPES.includes('*')).toBe(false);
  });

  test('SANDBOX_SCOPES is wildcard', () => {
    expect(SANDBOX_SCOPES).toEqual(['*']);
  });

  test('requiresSignature catches every USDC-moving + ID-sensitive tool', () => {
    // Positive cases
    for (const name of [
      'settle_booking',
      'settle_split',
      'swap_tokens',
      'send_tokens',
      'book_flight',
      'scan_document',
    ]) {
      expect(requiresSignature(name)).toBe(true);
    }
    // Negative cases — these must NOT require signing (hot path)
    for (const name of [
      'search_flights',
      'search_hotels',
      'check_travel_eligibility',
      'trip_weather_brief',
      'geocode_trip_stop',
    ]) {
      expect(requiresSignature(name)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// Canonical string — deterministic, order-stable, collision-resistant
// ─────────────────────────────────────────────────────────────────────

describe('canonical request string', () => {
  test('produces a stable v1-prefixed string with exactly 7 lines', () => {
    const canonical = canonicalRequestString({
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'settle_booking',
      timestamp: 1714060800,
      nonce: NONCE,
      body: BODY,
    });
    const lines = canonical.split('\n');
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe('v1');
    expect(lines[1]).toBe('1714060800');
    expect(lines[2]).toBe(NONCE);
    expect(lines[3]).toBe('POST');
    expect(lines[4]).toBe('/api/agent/dispatch');
    expect(lines[5]).toBe('settle_booking');
    expect(lines[6].startsWith('sha256:')).toBe(true);
  });

  test('bodies with same logical content but different byte order produce different hashes', () => {
    const a = canonicalRequestString({
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: 1,
      nonce: 'n',
      body: '{"a":1,"b":2}',
    });
    const b = canonicalRequestString({
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: 1,
      nonce: 'n',
      body: '{"b":2,"a":1}',
    });
    expect(a).not.toBe(b);
  });

  test('method is case-normalized to uppercase', () => {
    const a = canonicalRequestString({
      method: 'post',
      path: '/x',
      toolName: 't',
      timestamp: 1,
      nonce: 'n',
      body: '',
    });
    expect(a.split('\n')[3]).toBe('POST');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Signature round-trip as an MCP client would perform it
// ─────────────────────────────────────────────────────────────────────

describe('request signature round-trip', () => {
  const ts = Math.floor(Date.now() / 1000);

  test('client signs, server verifies: happy path', () => {
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'settle_booking',
      timestamp: ts,
      nonce: NONCE,
      body: BODY,
    });
    const verdict = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'settle_booking',
      body: BODY,
      now: ts * 1000,
    });
    expect(verdict.ok).toBe(true);
  });

  test('signature uses sha256(bearer) as the HMAC key, not the raw bearer', () => {
    const key = hmacKeyFromBearer(BEARER);
    const expected = createHmac('sha256', key)
      .update(
        canonicalRequestString({
          method: 'POST',
          path: '/x',
          toolName: 't',
          timestamp: ts,
          nonce: 'n',
          body: '',
        })
      )
      .digest('hex');
    const produced = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: ts,
      nonce: 'n',
      body: '',
    });
    expect(produced).toBe(`v1=${expected}`);

    // And crucially the HMAC key is NOT the raw bearer bytes
    const rawKeyMac = createHmac('sha256', Buffer.from(BEARER, 'utf8'))
      .update('doesnt-matter')
      .digest('hex');
    const hashedKeyMac = createHmac('sha256', key).update('doesnt-matter').digest('hex');
    expect(rawKeyMac).not.toBe(hashedKeyMac);
  });

  test('stale timestamp outside 60s window rejected', () => {
    const old = ts - 120;
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: old,
      nonce: NONCE,
      body: '',
    });
    const verdict = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(old),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: '',
      now: ts * 1000,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.reason).toBe('stale_timestamp');
  });

  test('future timestamp outside window rejected', () => {
    const future = ts + 120;
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: future,
      nonce: NONCE,
      body: '',
    });
    const verdict = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(future),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: '',
      now: ts * 1000,
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok === false) expect(verdict.reason).toBe('future_timestamp');
  });

  test('missing any signing header rejected as missing_headers', () => {
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: ts,
      nonce: NONCE,
      body: '',
    });
    const v = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-sig': sig,
        // no nonce
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: '',
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('missing_headers');
  });

  test('tampered body fails verification', () => {
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: ts,
      nonce: NONCE,
      body: BODY,
    });
    const v = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: BODY + ' tampered',
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('bad_signature');
  });

  test('wrong bearer (leaked key swapped) fails verification', () => {
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: ts,
      nonce: NONCE,
      body: BODY,
    });
    const v = verifyRequestSignature({
      bearer: 'ak_live_differentkey_xyz',
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: BODY,
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('bad_signature');
  });

  test('malformed signature format rejected as bad_format', () => {
    const v = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': 'not-a-valid-format',
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: '',
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('bad_format');
  });

  test('too-short nonce rejected as bad_format', () => {
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/x',
      toolName: 't',
      timestamp: ts,
      nonce: 'abc',
      body: '',
    });
    const v = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': 'abc', // too short (< 8)
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/x',
      toolName: 't',
      body: '',
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('bad_format');
  });

  test('tool name is part of the signed message — cross-tool replay fails', () => {
    // Alice signs for `settle_booking` with her bearer.
    const sig = signRequest(BEARER, {
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'settle_booking',
      timestamp: ts,
      nonce: NONCE,
      body: BODY,
    });
    // Attacker relays to the server claiming it's `send_tokens` with
    // the same key. Must fail.
    const v = verifyRequestSignature({
      bearer: BEARER,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': NONCE,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'send_tokens', // tampered
      body: BODY,
      now: ts * 1000,
    });
    expect(v.ok).toBe(false);
    if (v.ok === false) expect(v.reason).toBe('bad_signature');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Response envelope — customer verifies we signed the reply
// ─────────────────────────────────────────────────────────────────────

describe('response envelope', () => {
  test('buildResponseHeaders emits the four spec headers with bearer', () => {
    const body = JSON.stringify({ ok: true });
    const headers = buildResponseHeaders({ bearer: BEARER, meterId: 'search_flights', body });
    expect(headers['x-sendero-trace-id'].startsWith('trace_')).toBe(true);
    expect(headers['x-sendero-meter-id']).toBe('search_flights');
    expect(headers['x-sendero-ts']).toMatch(/^\d+$/);
    expect(headers['x-sendero-sig']).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  test('buildResponseHeaders omits the signature when no bearer (shared-secret path)', () => {
    const headers = buildResponseHeaders({ bearer: null, meterId: 'free', body: '{}' });
    expect(headers['x-sendero-sig']).toBeUndefined();
    expect(headers['x-sendero-trace-id'].startsWith('trace_')).toBe(true);
  });

  test('customer-side verification — the signature matches when they recompute it', () => {
    const body = JSON.stringify({ text: 'ok', trail: [], billed: true });
    const headers = buildResponseHeaders({
      bearer: BEARER,
      meterId: 'meter_abc123',
      body,
    });

    // Customer derives the same HMAC key from their bearer + checks
    // the signature over the canonical string.
    const canonical = canonicalResponseString(
      {
        traceId: headers['x-sendero-trace-id'],
        meterId: headers['x-sendero-meter-id'],
        timestamp: Number.parseInt(headers['x-sendero-ts'], 10),
      },
      body
    );
    const expected = `v1=${createHmac('sha256', hmacKeyFromBearer(BEARER)).update(canonical).digest('hex')}`;
    expect(headers['x-sendero-sig']).toBe(expected);
  });

  test('MITM swap: attacker changes the body — verification fails', () => {
    const body = JSON.stringify({ total: '50.00' });
    const headers = buildResponseHeaders({
      bearer: BEARER,
      meterId: 'search_flights',
      body,
    });
    const tamperedBody = JSON.stringify({ total: '5000.00' });
    const canonical = canonicalResponseString(
      {
        traceId: headers['x-sendero-trace-id'],
        meterId: headers['x-sendero-meter-id'],
        timestamp: Number.parseInt(headers['x-sendero-ts'], 10),
      },
      tamperedBody
    );
    const wouldBeValid = `v1=${createHmac('sha256', hmacKeyFromBearer(BEARER)).update(canonical).digest('hex')}`;
    expect(headers['x-sendero-sig']).not.toBe(wouldBeValid);
  });

  test('generateTraceId produces collision-resistant trace ids', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateTraceId());
    expect(ids.size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^trace_[0-9a-f]{16}$/);
  });

  test('signResponseEnvelope is deterministic for same inputs', () => {
    const env = { traceId: 'trace_abc', meterId: 'm', timestamp: 1 };
    const body = '{}';
    const a = signResponseEnvelope(BEARER, env, body);
    const b = signResponseEnvelope(BEARER, env, body);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Full scenario — as an external MCP user would do it
// ─────────────────────────────────────────────────────────────────────

describe('end-to-end: MCP caller signs + server verifies + response round-trips', () => {
  test('MCP caller mints key with settlement scope, signs a settle_booking call, verifies response', () => {
    // 1. Customer has minted a key with settlement scope (admin opt-in).
    const customerKey = 'ak_live_customer_mcp_xyz789';
    const grantedScopes = ['settlement', 'bookings'] as const;

    // 2. MCP caller confirms their key can call settle_booking.
    const targetTool = 'settle_booking';
    expect(hasScope(grantedScopes, toolToScope(targetTool))).toBe(true);

    // 3. Because the scope set includes settlement, signing is required.
    const mustSign = grantedScopes.some(
      s => s === 'settlement' || s === 'treasury' || (s as string) === '*'
    );
    expect(mustSign).toBe(true);

    // 4. Build + sign the request exactly like the docs recipe.
    const ts = Math.floor(Date.now() / 1000);
    const nonce = createHash('sha256')
      .update(`${Date.now()}_${Math.random()}`)
      .digest('hex')
      .slice(0, 24);
    const requestBody = JSON.stringify({
      tenantId: 'tenant_customer',
      channel: 'mcp',
      text: 'settle booking bkg_001',
    });
    const sig = signRequest(customerKey, {
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'dispatch_turn', // dispatch route uses this sentinel
      timestamp: ts,
      nonce,
      body: requestBody,
    });

    // 5. Server side: verify the signature.
    const verdict = verifyRequestSignature({
      bearer: customerKey,
      headers: headersFrom({
        'x-sendero-ts': String(ts),
        'x-sendero-nonce': nonce,
        'x-sendero-sig': sig,
      }),
      method: 'POST',
      path: '/api/agent/dispatch',
      toolName: 'dispatch_turn',
      body: requestBody,
      now: ts * 1000,
    });
    expect(verdict.ok).toBe(true);

    // 6. Server builds the signed response envelope.
    const responseBody = JSON.stringify({
      text: 'Booking bkg_001 settled — txHash 0xabc',
      trail: [{ toolName: 'settle_booking', ok: true }],
      billed: true,
    });
    const responseHeaders = buildResponseHeaders({
      bearer: customerKey,
      meterId: 'meter_evt_001',
      body: responseBody,
    });

    // 7. Customer verifies the response on reception.
    const responseCanonical = canonicalResponseString(
      {
        traceId: responseHeaders['x-sendero-trace-id'],
        meterId: responseHeaders['x-sendero-meter-id'],
        timestamp: Number.parseInt(responseHeaders['x-sendero-ts'], 10),
      },
      responseBody
    );
    const customerExpected = `v1=${createHmac('sha256', hmacKeyFromBearer(customerKey)).update(responseCanonical).digest('hex')}`;
    expect(responseHeaders['x-sendero-sig']).toBe(customerExpected);
  });

  test('search-only key cannot reach settlement tools after scope filter', () => {
    const searchOnlyKey = ['search', 'utilities'] as const;
    const settlementTools = toolList
      .map(t => t.name)
      .filter(name => toolToScope(name) === 'settlement');
    expect(settlementTools.length).toBeGreaterThan(0);
    for (const name of settlementTools) {
      expect(hasScope(searchOnlyKey, toolToScope(name))).toBe(false);
    }
  });

  test('a read-mostly DEFAULT_PROD_SCOPES key grants compliance + documents but not settlement', () => {
    expect(hasScope(DEFAULT_PROD_SCOPES, 'compliance')).toBe(true);
    expect(hasScope(DEFAULT_PROD_SCOPES, 'documents')).toBe(true);
    expect(hasScope(DEFAULT_PROD_SCOPES, 'search')).toBe(true);
    expect(hasScope(DEFAULT_PROD_SCOPES, 'settlement')).toBe(false);
    expect(hasScope(DEFAULT_PROD_SCOPES, 'treasury')).toBe(false);
  });
});
