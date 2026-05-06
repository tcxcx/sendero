/**
 * hobby_concierge_discover — HP1 Tool 3 (high-level entry).
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP1 + roadmap §HP1 #3.
 *
 * Single high-level entry point that hides HP1 complexity from the LLM.
 * The traveler asks "build my Tokyo pack" — the agent calls this tool
 * with `mode: 'arrival_pack'` and receives a turnkey response.
 *
 * Internally routes by `mode`:
 *   - 'arrival_pack' / 'today' / 'tomorrow' / 'build_city_list' →
 *     `city_taste_map_builder` with full layers
 *   - 'foodie' → `foodie_shortlist_builder`
 *   - 'work_from_cafe' → `work_from_cafe_ranker`
 *   - 'networking' → `professional_networking_scanner`
 *   - 'map' → `city_taste_map_builder` with mapping-priority order
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

import { runCityTasteMapBuilder } from './city-taste-map-builder';
import { runFoodieShortlistBuilder } from './foodie-shortlist-builder';
import { runProfessionalNetworkingScanner } from './professional-networking-scanner';
import { runWorkFromCafeRanker } from './work-from-cafe-ranker';

const MODES = [
  'arrival_pack',
  'today',
  'tomorrow',
  'work_from_cafe',
  'foodie',
  'networking',
  'map',
  'build_city_list',
] as const;

const inputSchema = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  travelerId: z.string().max(120).optional(),
  languageCode: z.string().max(10).default('en'),
  mode: z.enum(MODES).default('arrival_pack'),
  /** Optional traveler hobbies — passed to the foodie / networking subtools as keywords. */
  hobbies: z.array(z.string().max(40)).max(10).optional(),
});

export type HobbyConciergeDiscoverInput = z.infer<typeof inputSchema>;

export interface HobbyConciergeSection {
  title: string;
  items: Array<{
    name: string;
    reason?: string;
    url?: string;
    expectedSpend?: string;
  }>;
}

export interface HobbyConciergeDiscoverResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  summary?: string;
  sections?: HobbyConciergeSection[];
  recommendedNextAction?: string;
}

function deriveNetworkingSlot(hobbies?: string[]): 'founder' | 'ai' | 'web3' | 'design' | 'tech' | 'pro' {
  if (!hobbies?.length) return 'founder';
  const blob = hobbies.join(' ').toLowerCase();
  if (/web3|crypto|ethereum|blockchain/.test(blob)) return 'web3';
  if (/\bai\b|machine learning|llm|ml/.test(blob)) return 'ai';
  if (/design|ux|product/.test(blob)) return 'design';
  if (/tech|developer|engineer/.test(blob)) return 'tech';
  if (/founder|startup|builder/.test(blob)) return 'founder';
  return 'pro';
}

export async function runHobbyConciergeDiscover(
  rawInput: HobbyConciergeDiscoverInput,
  ctx?: ToolContext
): Promise<HobbyConciergeDiscoverResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = inputSchema.parse(rawInput);
  const networkingSlot = deriveNetworkingSlot(input.hobbies);

  switch (input.mode) {
    case 'work_from_cafe': {
      const r = await runWorkFromCafeRanker(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          languageCode: input.languageCode,
          ...(input.travelerId ? { travelerId: input.travelerId } : {}),
          limit: 8,
        } as never,
        ctx
      );
      if (r.status !== 'ok') {
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.message,
        };
      }
      return {
        status: 'ok',
        message: r.message,
        summary: `${r.shops.length} laptop-friendly cafés in ${input.city}.`,
        sections: [
          {
            title: 'Laptop-friendly cafés',
            items: r.shops.map(s => ({
              name: s.name,
              ...(s.website ? { url: s.website } : {}),
              reason: s.workSignals.length > 0 ? s.workSignals.join(' · ') : s.rationale,
            })),
          },
        ],
      };
    }

    case 'foodie': {
      const r = await runFoodieShortlistBuilder(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          languageCode: input.languageCode,
          ...(input.travelerId ? { travelerId: input.travelerId } : {}),
          perCategoryLimit: 4,
        } as never,
        ctx
      );
      if (r.status !== 'ok') {
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.status === 'production_refused' ? r.message : r.message,
        };
      }
      return {
        status: 'ok',
        message: `${r.totalPicks} foodie picks across ${r.sections.length} categories in ${input.city}.`,
        summary: r.summary,
        sections: r.sections.map(sec => ({
          title: sec.title,
          items: sec.picks.map(p => ({
            name: p.name,
            ...(p.website ? { url: p.website } : {}),
            reason: p.rationale,
            ...(p.budget?.moneyTalk ? { expectedSpend: p.budget.moneyTalk } : {}),
          })),
        })),
      };
    }

    case 'networking': {
      const r = await runProfessionalNetworkingScanner(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          slot: networkingSlot,
          perSourceLimit: 4,
          totalLimit: 12,
          languageCode: input.languageCode,
        } as never,
        ctx
      );
      if (r.status !== 'ok' || !r.events) {
        return {
          status: r.status === 'production_refused' ? 'production_refused' : 'unavailable',
          message: r.message,
        };
      }
      return {
        status: 'ok',
        message: r.message,
        summary: `${r.events.length} ${networkingSlot} events in ${input.city}.`,
        sections: [
          {
            title: `${networkingSlot} events`,
            items: r.events.map(e => ({
              name: e.name,
              url: e.url,
              reason: e.summary ?? `via ${e.source}`,
            })),
          },
        ],
      };
    }

    // arrival_pack / today / tomorrow / map / build_city_list → full taste map.
    default: {
      const r = await runCityTasteMapBuilder(
        {
          city: input.city,
          ...(input.countryCode ? { countryCode: input.countryCode } : {}),
          ...(input.travelerId ? { travelerId: input.travelerId } : {}),
          languageCode: input.languageCode,
          categories: ['foodie', 'work_from_cafes', 'networking'],
          networkingSlot,
          perCategoryLimit: 4,
        } as never,
        ctx
      );
      if (r.status !== 'ok' || !r.layers) {
        return { status: r.status, message: r.message };
      }
      return {
        status: 'ok',
        message: r.message,
        summary: `${input.city} pack: ${r.layers.map(l => `${l.items.length} ${l.title.toLowerCase()}`).join(', ')}.`,
        sections: r.layers.map(l => ({
          title: l.title,
          items: l.items.map(it => ({
            name: it.name,
            ...(it.url ? { url: it.url } : {}),
            ...(it.rationale ? { reason: it.rationale } : it.summary ? { reason: it.summary } : {}),
            ...(it.moneyTalk ? { expectedSpend: it.moneyTalk } : {}),
          })),
        })),
        recommendedNextAction: r.topMoveToday
          ? `${r.topMoveToday.title} — ${r.topMoveToday.why}`
          : undefined,
      };
    }
  }
}

export const hobbyConciergeDiscoverTool: ToolDef<
  HobbyConciergeDiscoverInput,
  HobbyConciergeDiscoverResult
> = {
  name: 'hobby_concierge_discover',
  internal: true,
  experimental: true,
  description:
    "Single high-level entry for the HP1 anticipatory concierge. Pick `mode`: 'arrival_pack' / 'today' / 'tomorrow' / 'map' / 'build_city_list' (full city taste map), 'foodie' (food shortlist only), 'work_from_cafe' (laptop spots), 'networking' (founder/AI/etc events). Auto-derives the networking slot from optional `hobbies` keywords. Use as the FIRST anticipatory call when the traveler asks 'build my <city> pack', 'plan my <city> trip', 'what should I do in <city>'.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['city'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      travelerId: { type: 'string', maxLength: 120 },
      languageCode: { type: 'string', maxLength: 10 },
      mode: { type: 'string', enum: [...MODES] },
      hobbies: {
        type: 'array',
        maxItems: 10,
        items: { type: 'string', maxLength: 40 },
      },
    },
  },
  handler: runHobbyConciergeDiscover,
};
