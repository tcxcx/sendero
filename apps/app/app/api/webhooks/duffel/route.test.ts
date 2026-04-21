/**
 * Integration tests for POST /api/webhooks/duffel.
 *
 * These hit a real dev server (default http://localhost:3010, matching
 * `bun run dev`). Skip cleanly when no server is reachable so CI and
 * unit runs don't flake.
 *
 *   SMOKE_BASE_URL=http://localhost:3010 \
 *   DUFFEL_WEBHOOK_SECRET=<secret> \
 *   bun test apps/app/app/api/webhooks/duffel/route.test.ts
 */

import { test, expect } from 'bun:test';
import { createHmac } from 'node:crypto';

const BASE_URL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3010';
const SECRET = process.env.DUFFEL_WEBHOOK_SECRET ?? '';

function sign(body: string) {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

async function isServerUp(): Promise<boolean> {
  try {
    const r = await fetch(BASE_URL, { signal: AbortSignal.timeout(2000) });
    return r.ok || r.status === 404 || r.status === 307;
  } catch {
    return false;
  }
}

const serverUp = await isServerUp();
const haveSecret = SECRET.length > 0;

test('unknown orderId returns 200 matched:false', async () => {
  if (!serverUp || !haveSecret) return;
  const body = JSON.stringify({
    id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'order.updated',
    data: { id: `ord_unknown_${Date.now()}`, status: 'ticketed' },
  });
  const res = await fetch(`${BASE_URL}/api/webhooks/duffel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-duffel-signature': sign(body) },
    body,
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.matched).toBe(false);
});

test('duplicate event returns 200 deduped:true', async () => {
  if (!serverUp || !haveSecret) return;
  const id = `evt_dup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const body = JSON.stringify({
    id,
    type: 'order.updated',
    data: { id: `ord_${Date.now()}`, status: 'ticketed' },
  });
  const headers = { 'content-type': 'application/json', 'x-duffel-signature': sign(body) };

  const first = await fetch(`${BASE_URL}/api/webhooks/duffel`, { method: 'POST', headers, body });
  expect(first.status).toBe(200);

  const second = await fetch(`${BASE_URL}/api/webhooks/duffel`, { method: 'POST', headers, body });
  expect(second.status).toBe(200);
  const json = await second.json();
  expect(json.deduped).toBe(true);
});

test('bad signature returns 401', async () => {
  if (!serverUp || !haveSecret) return;
  const body = '{"id":"evt_bad","type":"order.updated","data":{"id":"x","status":"ticketed"}}';
  const res = await fetch(`${BASE_URL}/api/webhooks/duffel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-duffel-signature': 'deadbeef' },
    body,
  });
  expect(res.status).toBe(401);
});
