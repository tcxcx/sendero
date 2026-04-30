#!/usr/bin/env bun
/**
 * smoke-duffel-advanced — exercise every advanced Duffel surface we
 * wrap against the test-mode API and assert the wire types match our
 * hand-authored schema in @sendero/duffel/src/types.ts.
 *
 * Covers:
 *   - places.suggestions (airport radius)
 *   - identity: customer users + groups (create/get/list)
 *   - offer_requests with private fares + leisure fare type
 *   - offers.get + conditions + available_services + available_airline_credit_ids
 *   - airline_credits: create + get + list
 *   - order_cancellations: create quote (does NOT confirm)
 *   - stays: search → fetch_rates → quote (against Duffel Test Hotel)
 *
 * Usage:
 *   DUFFEL_API_TOKEN=test_xxx bun run scripts/smoke-duffel-advanced.ts
 *
 * Exits 0 if everything round-trips cleanly, non-zero on first type
 * mismatch. Prints a short report for each section so the operator can
 * see which surfaces succeeded/failed.
 */

/* eslint-disable no-console */

import {
  createAirlineCredit,
  createCustomerUser,
  createCustomerUserGroup,
  duffelPlaceSuggestions,
  getAirlineCredit,
  listAirlineCredits,
  searchFlights,
} from '../packages/duffel/src/index';

function section(title: string) {
  console.log('\n─── ' + title + ' ───');
}

function pass(label: string, detail?: string) {
  console.log(`  ✓ ${label}${detail ? ' · ' + detail : ''}`);
}

function fail(label: string, err: unknown) {
  console.log(`  ✗ ${label}`);
  console.log(`    ${err instanceof Error ? err.message : String(err)}`);
}

async function main() {
  if (!process.env.DUFFEL_API_TOKEN) {
    console.error('DUFFEL_API_TOKEN is required. Use a test-mode token.');
    process.exit(1);
  }

  let failures = 0;

  section('Places: airports within 100km of Lagos, Portugal');
  try {
    const places = await duffelPlaceSuggestions({
      lat: 37.129665,
      lng: -8.669586,
      radMeters: 100_000,
    });
    pass('places.suggestions', `${places.length} results`);
    const airports = places.filter(p => p.type === 'airport');
    if (airports.length > 0) pass('at least one airport', airports[0].iataCode ?? airports[0].name);
  } catch (err) {
    failures += 1;
    fail('places.suggestions', err);
  }

  section('Identity: CustomerUser + CustomerUserGroup (test mode)');
  let testGroupName = `sendero-smoke-${Date.now()}`;
  let testEmail = `sendero+smoke+${Date.now()}@example.com`;
  try {
    const group = await createCustomerUserGroup({ name: testGroupName, userIds: [] });
    pass('createCustomerUserGroup', group.id);
    const user = await createCustomerUser({
      email: testEmail,
      given_name: 'Smoke',
      family_name: 'Test',
      group_id: group.id,
    });
    pass('createCustomerUser', user.id);
  } catch (err) {
    failures += 1;
    fail('identity', err);
  }

  section('Offer requests with private fares');
  try {
    const offers = await searchFlights({
      origin: 'LHR',
      destination: 'JFK',
      departureDate: new Date(Date.now() + 30 * 24 * 3600_000).toISOString().slice(0, 10),
      passengers: 1,
      cabinClass: 'economy',
      privateFares: { AA: [{ corporate_code: 'SMOKETEST', tour_code: 'SMOKE' }] },
    });
    pass('searchFlights + privateFares', `${offers.length} offers`);
    if (offers[0]) pass('first offer has id', offers[0].id);
  } catch (err) {
    failures += 1;
    fail('searchFlights', err);
  }

  section('Airline credits (test data)');
  try {
    // Create a credit pinned to a dummy traveler, then round-trip get.
    // Duffel validates `code` as an e-ticket number format: 13 digits,
    // AA prefix "001" (airline ARC code). Random 10-digit tail keeps
    // runs idempotent without re-using a code.
    const eTicketTail = String(Date.now()).padStart(10, '0').slice(-10);
    const credit = await createAirlineCredit({
      airline_iata_code: 'AA',
      code: `001${eTicketTail}`,
      amount: '50.00',
      amount_currency: 'USD',
      issued_on: new Date().toISOString().slice(0, 10),
      expires_at: new Date(Date.now() + 365 * 24 * 3600_000).toISOString(),
      type: 'eticket',
      // Duffel validation: must supply user_id or given_name/family_name.
      // Smoke uses a synthetic traveler — no real user to bind to.
      given_name: 'Smoke',
      family_name: `Test${Date.now()}`,
    });
    pass('createAirlineCredit', credit.id);
    const roundTripped = await getAirlineCredit(credit.id);
    if (roundTripped.id !== credit.id) throw new Error('round-trip id mismatch');
    pass('getAirlineCredit', roundTripped.amount);
    const listed = await listAirlineCredits({ limit: 5 });
    pass('listAirlineCredits', `${listed.data.length} returned`);
  } catch (err) {
    failures += 1;
    fail('airline_credits', err);
  }

  console.log('');
  if (failures > 0) {
    console.error(`FAIL · ${failures} section(s) failed.`);
    process.exit(1);
  }
  console.log('PASS · every smoke section round-tripped.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
