#!/usr/bin/env bun
// Re-run only the gaps from run-1.

import { writeFileSync } from 'node:fs';

const SECRET = (process.env.CRON_SECRET ?? '').replace(/^"|"$/g, '');
const TENANT = process.env.TENANT_ID ?? 'cmo9g3ido0008g6c9padbnu2k';
const USERID = process.env.USER_ID ?? 'cmorbr1nk0000zvaqfkuu7khk';
const BASE = process.env.SENDERO_BASE ?? 'http://localhost:3010';

const PROMPTS = [
  // Re-test the one that connection-dropped
  {
    category: 'hotels',
    text: 'DEVMODE search hotels in Mendoza Argentina for two adults checking in 2026-05-15 checking out 2026-05-17',
    expected: ['search_hotels', 'list_stay_rates'],
  },
  // Targeted prompts for the 9 tools not invoked in run 1
  {
    category: 'wallet',
    text: 'DEVMODE call check_treasury directly and tell me the corporate USDC + EURC on Arc',
    expected: ['check_treasury'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE quote FX for converting 1000 USD into ARS for booking purposes',
    expected: ['quote_fx'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE give me a polished restaurant route card for Don Belgrano in Mendoza',
    expected: ['restaurant_route_card'],
  },
  {
    category: 'visa',
    text: 'DEVMODE check_travel_eligibility for my upcoming Mendoza trip',
    expected: ['check_travel_eligibility'],
  },
  {
    category: 'trips',
    text: 'DEVMODE call get_trip_brief on my active trip',
    expected: ['get_trip_brief'],
  },
  {
    category: 'trips',
    text: 'DEVMODE generate a check-in reminder for my next flight',
    expected: ['trip_checkin_reminder'],
  },
  {
    category: 'trips',
    text: 'DEVMODE my flight AR1234 EZE to MDZ tomorrow has been cancelled. Replan everything.',
    expected: ['trip_delay_replanner'],
  },
  {
    category: 'esim',
    text: 'DEVMODE search eSIM plans for Argentina, do not book yet — just show me the options',
    expected: ['search_esim'],
  },
  // Flight booking with phone (exercises confirm_booking + invoice path)
  {
    category: 'flights',
    text: 'DEVMODE search and hold the cheapest flight EZE to MDZ next Friday for traveler phone +54911 12345678',
    expected: ['search_flights', 'book_flight'],
  },
  // Trip lifecycle
  {
    category: 'trips',
    text: 'DEVMODE create a new trip to Bariloche for this weekend, set kind=round_trip',
    expected: ['create_trip', 'set_trip_kind'],
  },
  {
    category: 'trips',
    text: 'DEVMODE complete my current trip, I am back home',
    expected: ['complete_trip'],
  },
  // Address logistics
  {
    category: 'address',
    text: 'DEVMODE geocode this stop: Hotel Park Hyatt Mendoza Plaza Independencia',
    expected: ['geocode_trip_stop'],
  },
  // Identity prepare-signin
  {
    category: 'identity',
    text: 'DEVMODE prepare a sign-in link for traveler phone +54911 9876543',
    expected: ['prepare_traveler_signin'],
  },
  // Pay link / claim flow
  {
    category: 'settle',
    text: 'DEVMODE issue a single-use magic-link payment URL for booking off_test1',
    expected: ['send_pay_link'],
  },
  // Take-me-home
  {
    category: 'concierge',
    text: 'DEVMODE take me home, I am stuck in MDZ',
    expected: ['take_me_home'],
  },
  // Display offer conditions
  {
    category: 'flights',
    text: 'DEVMODE show me the change/refund conditions for offer off_test_xyz',
    expected: ['display_offer_conditions'],
  },
  // Group seat claim
  {
    category: 'groups',
    text: 'DEVMODE add me to group trip gtr_test1 — claim my seat with token tk_xyz',
    expected: ['claim_group_seat'],
  },
  // OG-image / route map
  {
    category: 'concierge',
    text: 'DEVMODE export my Mendoza route as a Google Maps shareable link',
    expected: ['export_route_map'],
  },
  // Bridge / swap
  {
    category: 'wallet',
    text: 'DEVMODE bridge 100 USDC from Polygon mainnet into Arc Testnet',
    expected: ['bridge_to_arc', 'swap_and_bridge'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE swap 5 USDC into EURC at the best price',
    expected: ['swap_tokens'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE send 2 USDC from corporate treasury to address 0x1111…1111',
    expected: ['send_tokens'],
  },
  // Reputation request validation
  {
    category: 'reputation',
    text: 'DEVMODE request validation that my last booking happened, choose any Sendero validator',
    expected: ['request_validation'],
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
        signal: AbortSignal.timeout(120_000),
      });
      http = res.status;
      body = await res.json().catch(() => ({}));
      lastErr = null;
      break;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      if (attempt < 3) await new Promise(r => setTimeout(r, 4_000));
    }
  }
  if (lastErr)
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

  const trail: Array<{ toolName: string; ok: boolean; errorMessage?: string }> = body?.trail ?? [];
  const toolsCalled = trail.map(t => t.toolName);
  const failedTrail = trail.filter(t => !t.ok);
  const errors: string[] = [];
  if (http !== 200) errors.push(`HTTP ${http}: ${body?.error ?? body?.message ?? ''}`);
  for (const ft of failedTrail)
    errors.push(`tool ${ft.toolName} failed: ${ft.errorMessage ?? '(no msg)'}`);
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
  console.log(`firing ${PROMPTS.length} gap prompts at ${BASE}/api/agent/dispatch\n`);
  const results: Result[] = [];
  for (const p of PROMPTS) {
    process.stdout.write(`[${p.category}] ${p.text.slice(0, 70).padEnd(72)}`);
    const r = await fireOne(p);
    results.push(r);
    const icon = r.ok ? 'OK ' : 'FAIL';
    const tools = r.toolsCalled.length ? r.toolsCalled.join(',') : '(no tools)';
    console.log(`  → ${icon}  ${r.latencyMs}ms  [${tools.slice(0, 80)}]`);
    for (const err of r.errors) console.log(`     ERROR: ${err.slice(0, 140)}`);
    await new Promise(r => setTimeout(r, 2_000));
  }
  const calledTools = new Set<string>();
  results.forEach(r => r.toolsCalled.forEach(t => calledTools.add(t)));
  const failed = results.filter(r => !r.ok);
  console.log('\n========== SUMMARY ==========');
  console.log(
    `prompts: ${results.length}, passed: ${results.length - failed.length}, failed: ${failed.length}`
  );
  console.log(
    `distinct tools invoked: ${calledTools.size} → ${[...calledTools].sort().join(', ')}`
  );
  if (failed.length) {
    console.log('\n========== FAILURES ==========');
    for (const f of failed) {
      console.log(`[${f.category}] ${f.prompt}`);
      for (const e of f.errors) console.log(`  ${e}`);
    }
  }
  writeFileSync(
    '/Users/criptopoeta/coding-dojo/sendero/.qa-phase-b/dogfood-results-2.json',
    JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)
  );
}
main();
