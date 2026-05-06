/**
 * AI-driven E2E for the group-trip prompt slab — closure #5 + #6.
 *
 * Drives a REAL LLM through realistic turns covering the autonomous
 * group-creation recipe ("trip for 6 to Cusco for my brother's
 * bachelor"), the inbound claim path (`claim:<token>`), and the
 * group-broadcast opt-out keyword detection ("stop"/"baja"/"basta").
 *
 * Skip-if-absent: OPENAI_API_KEY. Hermetic — agent runs with mocked
 * tool stubs that record calls but never hit real backends.
 *
 * Spec: bucket-analysis closures #3 (autonomous create) + #5
 * (deterministic + LLM-judged) + #6 (broadcast opt-out keyword).
 */

import { describe, expect, test } from 'bun:test';
import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const HAS_KEY = Boolean(process.env.OPENAI_API_KEY);
const AGENT_MODEL = 'gpt-4o-mini';
const JUDGE_MODEL = 'gpt-4o-mini';
const itAi = HAS_KEY ? test : test.skip;

if (!HAS_KEY) {
  console.warn(
    '[group-trip-prompt.e2e] Skipping — set OPENAI_API_KEY to enable. ' +
      'Verifies autonomous group create + opt-out keyword routing land.'
  );
}

/**
 * Subset of the live Kapso prompt slab focused on the group-trip
 * recipe. Mirrors the workflow.js / definition.json contract pushed
 * to Kapso (lock_version bumped during closure #3). If the live slab
 * drifts, this test stays anchored to the contract.
 */
const SYSTEM_PROMPT = `You are Sendero — a precise, locally fluent AI travel agent on WhatsApp.

## ⛔ HARD RULES
1. Reply ONLY by calling tools. No prose without a tool. After any send_* tool, your turn is OVER (next call must be complete_task).
2. Mirror locale (es-AR, es-MX, pt-BR, en-US). Switch when they switch.
3. Never paste raw URLs — always use send_cta_url_message for external URLs.

## Group-trip recipes

- **Group claim**: \`claim_group_seat({ token })\` when inbound starts with \`claim:<token>\`.
- **Autonomous group create**: when the user says "trip for N to X" / "viaje para N a X" / "<event> for <N> people" → call \`create_group_trip({ name, destination?, maxPassengers: N })\`. Result returns \`openSeatClaimUrl\`. Reply with ONE \`send_cta_url_message\` carrying the URL + one-line copy ("Compartí este link con los <N-1> que faltan, claman su lugar y armo el resto"). Then \`complete_task\`. Don't add passengers up-front by phone unless the user volunteered phones — let the claim URL fan-out itself.
- **Group-broadcast opt-out**: when the inbound message is exactly or primarily \`stop\` / \`unsubscribe\` / \`baja\` / \`basta\` / \`pare\` (any locale, any case) AND the traveler is on at least one active GroupTrip in this tenant, call \`set_group_broadcast_optout({ optOut: true })\` then reply briefly in their language ("Listo, te saco de los avisos del grupo. Cualquier cosa, escribime."). If they say "resume"/"opt back in"/"alta", call \`set_group_broadcast_optout({ optOut: false })\` instead.

## Active context (pre-loaded)
- vars.from_phone = "{{from_phone}}"
- vars.active_trip_status = "{{active_trip_status}}"
- vars.active_trip_id = "{{active_trip_id}}"
- vars.active_trip_destination = "{{active_trip_destination}}"
- vars.is_group_passenger = "{{is_group_passenger}}"

DO NOT call get_active_trip. The vars are already loaded. After replying, your turn is OVER.`;

function fillPrompt(vars: Record<string, string>): string {
  return SYSTEM_PROMPT.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
}

async function runAgentTurn(args: {
  vars: Record<string, string>;
  userMessage: string;
}): Promise<{ text: string; toolCalls: ToolCallRecord[] }> {
  const recorded: ToolCallRecord[] = [];

  const tools = {
    create_group_trip: tool({
      description:
        'Create a group trip — multi-passenger journey with optional capacity cap. Returns groupTripId + openSeatClaimUrl.',
      inputSchema: z.object({
        name: z.string(),
        destination: z.string().optional(),
        maxPassengers: z.number().int().positive().optional(),
      }),
      execute: async input => {
        recorded.push({ toolName: 'create_group_trip', input });
        return {
          ok: true,
          groupTripId: 'gt_test_123',
          name: input.name,
          destination: input.destination ?? null,
          maxPassengers: input.maxPassengers ?? null,
          passengerCount: 0,
          openSeatClaimToken: 'tok_abc.sig_def',
          openSeatClaimUrl: 'https://sendero.travel/group/tok_abc.sig_def',
        };
      },
    }),
    claim_group_seat: tool({
      description:
        'Resolve a claim:<token> deep-link to a GroupTrip and attach the calling traveler.',
      inputSchema: z.object({
        token: z.string(),
        role: z.string().optional(),
      }),
      execute: async input => {
        recorded.push({ toolName: 'claim_group_seat', input });
        return {
          ok: true,
          groupTripId: 'gt_test_123',
          userId: 'usr_caller',
          passengerCount: 3,
          isNew: true,
          remainingSeats: 3,
        };
      },
    }),
    set_group_broadcast_optout: tool({
      description: 'Toggle group-broadcast opt-out for the calling traveler.',
      inputSchema: z.object({ optOut: z.boolean() }),
      execute: async input => {
        recorded.push({ toolName: 'set_group_broadcast_optout', input });
        return { ok: true, optOut: input.optOut, affectedRows: 1 };
      },
    }),
    send_cta_url_message: tool({
      description: 'Send a WhatsApp CTA url interactive message.',
      inputSchema: z.object({
        headerText: z.string().optional(),
        body: z.string(),
        ctaUrl: z.string(),
        ctaLabel: z.string(),
        footer: z.string().optional(),
      }),
      execute: async input => {
        recorded.push({ toolName: 'send_cta_url_message', input });
        return { ok: true };
      },
    }),
    send_text_message: tool({
      description: 'Send a plain WhatsApp text reply.',
      inputSchema: z.object({ text: z.string() }),
      execute: async input => {
        recorded.push({ toolName: 'send_text_message', input });
        return { ok: true };
      },
    }),
    complete_task: tool({
      description: 'End the turn. MUST follow every send_* call.',
      inputSchema: z.object({}),
      execute: async () => {
        recorded.push({ toolName: 'complete_task', input: {} });
        return { ok: true };
      },
    }),
  };

  const result = await generateText({
    model: openai.chat(AGENT_MODEL),
    system: fillPrompt(args.vars),
    messages: [{ role: 'user', content: args.userMessage }],
    tools,
    stopWhen: ({ steps }) => steps.length >= 6,
  });

  return { text: result.text, toolCalls: recorded };
}

async function judgeResponse(args: {
  userMessage: string;
  toolCalls: ToolCallRecord[];
  must: string[];
  mustNot?: string[];
}): Promise<{ pass: boolean; verdicts: Record<string, { ok: boolean; reason: string }> }> {
  const toolSummary = args.toolCalls
    .map(c => `- ${c.toolName}(${JSON.stringify(c.input).slice(0, 200)})`)
    .join('\n');

  const prompt = `You are grading an agent's tool-call sequence.

USER MESSAGE: ${args.userMessage}

AGENT TOOL CALLS (in order):
${toolSummary || '(none)'}

For each MUST criterion, answer ok=true if the sequence satisfies it.
For each MUST_NOT criterion, answer ok=true if the sequence does NOT contain that thing.

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

describe('group-trip prompt — autonomous create + claim + opt-out', () => {
  itAi(
    'autonomous create: "trip for 6 to Cusco for my brother\'s bachelor" → create_group_trip + send_cta_url_message',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+5491150000001',
          active_trip_status: 'no_active_trip',
          active_trip_id: '',
          active_trip_destination: '',
          is_group_passenger: 'false',
        },
        userMessage: "trip for 6 to Cusco for my brother's bachelor",
      });

      const create = r.toolCalls.find(c => c.toolName === 'create_group_trip');
      expect(create).toBeTruthy();
      expect(create!.input.maxPassengers).toBe(6);
      const dest = String(create!.input.destination ?? '').toLowerCase();
      expect(dest).toContain('cusco');

      const sentCta = r.toolCalls.find(c => c.toolName === 'send_cta_url_message');
      expect(sentCta).toBeTruthy();
      const ctaUrl = String(sentCta!.input.ctaUrl ?? '');
      expect(ctaUrl).toContain('/group/');

      const v = await judgeResponse({
        userMessage: "trip for 6 to Cusco for my brother's bachelor",
        toolCalls: r.toolCalls,
        must: [
          'Calls create_group_trip with maxPassengers=6.',
          'Followed up with send_cta_url_message carrying a /group/<token> URL.',
          'Eventually calls complete_task.',
        ],
        mustNot: [
          'Asks the user for phone numbers of the other 5 attendees up front.',
          'Pastes the URL inside a plain text message instead of using send_cta_url_message.',
        ],
      });
      if (!v.pass) console.warn('[autonomous-create] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    45_000
  );

  itAi(
    'inbound claim:<token> → claim_group_seat({ token })',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+5491150000002',
          active_trip_status: 'no_active_trip',
          active_trip_id: '',
          active_trip_destination: '',
          is_group_passenger: 'false',
        },
        userMessage: 'claim:tok_abc.sig_def',
      });

      const claim = r.toolCalls.find(c => c.toolName === 'claim_group_seat');
      expect(claim).toBeTruthy();
      expect(String(claim!.input.token ?? '')).toContain('tok_abc');

      const v = await judgeResponse({
        userMessage: 'claim:tok_abc.sig_def',
        toolCalls: r.toolCalls,
        must: ['Calls claim_group_seat with the token.'],
        mustNot: [
          "Asks the user what they're trying to do — the claim:<token> shape is self-explanatory.",
          'Calls create_group_trip — claim:<token> is for joining an existing trip.',
        ],
      });
      if (!v.pass) console.warn('[claim] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    45_000
  );

  itAi(
    'opt-out keyword "baja" on a group passenger → set_group_broadcast_optout({ optOut: true })',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+5491150000003',
          active_trip_status: 'ok',
          active_trip_id: 'trp_lim_2026',
          active_trip_destination: 'Lima',
          is_group_passenger: 'true',
        },
        userMessage: 'baja',
      });

      const opt = r.toolCalls.find(c => c.toolName === 'set_group_broadcast_optout');
      expect(opt).toBeTruthy();
      expect(opt!.input.optOut).toBe(true);

      const v = await judgeResponse({
        userMessage: 'baja',
        toolCalls: r.toolCalls,
        must: [
          'Calls set_group_broadcast_optout with optOut=true.',
          'Replies in Spanish (matches the keyword language) confirming the opt-out.',
        ],
        mustNot: [
          'Calls cancel_booking, cancel_order_quote, or anything resembling booking cancellation.',
          'Asks the user what they want to cancel.',
        ],
      });
      if (!v.pass) console.warn('[optout-baja] verdicts:', v.verdicts);
      expect(v.pass).toBe(true);
    },
    45_000
  );

  itAi(
    'small autonomous-create variant in Spanish: "viaje para 4 a Mendoza" → create_group_trip(maxPassengers=4)',
    async () => {
      const r = await runAgentTurn({
        vars: {
          from_phone: '+5491150000004',
          active_trip_status: 'no_active_trip',
          active_trip_id: '',
          active_trip_destination: '',
          is_group_passenger: 'false',
        },
        userMessage: 'viaje para 4 a Mendoza',
      });

      const create = r.toolCalls.find(c => c.toolName === 'create_group_trip');
      expect(create).toBeTruthy();
      expect(create!.input.maxPassengers).toBe(4);
      const dest = String(create!.input.destination ?? '').toLowerCase();
      expect(dest).toContain('mendoza');
    },
    45_000
  );
});
