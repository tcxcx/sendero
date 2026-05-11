#!/usr/bin/env bun
// Sweep #3 — accommodation chain, ancillaries chain, settlement chain,
// + retries on the 6 transient HTTP 500s from run #2.

import { writeFileSync } from 'node:fs';

const SECRET = (process.env.CRON_SECRET ?? '').replace(/^"|"$/g, '');
const TENANT = process.env.TENANT_ID ?? 'cmo9g3ido0008g6c9padbnu2k';
const USERID = process.env.USER_ID ?? 'cmorbr1nk0000zvaqfkuu7khk';
const BASE = process.env.SENDERO_BASE ?? 'http://localhost:3010';

const PROMPTS = [
  // === Accommodation chain (search → list rates → quote → book) ===
  // The agent needs explicit nudges to chain rather than stopping at search.
  {
    category: 'hotels',
    text: 'DEVMODE search hotels in Mendoza Argentina for two adults, check-in 2026-05-15, check-out 2026-05-17. Then immediately call list_stay_rates on the first result.',
    expected: ['search_hotels', 'list_stay_rates'],
  },
  {
    category: 'hotels',
    text: 'DEVMODE find a hotel in Mendoza for tomorrow, get the room rate matrix, then quote_stay on the cheapest rate.',
    expected: ['search_hotels', 'list_stay_rates', 'quote_stay'],
  },
  {
    category: 'hotels',
    text: 'DEVMODE go all the way: search a hotel in Mendoza for 2026-05-20 to 2026-05-22 for two adults, list rates, quote the cheapest, then book_stay it for traveler +5491112345678. Use whatever quoteId you get.',
    expected: ['search_hotels', 'list_stay_rates', 'quote_stay', 'book_stay'],
  },

  // === Ancillaries chain (search_flights → list_flight_ancillaries → select_seat → add_baggage) ===
  {
    category: 'ancillaries',
    text: 'DEVMODE search flights EZE to MDZ for 2026-05-20, 1 passenger, premium economy. Then call list_flight_ancillaries on the first offer.',
    expected: ['search_flights', 'list_flight_ancillaries'],
  },
  {
    category: 'ancillaries',
    text: 'DEVMODE search flights EZE to MDZ for 2026-05-20, premium economy. List ancillaries on the cheapest offer, then select_seat 14A and add_baggage 1 piece.',
    expected: ['search_flights', 'list_flight_ancillaries', 'select_seat', 'add_baggage'],
  },

  // === Settlement chain (confirm_booking, settle_split) ===
  {
    category: 'settle',
    text: 'DEVMODE call confirm_booking with bookingId=bk_test_smoke, supplierAmountUsdc=300, supplierName=Duffel for traveler +5491112345678.',
    expected: ['confirm_booking'],
  },
  {
    category: 'settle',
    text: 'DEVMODE issue a settle_split for bookingId=bk_test_settle with supplier 60bps, agency 30bps, sendero 10bps on a 500 USDC booking.',
    expected: ['settle_split'],
  },

  // === Retries from run #2 ===
  {
    category: 'wallet-retry',
    text: 'DEVMODE call check_treasury and tell me the corporate USDC + EURC balance on Arc.',
    expected: ['check_treasury'],
  },
  {
    category: 'wallet-retry',
    text: 'DEVMODE call quote_fx for converting 1000 USD to ARS for a booking.',
    expected: ['quote_fx'],
  },
  {
    category: 'concierge-retry',
    text: 'DEVMODE produce a polished restaurant_route_card for Don Belgrano in Mendoza, route from Park Hyatt.',
    expected: ['restaurant_route_card'],
  },
  {
    category: 'visa-retry',
    text: 'DEVMODE call check_travel_eligibility for an upcoming trip to Mendoza.',
    expected: ['check_travel_eligibility'],
  },
  {
    category: 'trips-retry',
    text: 'DEVMODE call get_trip_brief on my most active trip, give me a recap of flights and stays.',
    expected: ['get_trip_brief'],
  },

  // === Bonus: tools we still haven't seen but are in the public catalog ===
  {
    category: 'flights',
    text: 'DEVMODE call cancel_order_quote for order ord_test_xyz to see refund eligibility.',
    expected: ['cancel_order_quote'],
  },
  {
    category: 'flights',
    text: 'DEVMODE list my airline credits — call list_airline_credits.',
    expected: ['list_airline_credits'],
  },
  {
    category: 'flights',
    text: 'DEVMODE call request_order_change for order ord_test_xyz proposing a new outbound on 2026-05-25.',
    expected: ['request_order_change'],
  },
  {
    category: 'identity',
    text: 'DEVMODE create a passenger named Maria Fernandez (mariafernandez+test@example.com) for inbox testing.',
    expected: ['create_passenger'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE call sweep_dcw_to_gateway to push USDC from the traveler DCW back to gateway.',
    expected: ['sweep_dcw_to_gateway'],
  },
  {
    category: 'rep',
    text: 'DEVMODE call submit_validation_response with verdict=approved for validation request val_test_xyz.',
    expected: ['submit_validation_response'],
  },
  {
    category: 'docs',
    text: 'DEVMODE call ensure_flight_customer to keep my traveler synced with the supplier identity layer.',
    expected: ['ensure_flight_customer'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE call swap_and_bridge — bridge 50 USDC from Polygon mainnet into Arc Testnet.',
    expected: ['swap_and_bridge'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE call broadcast_to_group_trip on group gtr_test1 with template trip_intake_v3.',
    expected: ['broadcast_to_group_trip'],
  },
];

interface Result {
  category: string;
  prompt: string;
  expected: string[];
  toolsCalled: string[];
  ok: boolean;
  http: number;
  latencyMs: number;
  errors: string[];
  text: string;
}

async function fireOne(p: (typeof PROMPTS)[0]): Promise<Result> {
  const t0 = Date.now();
  let http = 0;
  let body: any = null;
  let lastErr: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/agent/dispatch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-sendero-dispatch-secret': SECRET },
        body: JSON.stringify({ tenantId: TENANT, userId: USERID, channel: 'web', text: p.text }),
        signal: AbortSignal.timeout(180_000),
      });
      http = res.status;
      body = await res.json().catch(() => ({}));
      lastErr = null;
      break;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      if (attempt < 3) await new Promise(r => setTimeout(r, 5_000));
    }
  }
  if (lastErr) {
    return {
      category: p.category,
      prompt: p.text,
      expected: p.expected ?? [],
      toolsCalled: [],
      ok: false,
      http,
      latencyMs: Date.now() - t0,
      errors: [lastErr],
      text: '',
    };
  }
  const trail: Array<{ toolName: string; ok: boolean; errorMessage?: string }> = body?.trail ?? [];
  const toolsCalled = trail.map(t => t.toolName);
  const failedTrail = trail.filter(t => !t.ok);
  const errors: string[] = [];
  if (http !== 200) errors.push(`HTTP ${http}: ${body?.error ?? body?.message ?? ''}`);
  for (const ft of failedTrail) errors.push(`tool ${ft.toolName} failed: ${ft.errorMessage ?? '(no msg)'}`);
  return {
    category: p.category,
    prompt: p.text,
    expected: p.expected ?? [],
    toolsCalled,
    ok: http === 200 && failedTrail.length === 0,
    http,
    latencyMs: Date.now() - t0,
    errors,
    text: typeof body?.text === 'string' ? body.text.slice(0, 200) : '',
  };
}

async function main() {
  console.log(`firing ${PROMPTS.length} chain+retry prompts at ${BASE}/api/agent/dispatch\n`);
  const results: Result[] = [];
  for (const p of PROMPTS) {
    process.stdout.write(`[${p.category}] ${p.text.slice(0, 70).padEnd(72)}`);
    const r = await fireOne(p);
    results.push(r);
    const icon = r.ok ? 'OK ' : 'FAIL';
    const tools = r.toolsCalled.length ? r.toolsCalled.join(',') : '(no tools)';
    console.log(`  → ${icon}  ${r.latencyMs}ms  [${tools.slice(0, 90)}]`);
    for (const err of r.errors) console.log(`     ERROR: ${err.slice(0, 140)}`);
    await new Promise(r => setTimeout(r, 2_500));
  }
  const calledTools = new Set<string>();
  results.forEach(r => r.toolsCalled.forEach(t => calledTools.add(t)));
  const expectedSet = new Set<string>();
  PROMPTS.forEach(p => (p.expected ?? []).forEach(t => expectedSet.add(t)));
  const hit = [...expectedSet].filter(t => calledTools.has(t));
  const missed = [...expectedSet].filter(t => !calledTools.has(t));
  const failed = results.filter(r => !r.ok);
  console.log('\n========== SUMMARY ==========');
  console.log(`prompts: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`);
  console.log(`distinct tools invoked: ${calledTools.size}`);
  console.log(`expected hit: ${hit.length}/${expectedSet.size}`);
  console.log(`expected missed: ${missed.length} → ${missed.join(', ')}`);
  console.log(`called: ${[...calledTools].sort().join(', ')}`);
  if (failed.length) {
    console.log('\n========== FAILURES ==========');
    for (const f of failed) {
      console.log(`[${f.category}] ${f.prompt}`);
      for (const e of f.errors) console.log(`  ${e}`);
    }
  }
  writeFileSync(
    '/Users/criptopoeta/coding-dojo/sendero/.qa-phase-b/dogfood-results-3.json',
    JSON.stringify({ ranAt: new Date().toISOString(), results, summary: { prompts: results.length, passed: results.length - failed.length, failed: failed.length, toolsHit: [...calledTools].sort(), expectedMissed: missed } }, null, 2)
  );
}
main();
