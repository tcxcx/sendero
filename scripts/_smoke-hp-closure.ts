#!/usr/bin/env bun
/**
 * Smoke: HP1/HP2/HP3 closure tools (pure-only paths, no CSE/Places).
 *
 *   bun run scripts/_smoke-hp-closure.ts
 *
 * Exercises taste_feedback_loop + date_profile_builder + date_plan_ranker
 * + date_weather_replan + date_route_safety_check end-to-end. Skips
 * tools that need CSE / Places (covered separately).
 */

import 'dotenv/config';

import { runDateProfileBuilder } from '../packages/tools/src/anticipation/date-closure';
import {
  runDatePlanRanker,
  runDateWeatherReplan,
  runDateRouteSafetyCheck,
} from '../packages/tools/src/anticipation/date-closure';
import { runTasteFeedbackLoop } from '../packages/tools/src/anticipation/taste-feedback-loop';
import type { ToolContext } from '../packages/tools/src/types';

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log('\n=== date_profile_builder ===');
const profile = await runDateProfileBuilder(
  {
    travelerId: 'usr_smoke',
    budgetTier: 'medium',
    preferredVibe: 'romantic',
    preferredAmbience: 'quiet',
    preferredFormality: 'medium',
    avoid: ['loud techno', 'wine snobs'],
    dietaryRestrictions: ['no shellfish'],
  } as never,
  ctx
);
console.log(profile.status === 'ok' ? `✓ ${profile.message}` : `✗ ${profile.message}`);
if (profile.status === 'ok') {
  console.log(`  budget=${profile.profile.budgetTier} vibe=${profile.profile.preferredVibe} avoid=[${profile.profile.avoid.join(', ')}]`);
}

console.log('\n=== date_plan_ranker (3 candidates) ===');
const ranker = await runDatePlanRanker(
  {
    city: 'Buenos Aires',
    plans: [
      {
        label: 'wine bar → parrilla → walk',
        vibe: 'romantic',
        stops: [
          { name: 'Aldo\'s', category: 'wine_bar', role: 'opener', ambience: 'quiet', walkMinutesFromPrev: 0 },
          { name: 'Don Julio', category: 'mid_restaurant', role: 'anchor', ambience: 'medium', walkMinutesFromPrev: 8 },
          { name: 'Avenida Alvear walk', category: 'walk_home', role: 'exit', ambience: 'quiet', walkMinutesFromPrev: 4, weatherSensitive: true },
        ],
      },
      {
        label: 'rooftop → tasting → cocktail',
        vibe: 'romantic',
        stops: [
          { name: 'Trade Sky Bar', category: 'rooftop_bar', role: 'opener', ambience: 'loud', walkMinutesFromPrev: 0, weatherSensitive: true },
          { name: 'Tegui', category: 'tasting_menu', role: 'anchor', ambience: 'medium', walkMinutesFromPrev: 18 },
          { name: 'Florería Atlántico', category: 'cocktail_bar', role: 'second_move', ambience: 'medium', walkMinutesFromPrev: 14 },
        ],
      },
      {
        label: 'casual cafe → mid → dessert',
        vibe: 'casual',
        stops: [
          { name: 'Felix Felicis', category: 'cafe', role: 'opener', ambience: 'quiet', walkMinutesFromPrev: 0 },
          { name: 'Anchoíta', category: 'mid_restaurant', role: 'anchor', ambience: 'quiet', walkMinutesFromPrev: 6 },
          { name: 'Rapanui', category: 'late_dessert', role: 'exit', ambience: 'quiet', walkMinutesFromPrev: 2 },
        ],
      },
    ],
    preferredVibe: 'romantic',
    preferredAmbience: 'quiet',
    weatherIsPoor: false,
    walkMinutesCap: 20,
  } as never,
  ctx
);
if (ranker.status === 'ok' && ranker.ranked) {
  for (const p of ranker.ranked) {
    console.log(`  ${p.score.toFixed(2)}  ${p.label.padEnd(35)}  ${p.reasons.join(' · ')}`);
  }
}

console.log('\n=== date_weather_replan (rain + 1 weather-sensitive stop) ===');
const replan = await runDateWeatherReplan(
  {
    city: 'Buenos Aires',
    plan: {
      label: 'wine → parrilla → walk',
      stops: [
        { name: 'Aldo\'s', category: 'wine_bar', role: 'opener' },
        { name: 'Don Julio', category: 'mid_restaurant', role: 'anchor' },
        { name: 'Avenida Alvear walk', category: 'walk_home', role: 'exit', weatherSensitive: true },
      ],
    },
    weather: { condition: 'rain', precipitationProbability: 0.7, temperatureC: 14 },
  } as never,
  ctx
);
if (replan.status === 'ok') {
  console.log(`  needsReplan: ${replan.needsReplan}`);
  for (const r of replan.recommendations ?? []) console.log(`  · ${r}`);
}

console.log('\n=== date_route_safety_check ===');
const safety = await runDateRouteSafetyCheck(
  {
    city: 'Buenos Aires',
    stops: [
      { name: 'Aldo\'s', neighborhood: 'Recoleta', atIso: '2026-05-09T20:00:00-03:00' },
      { name: 'Don Julio', neighborhood: 'Palermo Soho', atIso: '2026-05-09T21:30:00-03:00' },
      { name: 'Walk home', neighborhood: 'Constitución', atIso: '2026-05-10T00:30:00-03:00' },
    ],
    neighborhoodNotes: {
      Recoleta: 'safe',
      'Palermo Soho': 'mostly_safe',
      Constitución: 'avoid',
    },
  } as never,
  ctx
);
if (safety.status === 'ok') {
  for (const v of safety.verdicts ?? []) {
    console.log(`  [${v.verdict.padEnd(7)}]  ${v.stop}${v.notes.length ? ` — ${v.notes.join('; ')}` : ''}`);
  }
  console.log(`\n  recommendations:`);
  for (const r of safety.recommendations ?? []) console.log(`  · ${r}`);
}

console.log('\n=== taste_feedback_loop (loved + reasons) ===');
const fb = await runTasteFeedbackLoop(
  {
    travelerId: 'usr_smoke',
    placeName: 'Don Julio',
    category: 'mid_restaurant',
    city: 'Buenos Aires',
    action: 'loved',
    reasons: ['great_value', 'great_service'],
    note: 'The Ojo de Bife was perfect, room felt warm despite the crowd.',
  } as never,
  ctx
);
console.log(fb.status === 'ok' ? `✓ ${fb.message}` : `✗ ${fb.message}`);
if (fb.status === 'ok') {
  console.log(`  signals=${fb.signalsWritten} newPrefs=${fb.newPreferences?.length ?? 0} updated=${fb.updatedPreferences?.length ?? 0}`);
}
