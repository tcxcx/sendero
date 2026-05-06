/**
 * AI-driven E2E for the HP1 anticipation tools (hobby_profile_builder +
 * city_bucket_list_manager).
 *
 * Drives a REAL LLM through realistic conversational turns with both
 * tools registered as AI-SDK tools. Stubbed deps so the LLM gets
 * deterministic results without touching the dev DB. Verifies that:
 *
 *   1. Free-text traveler messages → the model picks the RIGHT tool
 *      (hobby_profile_builder for preferences, city_bucket_list_manager
 *      for "save"/"loved"/"skip" actions on places).
 *   2. The model normalizes phrasings into canonical hobby keys
 *      (specialty_coffee, ramen, founder_networking, date_spots, etc.).
 *   3. Bucket-list actions get the right `action` enum based on the
 *      traveler's intent ("save" / "loved" / "skip" / "recommend_to_friend").
 *   4. Locale fidelity holds — Spanish in, Spanish out (the silence-policy
 *      sibling test asserts this for prompt-only turns; this asserts it
 *      survives a tool-calling turn).
 *
 * Skip-if-absent: OPENAI_API_KEY. Cost-bounded — every call uses
 * gpt-4o-mini, max 3 steps per turn.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP1 + Appendix A.4.
 */

import { describe, expect, test } from 'bun:test';
import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

import {
  type CityBucketListManagerDeps,
  runCityBucketListManager,
} from '../anticipation/city-bucket-list-manager';
import {
  type HobbyProfileBuilderDeps,
  runHobbyProfileBuilder,
} from '../anticipation/hobby-profile-builder';
import type { ToolContext } from '../types';

const HAS_KEY = Boolean(process.env.OPENAI_API_KEY);
const AGENT_MODEL = 'gpt-4o-mini';
const itAi = HAS_KEY ? test : test.skip;

if (!HAS_KEY) {
  console.warn(
    '[hobby-concierge.e2e] Skipping — set OPENAI_API_KEY to enable. ' +
      'Verifies HP1 anticipation tools surface correctly under real LLM tool-calling.'
  );
}

/**
 * Subset of the dispatch routing rules slab focused on HP1 anticipation.
 * Mirrors what we'll push to Langfuse `sendero-dispatch-routing-rules`
 * once the experimental flag flips. Keeping the slab here means the e2e
 * stays anchored to the exact contract under test.
 */
const SYSTEM_PROMPT = `You are Sendero — a precise, locally fluent AI travel concierge.

You build long-term taste graphs of every traveler so future trips feel anticipatory rather than reactive. The current turn is on a dev/sandbox call, so the experimental anticipation tools are available.

## Tools you should reach for

- hobby_profile_builder — when the traveler EXPRESSES OR IMPLIES a preference
  (food, places, activities, working style, social style). Examples:
  "I love specialty coffee", "always look for cheap Michelin", "I'm a founder
  who likes meeting other builders", "find me a beautiful date spot".
  Call ONCE per turn with all detected preferences in explicitPreferences.
  travelerId is the traveler's User.id from context.
- city_bucket_list_manager — when the traveler reacts to a SPECIFIC PLACE.
  "Save Mameya Kakeru to my Tokyo bucket list" → action='save'.
  "We went to Maido in Lima and it was incredible" → action='loved'.
  "Skip that tourist trap café" → action='skip'.
  "I'd take a friend back here" → action='recommend_to_friend'.
  Always pass the city (where the place is, not where the traveler lives now).

## Style

- Reply concisely in the user's language (Spanish for es-AR/es-MX, English otherwise).
- Confirm what you saved + show the traveler you understood. Don't restate the whole list.
- NEVER ask follow-up questions before saving — the tools are idempotent.
- After tool calls, your turn is OVER.`;

interface CapturedCall {
  toolName: string;
  input: Record<string, unknown>;
}

function makeCtx(): ToolContext {
  return {
    traveler: { tenantId: 'org_e2e_hobby', userId: 'usr_e2e_hobby', name: 'Tomas' },
    caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
  };
}

/**
 * Stub deps for hobby_profile_builder. State lives in a Map so a single
 * turn that lands two preferences upserts both rows. Captures the
 * upsert calls so tests can assert on the canonical hobby keys the
 * model normalized to.
 */
function makeHobbyDeps(): {
  deps: HobbyProfileBuilderDeps;
  upserts: Array<{ key: string; priority: string }>;
} {
  const upserts: Array<{ key: string; priority: string }> = [];
  const rows = new Map<string, { priority: string; notes: string | null }>();
  const deps: HobbyProfileBuilderDeps = {
    async findEntry(_userId, key) {
      return rows.get(key) ?? null;
    },
    async upsertEntry({ key, priority, notes }) {
      rows.set(key, { priority, notes });
      upserts.push({ key, priority });
    },
    async listEntries(_userId) {
      return Array.from(rows.entries()).map(([key, r]) => ({
        key,
        priority: r.priority,
        notes: r.notes,
        avoid: [],
        preferredTimeOfDay: null,
        preferredBudget: null,
      }));
    },
  };
  return { deps, upserts };
}

function makeBucketDeps(): {
  deps: CityBucketListManagerDeps;
  upserts: Array<{ city: string; name: string; status: string }>;
} {
  const upserts: Array<{ city: string; name: string; status: string }> = [];
  const rows = new Map<string, { id: string; status: any }>();
  let counter = 1;
  const deps: CityBucketListManagerDeps = {
    async findItem({ userId, city, name, placeId }) {
      const k = `${userId}|${city}|${placeId ?? name}`;
      return rows.get(k) ?? null;
    },
    async upsertItem({ userId, city, name, placeId, status }) {
      const id = `bli_e2e_${counter++}`;
      const k = `${userId}|${city}|${placeId ?? name}`;
      rows.set(k, { id, status });
      upserts.push({ city, name, status: String(status) });
      return { id, status };
    },
    async updateItemStatus({ id, status }) {
      for (const [k, v] of rows.entries()) {
        if (v.id === id) {
          rows.set(k, { id, status });
          return { id, status };
        }
      }
      throw new Error('not found');
    },
  };
  return { deps, upserts };
}

interface AgentTurnResult {
  text: string;
  calls: CapturedCall[];
  hobbyUpserts: Array<{ key: string; priority: string }>;
  bucketUpserts: Array<{ city: string; name: string; status: string }>;
}

async function runAgentTurn(userMessage: string): Promise<AgentTurnResult> {
  const ctx = makeCtx();
  const hobby = makeHobbyDeps();
  const bucket = makeBucketDeps();
  const calls: CapturedCall[] = [];

  const tools = {
    hobby_profile_builder: tool({
      description:
        "Build or update the traveler's taste graph from explicit preferences and inferred signals. Use whenever the traveler expresses or implies a preference. Priority escalates but never downgrades.",
      inputSchema: z.object({
        travelerId: z.string(),
        tripId: z.string().optional(),
        explicitPreferences: z.array(z.string()).max(20).optional(),
        inferredSignals: z
          .array(
            z.object({
              source: z.enum(['chat', 'saved_place', 'visited', 'feedback', 'booking', 'manual']),
              value: z.string(),
              confidence: z.enum(['low', 'medium', 'high']),
            })
          )
          .max(40)
          .optional(),
      }),
      execute: async input => {
        calls.push({ toolName: 'hobby_profile_builder', input });
        return runHobbyProfileBuilder(input as any, ctx, hobby.deps);
      },
    }),
    city_bucket_list_manager: tool({
      description:
        'Save / love / skip / revisit / recommend-to-friend feedback on city discoveries. Closes the taste-graph feedback loop — every action improves future ranking.',
      inputSchema: z.object({
        travelerId: z.string(),
        city: z.string(),
        item: z.object({
          name: z.string(),
          category: z.string(),
          placeId: z.string().optional(),
          url: z.string().optional(),
        }),
        action: z.enum(['save', 'visited', 'loved', 'skip', 'revisit', 'recommend_to_friend']),
      }),
      execute: async input => {
        calls.push({ toolName: 'city_bucket_list_manager', input });
        return runCityBucketListManager(input as any, ctx, bucket.deps);
      },
    }),
  };

  const result = await generateText({
    model: openai.chat(AGENT_MODEL),
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
    tools,
    stopWhen: ({ steps }) => steps.length >= 3,
  });

  return {
    text: result.text,
    calls,
    hobbyUpserts: hobby.upserts,
    bucketUpserts: bucket.upserts,
  };
}

describe('HP1 anticipation — hobby_profile_builder via real LLM', () => {
  itAi(
    'multi-hobby English: extracts specialty_coffee + ramen + founder_networking',
    async () => {
      const r = await runAgentTurn(
        "Heading to Tokyo for a week. I'm into specialty coffee, ramen, and meeting other founders."
      );

      const hobbyCall = r.calls.find(c => c.toolName === 'hobby_profile_builder');
      expect(hobbyCall, 'expected hobby_profile_builder to be called').toBeDefined();

      // Assert canonical keys landed via the upsert path. The model can
      // pass the prefs in any order and any phrasing; the
      // normalize_hobby_key inside the tool maps them.
      const keys = r.hobbyUpserts.map(u => u.key);
      expect(keys).toContain('specialty_coffee');
      expect(keys).toContain('ramen');
      expect(keys).toContain('founder_networking');
      // Priority should be 'high' for explicit prefs.
      const coffeeUpsert = r.hobbyUpserts.find(u => u.key === 'specialty_coffee');
      expect(coffeeUpsert?.priority).toBe('high');
    },
    45_000
  );

  itAi(
    'Spanish: "me encanta el café de tercera ola y los ramen" → specialty_coffee + ramen',
    async () => {
      const r = await runAgentTurn(
        'Voy a Tokio. Me encanta el café de tercera ola, los ramen y los lugares para citas con onda.'
      );

      const keys = r.hobbyUpserts.map(u => u.key);
      expect(keys).toContain('specialty_coffee');
      expect(keys).toContain('ramen');
      expect(keys).toContain('date_spots');

      // Reply should be in Spanish — quick heuristic.
      const looksSpanish = /[áéíóúñ]|encanta|guardé|anoté|listo|perfecto/i.test(r.text);
      expect(looksSpanish, `expected Spanish reply; got: ${r.text.slice(0, 200)}`).toBe(true);
    },
    45_000
  );

  itAi(
    'taste-graph dimension: "I always look for cheap Michelin" → cheap_michelin',
    async () => {
      const r = await runAgentTurn(
        'When I travel I always look for cheap Michelin restaurants — Bib Gourmand stuff.'
      );

      const keys = r.hobbyUpserts.map(u => u.key);
      expect(keys.some(k => k === 'cheap_michelin' || k === 'bib_gourmand')).toBe(true);
    },
    45_000
  );

  itAi(
    'inferred signal: "we went to two ramen places" → low/medium-confidence inferred entry',
    async () => {
      const r = await runAgentTurn(
        'On my last trip we went to two ramen places — both were great, kept seeing them on lists.'
      );

      // Either explicit 'ramen' or an inferredSignals entry pointing at ramen.
      const hobbyCall = r.calls.find(c => c.toolName === 'hobby_profile_builder');
      expect(hobbyCall).toBeDefined();
      const input = (hobbyCall?.input ?? {}) as {
        explicitPreferences?: string[];
        inferredSignals?: Array<{ value: string; confidence: string }>;
      };
      const allValues = [
        ...(input.explicitPreferences ?? []),
        ...(input.inferredSignals?.map(s => s.value) ?? []),
      ]
        .join(' ')
        .toLowerCase();
      expect(allValues.includes('ramen')).toBe(true);
    },
    45_000
  );
});

describe('HP1 anticipation — city_bucket_list_manager via real LLM', () => {
  itAi(
    'save: "Save Koffee Mameya Kakeru to my Tokyo bucket list" → action=save',
    async () => {
      const r = await runAgentTurn('Save Koffee Mameya Kakeru to my Tokyo bucket list please.');

      expect(r.bucketUpserts.length).toBe(1);
      expect(r.bucketUpserts[0]?.city).toBe('Tokyo');
      // Name normalization is the model's call — accept any string that
      // contains "Mameya" or the typical short form.
      expect(/mameya/i.test(r.bucketUpserts[0]?.name ?? '')).toBe(true);
      // 'save' maps to want_to_visit per actionToStatus().
      expect(r.bucketUpserts[0]?.status).toBe('want_to_visit');
    },
    45_000
  );

  itAi(
    'loved: "We went to Maido in Lima and it was incredible" → action=loved',
    async () => {
      const r = await runAgentTurn('We went to Maido in Lima last weekend — it was incredible.');

      expect(r.bucketUpserts.length).toBe(1);
      expect(r.bucketUpserts[0]?.city).toBe('Lima');
      expect(/maido/i.test(r.bucketUpserts[0]?.name ?? '')).toBe(true);
      // 'loved' is a distinct status enum value.
      expect(r.bucketUpserts[0]?.status).toBe('loved');
    },
    45_000
  );

  itAi(
    'skip: "skip the touristy café — totally overrated" → action=skip',
    async () => {
      const r = await runAgentTurn(
        "There's a touristy place called Café Central in Mexico City — skip it, totally overrated."
      );

      expect(r.bucketUpserts.length).toBe(1);
      expect(r.bucketUpserts[0]?.city).toBe('Mexico City');
      expect(r.bucketUpserts[0]?.status).toBe('skip');
    },
    45_000
  );
});

describe('HP1 anticipation — composed turns', () => {
  itAi(
    'mixed turn: preference + place reaction → both tools fire',
    async () => {
      const r = await runAgentTurn(
        "I'm into specialty coffee. Loved Patron in Buenos Aires by the way."
      );

      const hobbyCalled = r.calls.some(c => c.toolName === 'hobby_profile_builder');
      const bucketCalled = r.calls.some(c => c.toolName === 'city_bucket_list_manager');
      expect(hobbyCalled, 'expected hobby_profile_builder to fire').toBe(true);
      expect(bucketCalled, 'expected city_bucket_list_manager to fire').toBe(true);

      // The hobby pref must include specialty_coffee.
      expect(r.hobbyUpserts.map(u => u.key)).toContain('specialty_coffee');

      // The bucket entry must be Buenos Aires + Patron + loved.
      expect(r.bucketUpserts[0]?.city).toBe('Buenos Aires');
      expect(/patron/i.test(r.bucketUpserts[0]?.name ?? '')).toBe(true);
      expect(r.bucketUpserts[0]?.status).toBe('loved');
    },
    60_000
  );
});
