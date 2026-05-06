#!/usr/bin/env bun
/**
 * Smoke: mainstream_event_discovery (Ticketmaster Discovery v2).
 *
 *   bun run scripts/_smoke-ticketmaster.ts "Los Angeles" Music
 *   bun run scripts/_smoke-ticketmaster.ts "Buenos Aires"
 *
 * Env: TICKETMASTER_API_KEY.
 */

import 'dotenv/config';

import { runMainstreamEventDiscovery } from '../packages/tools/src/anticipation/mainstream-event-discovery';
import type { ToolContext } from '../packages/tools/src/types';

const [city = 'Los Angeles', segment] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(
  `\n› mainstream_event_discovery({ city: "${city}"${segment ? `, segment: "${segment}"` : ''} })\n`
);

const input: Record<string, unknown> = { city, limit: 10 };
if (segment) input.segment = segment;

const r = await runMainstreamEventDiscovery(input as never, ctx);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(`events: ${r.events.length}\n`);
for (const e of r.events) {
  console.log(`• ${e.name}  [${e.segment ?? '?'}/${e.genre ?? '?'}]`);
  if (e.startsAtIso) console.log(`    when: ${e.startsAtIso}`);
  if (e.venueName) console.log(`    venue: ${e.venueName}${e.city ? `, ${e.city}` : ''}`);
  if (typeof e.priceMin === 'number')
    console.log(`    price: ${e.currency ?? 'USD'} ${e.priceMin}-${e.priceMax ?? '?'}`);
  console.log(`    url: ${e.url}`);
  console.log();
}
