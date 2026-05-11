#!/usr/bin/env bun
// Autonomous dogfood runner. Fires prompts at /api/agent/dispatch with the
// CRON_SECRET shared secret, captures the tool trail, reports coverage.

import { readFileSync, writeFileSync } from 'node:fs';

const SECRET = (process.env.CRON_SECRET ?? '').replace(/^"|"$/g, '');
const TENANT = process.env.TENANT_ID ?? 'cmo9g3ido0008g6c9padbnu2k';
const USERID = process.env.USER_ID ?? 'cmorbr1nk0000zvaqfkuu7khk';
const BASE = process.env.SENDERO_BASE ?? 'http://localhost:3010';

if (!SECRET) {
  console.error(
    'CRON_SECRET not set. Source .env.local first: `set -a; source .env.local; set +a`'
  );
  process.exit(1);
}

const PROMPTS: Array<{ category: string; text: string; expected?: string[] }> = [
  // Wallet / treasury / MoonPay (the previously-broken set)
  {
    category: 'wallet',
    text: 'DEVMODE what is my wallet balance?',
    expected: ['traveler_balance'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE check the corporate treasury balance',
    expected: ['check_treasury'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE show my recent wallet activity',
    expected: ['gateway_tx_history'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE drip 20 USDC from the testnet faucet',
    expected: ['faucet_drip'],
  },
  {
    category: 'wallet',
    text: 'DEVMODE convert 100 USD to ARS at today rate',
    expected: ['currency_convert', 'quote_fx'],
  },
  { category: 'moonpay', text: 'DEVMODE top up $50 USDC via MoonPay', expected: ['moonpay_topup'] },
  {
    category: 'moonpay',
    text: 'DEVMODE off-ramp $20 from my wallet to USD via MoonPay',
    expected: ['moonpay_offramp'],
  },

  // Reputation
  {
    category: 'reputation',
    text: 'DEVMODE read my reputation score',
    expected: ['read_reputation'],
  },
  {
    category: 'reputation',
    text: 'DEVMODE rate Duffel Airways 5 stars',
    expected: ['give_feedback'],
  },

  // Search & misc
  {
    category: 'search',
    text: 'DEVMODE search the web for vegan restaurants in Mendoza',
    expected: ['web_search'],
  },
  {
    category: 'search',
    text: 'DEVMODE any soccer match in Mendoza this weekend?',
    expected: ['lookup_match_fixtures'],
  },

  // Concierge
  {
    category: 'concierge',
    text: 'DEVMODE what is the weather like in Mendoza this Friday?',
    expected: ['trip_weather_brief'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE check air quality and elevation for Mendoza',
    expected: ['air_quality_brief', 'elevation_risk_brief'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE what is the local timezone in Mendoza?',
    expected: ['timezone_brief'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE what is tipping etiquette in Argentina for parrilla dinner?',
    expected: ['tipping_etiquette'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE give me a local color brief for Mendoza wine country',
    expected: ['local_color_brief'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE recommend 3 parrillas near Plaza Independencia in Mendoza',
    expected: ['recommend_restaurants', 'restaurant_route_card'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE give me an arrival playbook for landing at MDZ',
    expected: ['airport_arrival_playbook'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE plan a coordinated pickup at MDZ at 14:00',
    expected: ['airport_transfer_coordinator'],
  },
  {
    category: 'concierge',
    text: 'DEVMODE compose a travel safety aid brief for Mendoza',
    expected: ['travel_safety_aid'],
  },

  // Address / logistics
  {
    category: 'address',
    text: 'DEVMODE validate this address: Av. San Martín 1234, Mendoza, Argentina',
    expected: ['validate_travel_address', 'geocode_trip_stop'],
  },

  // Identity
  {
    category: 'identity',
    text: 'DEVMODE who operates this WhatsApp number?',
    expected: ['get_operator_agency'],
  },
  {
    category: 'identity',
    text: 'DEVMODE what is Sendero own agent identity on chain?',
    expected: ['get_sendero_identity'],
  },

  // Visa / eligibility
  {
    category: 'visa',
    text: 'DEVMODE do I need a visa to travel from Argentina to Japan?',
    expected: ['check_visa_requirements', 'recommend_visa_application_path'],
  },
  {
    category: 'visa',
    text: 'DEVMODE check if I am eligible for my next trip',
    expected: ['check_travel_eligibility'],
  },

  // Trips
  {
    category: 'trips',
    text: 'DEVMODE what is my active trip?',
    expected: ['get_active_trip', 'get_trip_brief'],
  },
  {
    category: 'trips',
    text: 'DEVMODE remind me about check-in for my next flight',
    expected: ['trip_checkin_reminder'],
  },
  {
    category: 'trips',
    text: 'DEVMODE my flight got delayed 4 hours, replan',
    expected: ['trip_delay_replanner'],
  },
  { category: 'trips', text: 'DEVMODE save my home airport as EZE', expected: ['set_home_iata'] },

  // Flights
  {
    category: 'flights',
    text: 'DEVMODE find me a cheap flight from EZE to MDZ next Friday for one adult economy',
    expected: ['search_flights'],
  },
  {
    category: 'flights',
    text: 'DEVMODE find airports near Mendoza Argentina within 200km',
    expected: ['find_airports_nearby'],
  },

  // Hotels
  {
    category: 'hotels',
    text: 'DEVMODE search hotels in Mendoza for Friday night, 2 guests',
    expected: ['search_hotels', 'list_stay_rates'],
  },

  // eSIM
  {
    category: 'esim',
    text: 'DEVMODE I need an eSIM for 7 days in Argentina with 5GB data',
    expected: ['search_esim'],
  },

  // Policy
  {
    category: 'policy',
    text: 'DEVMODE check this offer against corporate policy: $4500 LATAM business class EZE-MIA',
    expected: ['check_policy'],
  },
  {
    category: 'policy',
    text: 'DEVMODE what is our active markup policy?',
    expected: ['get_tenant_pricing_policy'],
  },

  // Preferences
  {
    category: 'prefs',
    text: 'DEVMODE save my preference: aisle seat, vegetarian meal, no red-eye flights',
    expected: ['save_traveler_preference'],
  },

  // Group trips
  {
    category: 'groups',
    text: 'DEVMODE create a group trip to Bariloche for 4 passengers',
    expected: ['create_group_trip'],
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

  // Retry up to 3 times on transient connection errors (dev-server hot-reload drops sockets).
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/api/agent/dispatch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sendero-dispatch-secret': SECRET,
        },
        body: JSON.stringify({
          tenantId: TENANT,
          userId: USERID,
          channel: 'web',
          text: p.text,
        }),
        signal: AbortSignal.timeout(90_000),
      });
      http = res.status;
      body = await res.json().catch(() => ({}));
      lastErr = null;
      break;
    } catch (e: any) {
      lastErr = e?.message ?? String(e);
      // Connection-refused / fetch-failed → wait and retry
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 3_000));
      }
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
    text: typeof body?.text === 'string' ? body.text.slice(0, 300) : '',
  };
}

async function main() {
  console.log(`firing ${PROMPTS.length} prompts at ${BASE}/api/agent/dispatch`);
  console.log(`tenant=${TENANT}  userId=${USERID}\n`);

  const results: Result[] = [];
  for (const p of PROMPTS) {
    process.stdout.write(`[${p.category}] ${p.text.slice(0, 70).padEnd(72)}`);
    const r = await fireOne(p);
    results.push(r);
    const icon = r.ok ? 'OK ' : 'FAIL';
    const tools = r.toolsCalled.length ? r.toolsCalled.join(',') : '(no tools)';
    console.log(`  → ${icon}  ${r.latencyMs}ms  [${tools.slice(0, 80)}]`);
    if (!r.ok) {
      for (const err of r.errors) console.log(`     ERROR: ${err.slice(0, 140)}`);
    }
    // Brief pause between prompts so dev-server HMR can settle
    await new Promise(r => setTimeout(r, 1_500));
  }

  // Coverage report
  const calledTools = new Set<string>();
  results.forEach(r => r.toolsCalled.forEach(t => calledTools.add(t)));
  const expectedTools = new Set<string>();
  PROMPTS.forEach(p => (p.expected ?? []).forEach(t => expectedTools.add(t)));

  const hitExpected = [...expectedTools].filter(t => calledTools.has(t));
  const missedExpected = [...expectedTools].filter(t => !calledTools.has(t));
  const calledUnexpected = [...calledTools].filter(t => !expectedTools.has(t));

  const failed = results.filter(r => !r.ok);

  console.log('\n========== SUMMARY ==========');
  console.log(`prompts run: ${results.length}`);
  console.log(`HTTP 200 + all tools ok: ${results.length - failed.length}`);
  console.log(`HTTP non-200 OR tool error: ${failed.length}`);
  console.log(`distinct tools invoked: ${calledTools.size}`);
  console.log(`expected tools hit: ${hitExpected.length} / ${expectedTools.size}`);
  console.log(`expected but missed: ${missedExpected.length} → ${missedExpected.join(', ')}`);
  console.log(
    `called but not pre-listed: ${calledUnexpected.length} → ${calledUnexpected.slice(0, 20).join(', ')}`
  );

  if (failed.length) {
    console.log('\n========== FAILURES ==========');
    for (const f of failed) {
      console.log(`[${f.category}] ${f.prompt}`);
      for (const err of f.errors) console.log(`  ${err}`);
    }
  }

  // Persist
  writeFileSync(
    '/Users/criptopoeta/coding-dojo/sendero/.qa-phase-b/dogfood-results.json',
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        tenant: TENANT,
        results,
        summary: {
          prompts: results.length,
          passed: results.length - failed.length,
          failed: failed.length,
          toolsHit: [...calledTools].sort(),
          expectedMissed: missedExpected,
        },
      },
      null,
      2
    )
  );
  console.log('\nresults saved → .qa-phase-b/dogfood-results.json');
}

main();
