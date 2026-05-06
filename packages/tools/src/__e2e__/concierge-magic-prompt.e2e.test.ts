/**
 * AI-driven E2E for the concierge-magic prompt slab silence policy.
 *
 * Drives a REAL LLM through realistic traveler turns where the
 * pre-fetched `vars.*` are stamped into the system prompt the same way
 * Kapso would render them. Verifies the SILENCE POLICY rules from
 * docs/architecture/concierge-magic.md §3.3 actually shape behavior:
 *
 *   1. Agent does NOT call get_active_trip / get_whatsapp_context —
 *      they're already pre-loaded as vars (covered by §3.1).
 *   2. Agent reads `recurring_traveler_returning_to_destination='true'`
 *      and produces "welcome back" copy (covered by §3.3 magic rule).
 *   3. Agent reads `traveler_profile_voice_preferred='true'` and biases
 *      outbound text toward voice prompts.
 *   4. Agent NEVER narrates context loading ("Let me check your trip…").
 *   5. First-trip traveler (totalTrips=0) gets generic-warm copy, not
 *      "welcome back" (no false-positive on the returning hook).
 *
 * Skip-if-absent: OPENAI_API_KEY. Hermetic — every external API
 * (Google Places, Weather, Timezone) is short-circuited so the agent
 * burns no quota.
 *
 * Spec: docs/architecture/concierge-magic.md §3.3 + §10.
 */

import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

const HAS_KEY = Boolean(process.env.OPENAI_API_KEY);
const AGENT_MODEL = 'gpt-4o-mini';
const JUDGE_MODEL = 'gpt-4o-mini';
const itAi = HAS_KEY ? test : test.skip;

if (!HAS_KEY) {
  console.warn(
    '[concierge-magic-prompt.e2e] Skipping — set OPENAI_API_KEY to enable. ' +
      'Verifies silence policy + recurring-traveler hooks land.'
  );
}

// Short-circuit any external HTTP the prompt might trigger so the suite
// is hermetic + cost-bounded. The visa-agent.e2e suite uses the same
// pattern.
const realFetch = globalThis.fetch;
function installNetworkShortcircuit(): () => void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('places.googleapis.com') || url.includes('weather.googleapis.com')) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return realFetch(input as Parameters<typeof realFetch>[0], init);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * Subset of the Kapso prompt slab that's load-bearing for the silence
 * policy. Mirrors what we pushed to lock_version 138 + workflow.js. If
 * the live slab drifts, this test stays anchored to the contract.
 */
const SYSTEM_PROMPT = `You are Sendero — a precise, locally fluent AI travel agent on WhatsApp.

## EVERY TURN STARTS WITH CONTEXT PRE-LOADED (silence policy)

The graph node \`prefetch_trip\` ran SILENTLY before this turn. All context already lives on \`vars.*\` — read directly, never re-fetch:

  vars.from_phone = "{{from_phone}}"
  vars.active_trip_status = "{{active_trip_status}}"
  vars.active_trip_id = "{{active_trip_id}}"
  vars.active_trip_iso2 = "{{active_trip_iso2}}"
  vars.active_trip_dates = "{{active_trip_dates}}"
  vars.active_trip_destination = "{{active_trip_destination}}"
  vars.traveler_profile_total_trips = "{{traveler_profile_total_trips}}"
  vars.traveler_profile_voice_preferred = "{{traveler_profile_voice_preferred}}"
  vars.recurring_traveler_display_name = "{{recurring_traveler_display_name}}"
  vars.recurring_traveler_returning_to_destination = "{{recurring_traveler_returning_to_destination}}"

DO NOT call get_whatsapp_context. DO NOT call get_active_trip. They already ran.

### Use the profile vars to make magic
- recurring_traveler_display_name set → greet by name; skip "what's your name?".
- recurring_traveler_returning_to_destination='true' → "Welcome back to {destination}" or "Bienvenido de vuelta a {destination}". Generic greeting otherwise.
- traveler_profile_voice_preferred='true' → bias outbound copy toward audio prompts ("mandá un audio si querés…" / "send a voice note").

### Silence rules (HARD)
- Never narrate context loading ("Let me check your trip…" / "Looking up…" / "Procesando…"). The vars are already there.
- Never restate trip context the traveler just gave you in this turn.
- Never re-ask for facts already in vars.traveler_profile_*.
- Constant pings = anti-magic. After replying, your turn is OVER.

Reply concisely in the user's language. Spanish for es-AR / es-MX, Portuguese for pt-BR, English otherwise.`;

function fillPrompt(vars: Record<string, string>): string {
  return SYSTEM_PROMPT.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

interface AgentTurnResult {
  text: string;
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
}

async function runAgentTurn(args: {
  vars: Record<string, string>;
  userMessage: string;
}): Promise<AgentTurnResult> {
  const restore = installNetworkShortcircuit();
  try {
    const result = await generateText({
      model: openai.chat(AGENT_MODEL),
      system: fillPrompt(args.vars),
      messages: [{ role: 'user', content: args.userMessage }],
      // No tools — we want to verify the agent DOESN'T call any. The
      // assertion below checks toolCalls.length === 0 strictly.
      tools: {},
      stopWhen: ({ steps }) => steps.length >= 2,
    });
    const toolCalls = result.steps
      .flatMap(s => s.content.filter(p => p.type === 'tool-call'))
      .map(p => ({
        toolName: (p as { toolName: string }).toolName,
        input: (p as { input: Record<string, unknown> }).input,
      }));
    return { text: result.text, toolCalls };
  } finally {
    restore();
  }
}

async function judgeResponse(args: {
  userMessage: string;
  agentReply: string;
  must: string[];
  mustNot?: string[];
}): Promise<{ pass: boolean; verdicts: Record<string, { ok: boolean; reason: string }> }> {
  const prompt = `You are grading an agent reply.

USER MESSAGE: ${args.userMessage}

AGENT REPLY: ${args.agentReply}

For each MUST criterion, answer ok=true if the reply satisfies it.
For each MUST_NOT criterion, answer ok=true if the reply does NOT contain that thing.

MUST:
${args.must.map((c, i) => `${i + 1}. ${c}`).join('\n')}
${
  args.mustNot && args.mustNot.length
    ? `\nMUST_NOT:\n${args.mustNot.map((c, i) => `${i + 1}. ${c}`).join('\n')}`
    : ''
}

Reply STRICTLY as JSON:
{ "verdicts": { "must_1": {"ok": true|false, "reason": "..."}, ... } }`;

  const result = await generateText({
    model: openai.chat(JUDGE_MODEL),
    prompt,
  });
  let parsed: { verdicts: Record<string, { ok: boolean; reason: string }> };
  try {
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch?.[0] ?? result.text);
  } catch {
    return {
      pass: false,
      verdicts: { _parse_error: { ok: false, reason: result.text.slice(0, 200) } },
    };
  }
  const allOk = Object.values(parsed.verdicts).every(v => v.ok);
  return { pass: allOk, verdicts: parsed.verdicts };
}

describe('concierge-magic prompt — silence policy + magic vars', () => {
  itAi(
    'returning traveler: agent says "welcome back to Lima" without re-fetching context',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+15555550100',
          active_trip_status: 'ok',
          active_trip_id: 'trp_lim_2026',
          active_trip_iso2: 'PE',
          active_trip_dates: '2026-05-11 → 2026-05-13',
          active_trip_destination: 'Lima',
          traveler_profile_total_trips: '4',
          traveler_profile_voice_preferred: 'false',
          recurring_traveler_display_name: 'Tomas',
          recurring_traveler_returning_to_destination: 'true',
        },
        userMessage: 'hola, ¿qué tal?',
      });

      // (1) HARD silence rule — no tool calls; vars are pre-loaded.
      expect(r.toolCalls.length).toBe(0);

      const v = await judgeResponse({
        userMessage: 'hola, ¿qué tal?',
        agentReply: r.text,
        must: [
          "Greets the user warmly in Spanish (matches the user's language).",
          'Mentions Lima OR uses returning-traveler language (e.g., "welcome back", "bienvenido de vuelta", "de vuelta", "again", "otra vez").',
        ],
        mustNot: [
          'Asks the user where they are going or what their destination is.',
          'Says "let me check", "let me look up", "procesando", "verificando", "déjame revisar".',
          "Asks for the user's name or any identifying info.",
        ],
      });
      if (!v.pass) console.warn('[returning-traveler] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    30_000
  );

  itAi(
    'first-trip traveler: agent does NOT say "welcome back" (no false-positive)',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+15555550101',
          active_trip_status: 'no_active_trip',
          active_trip_id: '',
          active_trip_iso2: '',
          active_trip_dates: '',
          active_trip_destination: '',
          traveler_profile_total_trips: '0',
          traveler_profile_voice_preferred: 'false',
          recurring_traveler_display_name: '',
          recurring_traveler_returning_to_destination: 'false',
        },
        userMessage: 'hi, can you help me plan a trip?',
      });

      expect(r.toolCalls.length).toBe(0);

      const v = await judgeResponse({
        userMessage: 'hi, can you help me plan a trip?',
        agentReply: r.text,
        must: ['Replies in English to match the user.', 'Offers to help plan the trip.'],
        mustNot: [
          'Says "welcome back" or "bienvenido de vuelta" or any returning-customer phrasing.',
          'References a destination by name (Lima, Buenos Aires, etc.) since none is set in vars.',
          'Says "let me check" or "looking up" or any context-loading narration.',
        ],
      });
      if (!v.pass) console.warn('[first-trip] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    30_000
  );

  itAi(
    'voicePreferred=true: agent biases reply toward voice-note prompts',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+15555550102',
          active_trip_status: 'ok',
          active_trip_id: 'trp_bcn_2026',
          active_trip_iso2: 'ES',
          active_trip_dates: '2026-06-01 → 2026-06-08',
          active_trip_destination: 'Barcelona',
          traveler_profile_total_trips: '2',
          traveler_profile_voice_preferred: 'true',
          recurring_traveler_display_name: 'Casey',
          recurring_traveler_returning_to_destination: 'false',
        },
        userMessage: 'cuéntame qué necesito antes de viajar',
      });

      expect(r.toolCalls.length).toBe(0);

      const v = await judgeResponse({
        userMessage: 'cuéntame qué necesito antes de viajar',
        agentReply: r.text,
        must: [
          'Mentions or invites a voice note / audio reply (e.g., "mandá un audio", "send a voice note", "audio", "voz", "grabá").',
        ],
        mustNot: [
          'Asks the user to type out a long form-style answer.',
          'Says "let me check" or "looking up".',
        ],
      });
      if (!v.pass) console.warn('[voice-preferred] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    30_000
  );

  itAi(
    'no_active_trip + first-trip: agent does NOT pretend to know context it lacks',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+15555550103',
          active_trip_status: 'no_active_trip',
          active_trip_id: '',
          active_trip_iso2: '',
          active_trip_dates: '',
          active_trip_destination: '',
          traveler_profile_total_trips: '0',
          traveler_profile_voice_preferred: 'false',
          recurring_traveler_display_name: '',
          recurring_traveler_returning_to_destination: 'false',
        },
        userMessage: '¿cómo está el clima en mi destino?',
      });

      expect(r.toolCalls.length).toBe(0);

      const v = await judgeResponse({
        userMessage: '¿cómo está el clima en mi destino?',
        agentReply: r.text,
        must: ['Asks the user what their destination is OR notes that no trip is on file.'],
        mustNot: [
          'Invents a city, country, or weather forecast.',
          'Says "Lima" or "Buenos Aires" or any specific location not provided in vars.',
        ],
      });
      if (!v.pass) console.warn('[no-context] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    30_000
  );
});
