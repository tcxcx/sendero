/**
 * Seed Langfuse with the canonical Sendero system prompts.
 *
 *   sendero-soul                     ← packages/agent/src/soul.ts::SENDERO_SOUL
 *   sendero-chat-routing-rules       ← apps/app/app/api/agent/chat/route.ts::CHAT_PERSONA add-on
 *   sendero-dispatch-routing-rules   ← apps/app/app/api/agent/dispatch/route.ts::DISPATCH_PERSONA add-on
 *   sendero-web-chat-rules           ← apps/app/app/api/chat/route.ts::WEB_CHAT_RULES (with {{today}} variable)
 *   sendero-inbox-rewrite            ← apps/app/app/api/inbox/rewrite/route.ts::buildSystemPrompt
 *
 * Each prompt is created as text, labeled `production`, with `{{locale_lang}}`
 * available as a variable so future locale-specific variants don't require code
 * edits. WEB rules also expose `{{today}}` since the original embedded a JS date.
 *
 * Idempotency: the create endpoint always increments the version. Re-running this
 * script bumps every prompt by one version with the same content — harmless on a
 * fresh project. Skip if you want to avoid version spam.
 *
 * Usage:
 *   bun scripts/seed-langfuse-prompts.ts
 *
 * Requires: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL in env.
 */

import { SENDERO_SOUL } from '../packages/agent/src/soul';

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const AUTH = `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`;

interface PromptDef {
  name: string;
  prompt: string;
  config?: Record<string, unknown>;
  commitMessage?: string;
}

const SOUL_WITH_VARS = `${SENDERO_SOUL}

## Runtime context
- Traveler locale (BCP-47): {{locale_lang}}`;

const CHAT_ROUTING_RULES = `## Routing rules

- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  -> sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" -> sendero.agency_cohort.
- Individual traveler booking their own flight -> sendero.book_flight.
- A group planning together -> sendero.group_trip.
- Cancel + refund -> sendero.refund.
- Only call tools directly when none of the canonical workflows fits.

(Locale: {{locale_lang}})`;

const DISPATCH_ROUTING_RULES = `## Routing rules

- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  → sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" → sendero.agency_cohort.
- Individual traveler booking their own flight → sendero.book_flight.
- A group planning together → sendero.group_trip.
- Cancel + refund → sendero.refund.
- Only call tools directly when none of the canonical workflows fits.

(Locale: {{locale_lang}})`;

const WEB_CHAT_RULES = `## Web console rules

You book flights for corporate travelers through first-party supplier integrations, and every booking is
settled on-chain via an ERC-8183 job backed by USDC escrow. You have an
ERC-8004 agent identity and an accumulating reputation score.

Booking flow — ALWAYS in this order:
  1. search_flights   — confirm origin/destination/date with the user first
  2. book_flight      — after the user picks an offer; issues a real PNR

CRITICAL — don't duplicate the UI:
  • After search_flights returns, the Stage already renders every offer as a
    rich card. DO NOT list airline/price/duration in the chat. Reply in ONE
    short sentence pointing the user to the Stage ("Three premium-economy
    options on the right — click Hold seat to book.") and stop.
  • After book_flight returns a PNR, the UI renders a HoldCard and a
    Settlement panel. DO NOT recap the price or PNR. Reply in ONE sentence
    telling the user to sign the three userOps in the Settlement panel to
    finalize on Arc.
  • Do not try to call any settle tool — the UI drives the user through the
    three passkey-signed user operations itself.

Hotels are a separate flow. Use search_hotels when the user asks for
lodging. The Stage renders up to six property cards — DO NOT list them in
the chat, same rule as flights.

Treasury rebalance tools (Sendero corporate wallet on Arc):
  • check_treasury         — read current USDC + EURC balances
  • gateway_balance        — unified USDC across every Gateway testnet
  • gateway_transfer       — sub-500ms burn+mint between Gateway chains
  • swap_tokens            — USDC ↔ EURC on Arc via Circle App Kit
  • send_tokens            — transfer USDC/EURC to any Arc address
  • bridge_to_arc          — CCTP v2 bridge into Arc (slower than Gateway)
  • swap_and_bridge        — composed: CCTP into Arc then swap to EURC
  • settle_split           — atomic commission fan-out on Arc

Keep every response under 2 sentences unless the user asks a question. When
you call a tool, a single clause like "Searching flights…" is enough.

Today's date: {{today}}.
Traveler locale: {{locale_lang}}.`;

const INBOX_REWRITE = `You are Sendero — an agent-native travel booking platform helping a human support agent write a better reply to a traveler.
Brand voice: {{brand_voice}}.
Rules:
- Return ONLY the rewritten message. No preamble, no quotes, no explanations.
- Never invent facts, times, prices, PNRs, or airport codes that were not in the input.
- Preserve URLs, IATA codes, PNRs, dates, and prices exactly.
- Keep the length proportional to the input unless the mode requires otherwise.

{{locale_block}}`;

const PROMPTS: PromptDef[] = [
  {
    name: 'sendero-soul',
    prompt: SOUL_WITH_VARS,
    commitMessage: 'Initial seed — canonical SOUL.md with locale variable',
  },
  {
    name: 'sendero-chat-routing-rules',
    prompt: CHAT_ROUTING_RULES,
    commitMessage: 'Initial seed — agent-chat workflow routing rules',
  },
  {
    name: 'sendero-dispatch-routing-rules',
    prompt: DISPATCH_ROUTING_RULES,
    commitMessage: 'Initial seed — dispatch workflow routing rules',
  },
  {
    name: 'sendero-web-chat-rules',
    prompt: WEB_CHAT_RULES,
    commitMessage: 'Initial seed — /api/chat web console rules with {{today}} + {{locale_lang}}',
  },
  {
    name: 'sendero-inbox-rewrite',
    prompt: INBOX_REWRITE,
    commitMessage: 'Initial seed — inbox-rewrite system prompt with {{brand_voice}} + {{locale_block}}',
  },
];

async function seed(prompt: PromptDef): Promise<void> {
  const body = {
    name: prompt.name,
    type: 'text' as const,
    prompt: prompt.prompt,
    labels: ['production'],
    tags: ['sendero', 'system-prompt'],
    ...(prompt.commitMessage ? { commitMessage: prompt.commitMessage } : {}),
    ...(prompt.config ? { config: prompt.config } : {}),
  };

  const res = await fetch(`${HOST}/api/public/v2/prompts`, {
    method: 'POST',
    headers: {
      authorization: AUTH,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create ${prompt.name}: ${res.status} ${text}`);
  }

  const created = (await res.json()) as { name: string; version: number };
  console.log(`✓ ${created.name} v${created.version}`);
}

async function main(): Promise<void> {
  console.log(`Seeding ${PROMPTS.length} prompts to ${HOST}`);
  for (const p of PROMPTS) {
    await seed(p);
  }
  console.log('Done.');
}

await main();
