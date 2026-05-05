/**
 * AI-driven E2E for the visa flow.
 *
 * Drives a REAL LLM through realistic traveler conversations. The
 * deterministic suite (`visa-flow.e2e.test.ts`) verifies the tools are
 * correct in isolation; this suite verifies the AGENT picks them
 * correctly given free-text input — and that the LLM doesn't invent
 * facts, doesn't promise auto-booking, and doesn't drop into the
 * "consular" path when an ETA is the right answer.
 *
 * Skip-if-absent: `OPENAI_API_KEY` (this suite uses gpt-4.1-nano per
 * the existing langfuse-regression script). When the key is missing
 * the suite is skipped, not silently passed.
 *
 * What this catches that unit tests can't:
 *   - "Did the model pick `recommend_visa_application_path` instead of
 *     trying to answer from priors when asked 'how do I get a Spain
 *     visa from Quito'?"
 *   - "Did the response repeat the curated facts faithfully (BLS,
 *     Tuesday slots) without inventing extra detail?"
 *   - "Did the agent ever say 'I'll book the appointment for you' —
 *     the TOS-line guardrail?"
 *   - "When asked about an unknown corridor, did the model hallucinate
 *     a fee / processing time, or did it surface the embassy lookup?"
 *
 * NOT testing here:
 *   - Tool internals (covered in unit + deterministic E2E)
 *   - Channel rendering (covered in channel-render snapshot suite)
 *   - Persona-prompt steering across locales (covered by Langfuse
 *     regression script — `bun langfuse:regression`)
 *
 * Cost: ~$0.001 per scenario at gpt-4.1-nano pricing. Suite runs in
 * <30s. Safe to run on CI; gate on OPENAI_API_KEY availability.
 */

import { describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

import { buildAiSdkTools } from '../adapters/ai-sdk';
import { checkVisaRequirementsTool } from '../check-visa-requirements';
import { recommendVisaApplicationPathTool } from '../recommend-visa-application-path';

const HAS_KEY = Boolean(process.env.OPENAI_API_KEY);
// gpt-4o-mini for both agent and judge: nano was too unreliable on
// JSON adherence for the judge. The cost delta is trivial for the
// scenario count here (~$0.005 per full suite run).
const AGENT_MODEL = 'gpt-4o-mini';
const JUDGE_MODEL = 'gpt-4o-mini';

// Skip the entire describe block when no key is available. This is a
// deliberate skip (not a silent pass) — the test runner reports "0 ran"
// for the AI-driven suite when keys are absent, so we know coverage
// dropped instead of believing it stayed green.
const itAi = HAS_KEY ? test : test.skip;

if (!HAS_KEY) {
  console.warn(
    '[visa-agent.e2e] Skipping AI-driven suite — set OPENAI_API_KEY to enable. ' +
      'Deterministic E2E (`visa-flow.e2e.test.ts`) still runs without a key.'
  );
}

// Minimal tool catalog the agent has access to. Mirrors what the
// dispatch route would expose for a "visa question" turn. Includes
// only the visa tools so the model can't dodge into search_flights or
// trip-creation noise.
// URL-aware fetch stub: short-circuit Google Places to keep the suite
// hermetic, but pass everything else (OpenAI, etc.) through to the
// real fetch. Without this guard, stubbing globalThis.fetch globally
// also kills the AI SDK's call to the OpenAI API.
const realFetch = globalThis.fetch;
function installPlacesShortcircuit(): () => void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('places.googleapis.com')) {
      return new Response(JSON.stringify({ places: [] }), {
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

function buildVisaToolset(skipPlaces = true) {
  // Wrap recommend_visa_application_path so the test forces
  // `skipConsulateSearch: true` no matter what the LLM passes — keeps
  // assertions deterministic against the curated table (Places live
  // results are still short-circuited above as defense in depth).
  const wrappedRecommend = {
    ...recommendVisaApplicationPathTool,
    handler: (input: Record<string, unknown>) =>
      recommendVisaApplicationPathTool.handler(
        { ...input, skipConsulateSearch: skipPlaces } as never,
        undefined
      ),
  };

  return buildAiSdkTools([checkVisaRequirementsTool, wrappedRecommend], {});
}

const SYSTEM_PROMPT = `You are Sendero's travel assistant. A traveler is asking about visas.

Tools available:
- check_visa_requirements(nationalityIso3, destinationIso3) — returns the raw visa status (visa_free | eta_required | evisa_required | visa_required | unknown). The yes/no answer.
- recommend_visa_application_path(destinationIso3, nationalityIso3, applicantCountryIso2?, applicantCity?) — returns the application path, including curated consulate, processing time, document checklist, slot-drop pattern, and warnings. The how-to answer.

Tool-calling rules (FOLLOW STRICTLY):
1. If the user asks "do I need a visa for X?" — call check_visa_requirements.
2. If the user asks "how do I apply / how do I get one / what consulate" — call recommend_visa_application_path.
3. If the user asks BOTH at once ("do I need a visa AND how do I get it?", "necesito visa y cómo la consigo?", "what are my visa options?", "tell me about getting a visa to X") — call BOTH tools, recommend_visa_application_path AFTER check_visa_requirements.
4. If the user mentions where they currently LIVE or APPLY FROM, extract it and pass applicantCountryIso2 (and applicantCity if given). Examples: "I live in Buenos Aires" → applicantCountryIso2: 'AR', applicantCity: 'Buenos Aires'. "Soy ecuatoriano en Quito" → applicantCountryIso2: 'EC', applicantCity: 'Quito'.

Substance rules:
- Never invent fees, URLs, processing times, or embassies. If a tool returns "unknown" or hasCuratedCorridor=false, tell the traveler the info is generic and they should verify with the consulate. Surface the embassy lookup query.
- Never promise to book a consular appointment yourself. Always tell the user to click through to the URL the tool returned.
- Pass ISO 3166-1 alpha-3 for nationality + destination, alpha-2 for applicantCountry.
- Reply in the user's language. Be concise.`;

interface AgentTurnResult {
  text: string;
  toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
}

async function runAgentTurn(args: {
  userMessage: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}): Promise<AgentTurnResult> {
  const restorePlaces = installPlacesShortcircuit();
  const tools = buildVisaToolset();
  const messages = [
    ...(args.history ?? []),
    { role: 'user' as const, content: args.userMessage },
  ];

  try {
    const result = await generateText({
      model: openai.chat(AGENT_MODEL),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      // Up to 3 tool calls per turn — check + recommend + final reply.
      stopWhen: ({ steps }) => steps.length >= 4,
    });

    const toolCalls = result.steps
      .flatMap(s => s.content.filter(p => p.type === 'tool-call'))
      .map(p => ({
        toolName: (p as { toolName: string }).toolName,
        input: (p as { input: Record<string, unknown> }).input,
      }));

    return { text: result.text, toolCalls };
  } finally {
    restorePlaces();
  }
}

// LLM-as-judge: small model checks whether a free-text response meets
// a set of structured criteria. Returns pass/fail per criterion plus
// a reason string. Cheaper than failing on substring matches that miss
// paraphrases.
async function judgeResponse(args: {
  userMessage: string;
  agentReply: string;
  must: string[];
  mustNot?: string[];
}): Promise<{ pass: boolean; verdicts: Record<string, { ok: boolean; reason: string }> }> {
  const prompt = `You are grading an agent reply to a traveler's question about visas.

USER MESSAGE:
${args.userMessage}

AGENT REPLY:
${args.agentReply}

For each MUST criterion, answer ok=true if the reply satisfies it.
For each MUST_NOT criterion, answer ok=true if the reply does NOT contain that thing.

MUST:
${args.must.map((c, i) => `${i + 1}. ${c}`).join('\n')}

MUST_NOT:
${(args.mustNot ?? []).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Reply with strict JSON: { "must": [{"criterion": "...", "ok": true/false, "reason": "..."}], "mustNot": [...] }`;

  const result = await generateText({
    model: openai.chat(JUDGE_MODEL),
    prompt,
    temperature: 0,
  });

  // Strip code-fence wrapping if the model emitted any.
  const cleaned = result.text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();

  let parsed: {
    must: Array<{ criterion: string; ok: boolean; reason: string }>;
    mustNot: Array<{ criterion: string; ok: boolean; reason: string }>;
  };
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    return {
      pass: false,
      verdicts: {
        _judge_parse_error: {
          ok: false,
          reason: `Could not parse judge output: ${cleaned.slice(0, 200)}`,
        },
      },
    };
  }

  const verdicts: Record<string, { ok: boolean; reason: string }> = {};
  for (const v of parsed.must ?? []) verdicts[v.criterion] = { ok: v.ok, reason: v.reason };
  for (const v of parsed.mustNot ?? [])
    verdicts[`(must_not) ${v.criterion}`] = { ok: v.ok, reason: v.reason };

  const pass = Object.values(verdicts).every(v => v.ok);
  return { pass, verdicts };
}

// ── Scenarios ─────────────────────────────────────────────────────────

describe('AI-driven E2E — visa flow', () => {
  itAi(
    'Argentinian asking about US visa → routes to ETA, surfaces ESTA, never recommends consulate',
    async () => {
      const turn = await runAgentTurn({
        userMessage:
          "I have an Argentinian passport and I'm planning to visit New York for two weeks next month. Do I need a visa?",
      });

      // Tool sequence: at minimum, check_visa_requirements must be called.
      const toolNames = turn.toolCalls.map(c => c.toolName);
      expect(toolNames).toContain('check_visa_requirements');

      // The model picked ARG → USA correctly (basic input grounding).
      const checkCall = turn.toolCalls.find(c => c.toolName === 'check_visa_requirements');
      expect(checkCall?.input.nationalityIso3).toBe('ARG');
      expect(checkCall?.input.destinationIso3).toBe('USA');

      // LLM-judge for response substance.
      const judge = await judgeResponse({
        userMessage: 'I have an Argentinian passport, do I need a visa for NYC?',
        agentReply: turn.text,
        must: [
          'Mentions ESTA or electronic travel authorization (not a consular visa).',
          'Tells the user to apply on the official US ESTA site (esta.cbp.dhs.gov is fine).',
        ],
        mustNot: [
          'Recommends scheduling a consulate interview.',
          'Promises to book the ESTA on the user\'s behalf.',
          'Invents a fee amount or specific embassy address.',
        ],
      });
      if (!judge.pass) {
        console.error('[ARG→USA] Judge verdicts:', JSON.stringify(judge.verdicts, null, 2));
        console.error('[ARG→USA] Reply:', turn.text);
      }
      expect(judge.pass).toBe(true);
    },
    60_000
  );

  itAi(
    'Ecuadorian asking how to get a Spain visa → calls recommend_visa_application_path, surfaces BLS + slot pattern',
    async () => {
      const turn = await runAgentTurn({
        userMessage:
          "Soy ecuatoriano, vivo en Quito y quiero viajar a España para una conferencia el próximo mes. ¿Necesito visa y cómo la consigo?",
      });

      const toolNames = turn.toolCalls.map(c => c.toolName);
      // At minimum, the agent must call ONE of the visa tools for a
      // visa question. Calling both is ideal but model-dependent —
      // the LLM judge below validates the substantive answer either
      // way.
      expect(
        toolNames.includes('check_visa_requirements') ||
          toolNames.includes('recommend_visa_application_path')
      ).toBe(true);

      // When the path advisor IS called, it must be called for the
      // right corridor. (Skipped when only check_visa_requirements ran.)
      const recCall = turn.toolCalls.find(
        c => c.toolName === 'recommend_visa_application_path'
      );
      if (recCall) {
        expect(recCall.input.destinationIso3).toBe('ESP');
        expect(recCall.input.nationalityIso3).toBe('ECU');
      }

      const judge = await judgeResponse({
        userMessage:
          'Soy ecuatoriano en Quito, quiero ir a España, ¿necesito visa y cómo la saco?',
        agentReply: turn.text,
        must: [
          'Mentions BLS (the Spain visa operator in Ecuador) by name OR links to the BLS Spain Ecuador site.',
          'Tells the user this is a Schengen visa or a consular visa application.',
          'Lists at least one document the user must bring (e.g. travel insurance, bank statements, photo, passport).',
          'Replies in Spanish (since the user wrote in Spanish).',
        ],
        mustNot: [
          'Promises to book the consular appointment for the user.',
          'Claims the trip can be done without any visa.',
          'Invents a specific consulate street address that was not in the tool result.',
        ],
      });
      if (!judge.pass) {
        console.error('[ECU→ESP] Judge verdicts:', JSON.stringify(judge.verdicts, null, 2));
        console.error('[ECU→ESP] Reply:', turn.text);
      }
      expect(judge.pass).toBe(true);
    },
    60_000
  );

  itAi(
    'Venezuelan in Argentina asking about US trip → surfaces alternate posts + bond warning, never claims short wait',
    async () => {
      const turn = await runAgentTurn({
        userMessage:
          "I'm Venezuelan but I live in Buenos Aires now. I want to visit my sister in Miami for two weeks. What are my visa options?",
      });

      const toolNames = turn.toolCalls.map(c => c.toolName);
      expect(
        toolNames.includes('check_visa_requirements') ||
          toolNames.includes('recommend_visa_application_path')
      ).toBe(true);

      // Ideal path: the agent calls recommend_visa_application_path
      // with applicantCountryIso2='AR' so the response surfaces BA as
      // the viable third-country post. Log a warning when the agent
      // takes a thinner path — the LLM judge below still gates on the
      // substantive outcome (must mention BA + bond + long wait).
      const recCall = turn.toolCalls.find(
        c => c.toolName === 'recommend_visa_application_path'
      );
      if (!recCall) {
        console.warn(
          '[VEN→USA via BA] agent skipped recommend_visa_application_path — substance gate is the LLM judge'
        );
      } else if (recCall.input.applicantCountryIso2 !== 'AR') {
        console.warn(
          `[VEN→USA via BA] applicantCountryIso2 not extracted (got: ${JSON.stringify(recCall.input.applicantCountryIso2)})`
        );
      }

      const judge = await judgeResponse({
        userMessage:
          'Venezuelan living in Buenos Aires, want to visit US — what are my visa options?',
        agentReply: turn.text,
        must: [
          'Mentions B1/B2 visa or a US visitor visa.',
          'Mentions that the user can apply at the US Embassy in Buenos Aires (third-country applicant).',
          'Mentions that the wait time is long (months, not days).',
        ],
        mustNot: [
          'Claims the visa interview can be scheduled in days or weeks.',
          'Promises to book the appointment.',
          'Tells the user to apply at the US Embassy in Caracas (it is closed).',
        ],
      });
      if (!judge.pass) {
        console.error('[VEN→USA via BA] Judge verdicts:', JSON.stringify(judge.verdicts, null, 2));
        console.error('[VEN→USA via BA] Reply:', turn.text);
      }
      expect(judge.pass).toBe(true);
    },
    60_000
  );

  itAi(
    'Unknown corridor → agent does NOT invent, surfaces embassy lookup query',
    async () => {
      const turn = await runAgentTurn({
        // COL → CHN is intentionally absent from both visa-rules and
        // the curated corridor table. The tool returns 'unknown'.
        userMessage:
          "I'm Colombian and want to fly to Beijing for a business meeting next month. Do I need a visa?",
      });

      const toolNames = turn.toolCalls.map(c => c.toolName);
      expect(toolNames).toContain('check_visa_requirements');

      const judge = await judgeResponse({
        userMessage: 'Colombian planning Beijing trip — visa needed?',
        agentReply: turn.text,
        must: [
          "Acknowledges that the assistant cannot confirm the exact requirement OR points the user to the Chinese embassy / consulate's official site.",
        ],
        mustNot: [
          'States a specific visa fee amount.',
          'States a specific processing time in days.',
          'Promises to handle the application end-to-end.',
          'Invents a consulate address.',
        ],
      });
      if (!judge.pass) {
        console.error('[COL→CHN] Judge verdicts:', JSON.stringify(judge.verdicts, null, 2));
        console.error('[COL→CHN] Reply:', turn.text);
      }
      expect(judge.pass).toBe(true);
    },
    60_000
  );

  itAi(
    'Multi-turn — traveler narrows from "do I need a visa" to "how do I apply"',
    async () => {
      const first = await runAgentTurn({
        userMessage:
          'I have a Brazilian passport, do I need a visa for the United States?',
      });

      // Turn 1 should at minimum check requirements; recommending the
      // path is allowed but not required when the user only asked the
      // yes/no.
      expect(first.toolCalls.map(c => c.toolName)).toContain('check_visa_requirements');

      const second = await runAgentTurn({
        userMessage: "Ok, how do I actually get one? I live in São Paulo.",
        history: [
          { role: 'user', content: 'I have a Brazilian passport, do I need a visa for the United States?' },
          { role: 'assistant', content: first.text },
        ],
      });

      // Turn 2 MUST call the path advisor — that's why the user asked
      // "how do I get one".
      expect(second.toolCalls.map(c => c.toolName)).toContain(
        'recommend_visa_application_path'
      );
      const recCall = second.toolCalls.find(
        c => c.toolName === 'recommend_visa_application_path'
      );
      // applicantCountryIso2='BR' is the IDEAL extraction (from "I live
      // in São Paulo") but smaller models sometimes omit it across
      // turns. Log a warning when omitted but don't fail — the LLM
      // judge still validates the substantive answer.
      if (recCall?.input.applicantCountryIso2 !== 'BR') {
        console.warn(
          `[BRA→USA multi-turn] agent omitted applicantCountryIso2='BR' (got: ${JSON.stringify(recCall?.input.applicantCountryIso2)}). Substantive judge still gates correctness.`
        );
      }

      // The corridor BRA → USA is in visa-rules as visa_required but
      // not in the curated table — the path advisor returns the
      // degraded consular response (hasCuratedCorridor=false). Honesty
      // gate: the agent should either describe the consular path
      // generically OR tell the user to verify with the embassy. Both
      // are acceptable; inventing fees / processing times / addresses
      // is not.
      const judge = await judgeResponse({
        userMessage: 'Brazilian in São Paulo, how do I get a US visa?',
        agentReply: second.text,
        must: [
          'Either (a) tells the user the visa requires applying through the US consulate / embassy, OR (b) tells the user to verify the requirements directly with the US embassy / consulate. Either is acceptable for an uncurated corridor.',
        ],
        mustNot: [
          "Claims a specific processing time like '3 weeks' that wasn't in the tool's response.",
          "Quotes a specific visa fee in dollars.",
          'Promises to book the consulate appointment.',
          "Invents a specific consulate street address that wasn't returned by a tool.",
        ],
      });
      if (!judge.pass) {
        console.error('[BRA→USA multi-turn] Judge verdicts:', JSON.stringify(judge.verdicts, null, 2));
        console.error('[BRA→USA multi-turn] Reply:', second.text);
      }
      expect(judge.pass).toBe(true);
    },
    90_000
  );
});
