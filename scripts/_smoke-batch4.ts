#!/usr/bin/env bun
/**
 * Smoke: B7+B8 pure tools.
 *
 *   bun run scripts/_smoke-batch4.ts
 */

import 'dotenv/config';

import {
  emergencyNumbersCardTool,
  safeRouteHomeTool,
  areaAfterDarkCheckTool,
} from '../packages/tools/src/anticipation/b7-health-safety';
import {
  tripOpportunityRankerTool,
  itineraryGapDetectorTool,
  layoverCityEscapeTool,
  firstDaySoftPlanTool,
  lastDayCheckoutPlanTool,
  tripPacingOptimizerTool,
  groupPreferenceReconcilerTool,
  tripContextualRecommenderTool,
} from '../packages/tools/src/anticipation/b8-trip-intel';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log('\n=== emergency_numbers_card (FR) ===');
const fr = await emergencyNumbersCardTool.handler({ countryCode: 'FR' } as never, ctx);
if (fr.status === 'ok') console.log(`  ${fr.message}`);

console.log('\n=== emergency_numbers_card (JP) ===');
const jp = await emergencyNumbersCardTool.handler({ countryCode: 'JP' } as never, ctx);
if (jp.status === 'ok') {
  console.log(
    `  general:${jp.card.general} police:${jp.card.police} ambulance:${jp.card.ambulance} fire:${jp.card.fire}`
  );
  for (const n of jp.card.notes) console.log(`  · ${n}`);
}

console.log('\n=== area_after_dark_check (Buenos Aires Constitución) ===');
const area = await areaAfterDarkCheckTool.handler(
  { city: 'Buenos Aires', neighborhood: 'Constitución' } as never,
  ctx
);
if (area.status === 'ok')
  console.log(
    `  rating: ${area.rating}${area.notes ? ` — ${area.notes}` : ''} (source=${area.source})`
  );

console.log('\n=== safe_route_home (caution → safe, late, group=1) ===');
const route = await safeRouteHomeTool.handler(
  {
    city: 'Buenos Aires',
    fromAreaScore: 'caution',
    toAreaScore: 'safe',
    distanceKm: 4,
    hourLocal: 1,
    groupSize: 1,
    hasPhone: true,
  } as never,
  ctx
);
if (route.status === 'ok') {
  console.log(`  mode: ${route.recommendedMode}`);
  for (const t of route.tips ?? []) console.log(`  · ${t}`);
}

console.log('\n=== trip_opportunity_ranker (5 candidates, $200 budget, 6h) ===');
const opps = await tripOpportunityRankerTool.handler(
  {
    opportunities: [
      {
        name: 'TeamLab Borderless',
        category: 'museum',
        durationHours: 3,
        approximateCostUsd: 28,
        fitScore: 0.85,
      },
      {
        name: 'Tsukiji food tour',
        category: 'foodie',
        durationHours: 3,
        approximateCostUsd: 90,
        weatherSensitive: true,
      },
      {
        name: 'Kabukiza play',
        category: 'cultural',
        durationHours: 4,
        approximateCostUsd: 120,
        fitScore: 0.6,
      },
      {
        name: 'Tokyo Tower viewpoint',
        category: 'tourist',
        durationHours: 1.5,
        approximateCostUsd: 15,
      },
      {
        name: '8h Mt Fuji day-trip',
        category: 'outdoors',
        durationHours: 10,
        approximateCostUsd: 120,
        weatherSensitive: true,
      },
    ],
    travelerHobbies: ['museum', 'foodie', 'specialty coffee'],
    budgetRemainingUsd: 200,
    hoursAvailable: 6,
    weatherIsPoor: true,
  } as never,
  ctx
);
if (opps.status === 'ok') {
  for (const o of opps.ranked)
    console.log(`  ${o.score.toFixed(2)}  ${o.name}  ·  ${o.reasons.join(' · ')}`);
}

console.log('\n=== itinerary_gap_detector ===');
const gaps = await itineraryGapDetectorTool.handler(
  {
    itinerary: [
      {
        title: 'Breakfast',
        startsAtIso: '2026-05-10T08:00:00Z',
        endsAtIso: '2026-05-10T09:00:00Z',
      },
      {
        title: 'Museum visit',
        startsAtIso: '2026-05-10T10:00:00Z',
        endsAtIso: '2026-05-10T12:00:00Z',
      },
      { title: 'Dinner', startsAtIso: '2026-05-10T19:00:00Z', endsAtIso: '2026-05-10T21:00:00Z' },
    ],
    minGapMinutes: 120,
  } as never,
  ctx
);
if (gaps.status === 'ok') {
  console.log(`  ${gaps.message}`);
  for (const g of gaps.gaps)
    console.log(`  · ${g.startsAtIso} → ${g.endsAtIso} (${g.durationMinutes}min)`);
}

console.log('\n=== layover_city_escape (300min, with visa, no checked bags) ===');
const layover = await layoverCityEscapeTool.handler(
  {
    airportIata: 'NRT',
    cityName: 'Tokyo',
    layoverDurationMinutes: 300,
    travelerHasVisa: true,
    hasCheckedBags: false,
  } as never,
  ctx
);
if (layover.status === 'ok') {
  console.log(`  canEscape=${layover.canEscape} maxStay=${layover.maxStayMinutes}min`);
  for (const t of layover.tips) console.log(`  · ${t}`);
}

console.log('\n=== first_day_soft_plan (12h flight, east, evening arrival) ===');
const fd = await firstDaySoftPlanTool.handler(
  {
    city: 'Tokyo',
    arrivalLocalIso: '2026-05-10T18:30:00+09:00',
    flightDurationHours: 12,
    jetlagDirection: 'east',
  } as never,
  ctx
);
if (fd.status === 'ok') {
  console.log(`  recommendation: ${fd.recommendation}`);
  for (const m of fd.moves) console.log(`  · ${m}`);
}

console.log('\n=== last_day_checkout_plan (5h gap) ===');
const ld = await lastDayCheckoutPlanTool.handler(
  {
    city: 'Tokyo',
    hotelCheckoutTimeIso: '2026-05-15T11:00:00+09:00',
    flightDepartureIso: '2026-05-15T19:30:00+09:00',
    hasCheckedBags: true,
  } as never,
  ctx
);
if (ld.status === 'ok') {
  console.log(`  gap=${ld.gapMinutes}min, needsLuggageStorage=${ld.needsLuggageStorage}`);
  for (const m of ld.moves) console.log(`  · ${m}`);
}

console.log('\n=== trip_pacing_optimizer (overloaded day) ===');
const pace = await tripPacingOptimizerTool.handler(
  {
    events: [
      {
        title: 'Morning hike',
        startsAtIso: '2026-05-10T07:00:00Z',
        durationMinutes: 240,
        intensity: 'high',
      },
      {
        title: 'Museum + lunch',
        startsAtIso: '2026-05-10T12:00:00Z',
        durationMinutes: 180,
        intensity: 'high',
      },
      {
        title: 'Cocktail bar',
        startsAtIso: '2026-05-10T19:00:00Z',
        durationMinutes: 120,
        intensity: 'high',
      },
      {
        title: 'Late dinner',
        startsAtIso: '2026-05-10T21:30:00Z',
        durationMinutes: 180,
        intensity: 'high',
      },
    ],
  } as never,
  ctx
);
if (pace.status === 'ok') {
  for (const o of pace.overloaded) console.log(`  ${o.date}: ${o.warning}`);
  for (const r of pace.recommendations) console.log(`  · ${r}`);
}

console.log('\n=== group_preference_reconciler (3 members, mixed) ===');
const grp = await groupPreferenceReconcilerTool.handler(
  {
    groupName: 'Friends-Tokyo',
    members: [
      {
        name: 'A',
        budgetTier: 'medium',
        dietaryRestrictions: ['no shellfish'],
        ambiencePreference: 'quiet',
        activityPreferences: ['ramen', 'specialty coffee', 'museum'],
      },
      {
        name: 'B',
        budgetTier: 'budget',
        ambiencePreference: 'medium',
        activityPreferences: ['ramen', 'specialty coffee'],
      },
      {
        name: 'C',
        budgetTier: 'premium',
        dietaryRestrictions: ['vegetarian'],
        activityPreferences: ['museum', 'specialty coffee', 'galleries'],
      },
    ],
  } as never,
  ctx
);
if (grp.status === 'ok') {
  console.log(
    `  consensus: tier=${grp.consensus.tier}, ambience=${grp.consensus.ambience}, dietary=${grp.consensus.dietaryUnion.join(', ')}`
  );
  console.log(`  shared activities: ${grp.consensus.sharedActivities.join(', ')}`);
  for (const t of grp.tensions) console.log(`  ! ${t}`);
}

console.log('\n=== trip_contextual_recommender (jet-lag situation) ===');
const cr = await tripContextualRecommenderTool.handler(
  {
    city: 'Tokyo',
    situation:
      'I just landed after a 14h flight, totally exhausted, jet-lagged, want something low-key tonight near my hotel.',
  } as never,
  ctx
);
if (cr.status === 'ok')
  console.log(`  intent=${cr.intent} → tool=${cr.suggestedTool}\n  why: ${cr.why}`);
