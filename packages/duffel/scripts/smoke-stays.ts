#!/usr/bin/env bun
/**
 * smoke-stays — Duffel Stays end-to-end against the Duffel Test Hotel.
 *
 *   1. Location search around Henderson Island (test hotel coords).
 *   2. Accommodation search with fetch_rates=true on acc_0000AWr2VsUNIF1Vl91xg0.
 *   3. Pick a refundable "Successful Booking by Card" rate.
 *   4. Quote that rate via createStayQuote.
 *   5. Report total + cancellation timeline + conditions.
 *
 *   bun run --cwd packages/duffel scripts/smoke-stays.ts
 *
 * Lives inside packages/duffel because the @duffel/api SDK + @sendero/duffel
 * exports both resolve cleanly from this workspace.
 */

/* eslint-disable no-console */

import { Duffel } from '@duffel/api';

import { createStayQuote, listStayRates } from '../src/index';

const TEST_HOTEL_ID = 'acc_0000AWr2VsUNIF1Vl91xg0';
const HENDERSON_LAT = -24.38;
const HENDERSON_LNG = -128.32;

function pad(n: number) {
  return String(n).padStart(2, '0');
}
function isoDate(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

async function main() {
  const token = process.env.DUFFEL_API_TOKEN;
  if (!token) {
    console.error(
      'DUFFEL_API_TOKEN missing. Run `vercel env pull .env.local` from repo root then re-run with --env-file=.env.local or `bun --env-file=../../.env.local …`.'
    );
    process.exit(1);
  }
  if (!token.startsWith('duffel_test_')) {
    console.error(`Refusing: token is not duffel_test_ (prefix: ${token.slice(0, 12)}…)`);
    process.exit(1);
  }

  const duffel = new Duffel({ token });

  const today = new Date();
  const checkIn = new Date(today.getTime() + 30 * 86_400_000);
  const checkOut = new Date(today.getTime() + 33 * 86_400_000);
  const checkInDate = isoDate(checkIn);
  const checkOutDate = isoDate(checkOut);
  console.log(`Window: ${checkInDate} → ${checkOutDate}\n`);

  console.log('── 1. Location search around Henderson Island');
  const locResp = await duffel.stays.search({
    location: {
      radius: 50,
      geographic_coordinates: { latitude: HENDERSON_LAT, longitude: HENDERSON_LNG },
    },
    check_in_date: checkInDate,
    check_out_date: checkOutDate,
    rooms: 1,
    guests: [{ type: 'adult' }],
  });
  const found = locResp.data?.results ?? [];
  console.log(`  found ${found.length} result(s):`);
  for (const r of found.slice(0, 5)) {
    console.log(
      `    - ${r.accommodation.name}  (id=${r.accommodation.id})  cheapest=${r.cheapest_rate_total_amount ?? '—'} ${r.cheapest_rate_currency ?? ''}`
    );
  }
  const testHit = found.find(r => r.accommodation.id === TEST_HOTEL_ID);
  if (testHit) {
    console.log(`\n  ✓ Test Hotel hit on location search.`);
  } else {
    console.log(
      `\n  (Test Hotel ${TEST_HOTEL_ID} not in 50km radius hit. That's expected — fetching by id next.)`
    );
  }

  console.log('\n── 2. listStayRates(searchResultId)  // exercises the new tool wrapper');
  if (!testHit) {
    console.error('  ✗ Test hotel not in step-1 results — cannot fetch rates.');
    process.exit(1);
  }
  const ratesPayload = await listStayRates(testHit.id);
  console.log(`  hotel: ${ratesPayload.hotelName}  country: ${ratesPayload.country ?? '—'}`);
  console.log(
    `  check-in after ${ratesPayload.checkInAfter ?? '—'}, check-out before ${ratesPayload.checkOutBefore ?? '—'}`
  );
  console.log(`  key collection: ${ratesPayload.keyCollection ?? '(no data — advise on arrival)'}`);
  console.log(`  rates returned: ${ratesPayload.rates.length}`);
  if (!ratesPayload.rates.length) {
    console.error('  ✗ No rates returned. Stays product probably not enabled on this token.');
    process.exit(1);
  }

  console.log('  rate menu:');
  for (const r of ratesPayload.rates) {
    console.log(
      `    • ${r.roomName ?? '—'}  ${r.totalAmount} ${r.totalCurrency}  payment=${r.paymentType ?? '—'}  ${r.refundable ? 'refundable' : 'non-refundable'}  methods=[${r.availablePaymentMethods.join(',')}]  (${r.rateId})`
    );
  }

  const cardRate =
    ratesPayload.rates.find(r => r.roomName === 'Successful Booking by Card' && r.refundable) ??
    ratesPayload.rates.find(r => r.roomName === 'Successful Booking by Card') ??
    ratesPayload.rates.find(r => r.refundable) ??
    ratesPayload.rates[0];
  console.log(
    `\n  → picked: room="${cardRate.roomName ?? '—'}"  ${cardRate.totalAmount} ${cardRate.totalCurrency}  (${cardRate.rateId})`
  );

  console.log('\n── 3. Quote that rate');
  const quote = await createStayQuote(cardRate.rateId);
  console.log(`  quoteId: ${quote.id}`);
  console.log(`  total:   ${quote.total_amount} ${quote.total_currency}`);
  console.log(
    `  due at property: ${quote.due_at_accommodation_amount ?? '0'} ${quote.due_at_accommodation_currency ?? quote.total_currency}`
  );
  console.log(`  payment_type: ${quote.payment_type ?? '—'}`);
  console.log(`  cancellation timeline:`);
  for (const t of quote.cancellation_timeline ?? []) {
    console.log(`    refund ${t.refund_amount} ${t.currency} until ${t.before}`);
  }
  if (!(quote.cancellation_timeline ?? []).length) {
    console.log('    (none — non-refundable)');
  }
  console.log(`  conditions:`);
  for (const c of quote.conditions ?? []) {
    console.log(`    • ${c.title}${c.description ? ` — ${c.description.slice(0, 200)}` : ''}`);
  }
  console.log(`  loyalty programme: ${quote.supported_loyalty_programme?.name ?? '—'}`);

  console.log('\n✅ Stays smoke OK. Booking step is opt-in (uncomment to actually book).');
}

main().catch(err => {
  console.error('\n✗ Smoke failed:', err instanceof Error ? err.message : err);
  if (err && typeof err === 'object' && 'meta' in err) {
    console.error('  meta:', JSON.stringify((err as { meta?: unknown }).meta, null, 2));
  }
  process.exit(1);
});
