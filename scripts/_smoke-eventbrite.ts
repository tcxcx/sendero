#!/usr/bin/env bun
/**
 * Smoke: eventbrite_event_discovery (Eventbrite destination → CSE fallback).
 *
 *   bun run scripts/_smoke-eventbrite.ts "Buenos Aires" "founder"
 *   bun run scripts/_smoke-eventbrite.ts "Tokyo"
 *
 * Env: EVENTBRITE_PRIVATE_TOKEN (already in .env.local).
 *      Optional: GOOGLE_CUSTOM_SEARCH_API_KEY + GOOGLE_CUSTOM_SEARCH_ENGINE_ID
 *      for the CSE fallback.
 */

import 'dotenv/config';

import { runEventbriteEventDiscovery } from '../packages/tools/src/anticipation/eventbrite-event-discovery';
import type { ToolContext } from '../packages/tools/src/types';

const [city = 'Buenos Aires', keywords] = process.argv.slice(2);

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(`\n› eventbrite_event_discovery({ city: "${city}"${keywords ? `, keywords: "${keywords}"` : ''} })\n`);

const r = await runEventbriteEventDiscovery(
  { city, ...(keywords ? { keywords } : {}), limit: 8, languageCode: 'en' } as never,
  ctx
);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

console.log(`via: ${r.via}    events: ${r.events.length}\n`);
for (const e of r.events) {
  console.log(`• [${e.source}] ${e.name}`);
  if (e.startsAtIso) console.log(`    when: ${e.startsAtIso}`);
  if (e.venueName) console.log(`    venue: ${e.venueName}`);
  console.log(`    url: ${e.url}`);
  if (e.summary) console.log(`    "${e.summary.slice(0, 120)}…"`);
  console.log();
}
