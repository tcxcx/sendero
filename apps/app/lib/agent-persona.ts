/**
 * Resolve the agent persona string for a given surface, optionally pulling
 * from Langfuse Prompt Management. Falls back to the hardcoded source-of-truth
 * strings when LANGFUSE_PROMPT_MANAGEMENT=false or Langfuse is unreachable.
 *
 * Three surfaces map to three rule sets layered on top of `sendero-soul`:
 *   - 'chat'     → sendero-chat-routing-rules     (apps/app/app/api/agent/chat)
 *   - 'dispatch' → sendero-dispatch-routing-rules (apps/app/app/api/agent/dispatch)
 *   - 'web'     → sendero-web-chat-rules         (apps/app/app/api/chat)
 *
 * Variables passed to every prompt:
 *   - {{locale_lang}}  — short BCP-47 language code (en, es, pt, fr, …)
 *   - {{today}}        — YYYY-MM-DD; only used by the web prompt today, but
 *                        passed everywhere so authors can opt-in later
 *
 * Locale steering (the "Reply in X language" preamble) stays in
 * `packages/agent/src/prompt.ts::localeSteering` — that runs in the
 * `buildSystemPrompt` assembler after this persona string lands, so the
 * prompt-management migration doesn't disturb it.
 */

import { getPromptWithFallback } from '@sendero/langfuse';
import { SENDERO_SOUL } from '@sendero/agent';

export type PersonaKind = 'chat' | 'dispatch' | 'web';

const CHAT_ROUTING_RULES_FALLBACK = `## Routing rules
- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  -> sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" -> sendero.agency_cohort.
- Individual traveler booking their own flight -> sendero.book_flight.
- A group planning together -> sendero.group_trip.
- Cancel + refund -> sendero.refund.
- Only call tools directly when none of the canonical workflows fits.
`;

const DISPATCH_ROUTING_RULES_FALLBACK = `## Routing rules
- Corporate buyers saying "fund a trip", "give my employee a budget", or "prefund this contractor"
  → sendero.guest_prefund.
- Agencies saying "set up a cohort", "fund these 50 people" → sendero.agency_cohort.
- Individual traveler booking their own flight → sendero.book_flight.
- A group planning together → sendero.group_trip.
- Cancel + refund → sendero.refund.
- Only call tools directly when none of the canonical workflows fits.
`;

function buildWebChatRulesFallback(today: string): string {
  return `## Web console rules

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

Today's date: ${today}.`;
}

const RULES_BY_KIND: Record<PersonaKind, { name: string; fallback: (today: string) => string }> = {
  chat: { name: 'sendero-chat-routing-rules', fallback: () => CHAT_ROUTING_RULES_FALLBACK },
  dispatch: {
    name: 'sendero-dispatch-routing-rules',
    fallback: () => DISPATCH_ROUTING_RULES_FALLBACK,
  },
  web: { name: 'sendero-web-chat-rules', fallback: buildWebChatRulesFallback },
};

export async function buildAgentPersona(
  kind: PersonaKind,
  locale: string | null | undefined
): Promise<string> {
  const localeLang = (locale ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  const today = new Date().toISOString().slice(0, 10);
  const variables = { locale_lang: localeLang, today };
  const opts = { label: 'production', cacheTtlSeconds: 60 } as const;

  const rules = RULES_BY_KIND[kind];

  const [soul, rulesPrompt] = await Promise.all([
    getPromptWithFallback('sendero-soul', SENDERO_SOUL, variables, opts),
    getPromptWithFallback(rules.name, rules.fallback(today), variables, opts),
  ]);

  return `${soul.text}\n\n${rulesPrompt.text}`;
}

/**
 * Slack persona builder. Asymmetric to the other surfaces because
 * Slack carries dynamic per-turn context (workspace, plan, channel,
 * routing rules) that doesn't translate cleanly to Langfuse {{var}}
 * substitution. The static "## Slack tool guidance" body lives in the
 * `sendero-slack-rules` Langfuse prompt; the dynamic preamble is
 * computed here in code and concatenated between SOUL and rules.
 *
 *   final = SOUL (Langfuse) + dynamic preamble (code) + slack-rules (Langfuse)
 */
export interface SlackPersonaContext {
  orgName?: string;
  planTier?: string;
  channelName?: string;
  channelId: string;
  routingPreamble: string;
}

const SLACK_RULES_FALLBACK = `## Slack tool guidance
- You have access to Slack tools (\`slack_send_message\`, \`slack_read_channel\`, …) AND Sendero travel tools (flights, hotels, escrow). Pick the smallest tool that does the job.
- Mutating Slack tools (send / canvas / join / delete) require human approval — when you want to call one, narrate your intent in plain text instead of forcing the tool call so the workspace admin can confirm.
- Default to thread replies. Do not @-mention \`@channel\`/\`@here\` unless the user explicitly asks.
- Use Slack mrkdwn (\`*bold*\`, \`_italic_\`, \`<https://example.com|link>\`). No HTML.`;

export async function buildSlackPersonaWithContext(
  ctx: SlackPersonaContext,
  locale: string | null | undefined
): Promise<string> {
  const localeLang = (locale ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  const today = new Date().toISOString().slice(0, 10);
  const variables = { locale_lang: localeLang, today };
  const opts = { label: 'production', cacheTtlSeconds: 60 } as const;

  const [soul, rulesPrompt] = await Promise.all([
    getPromptWithFallback('sendero-soul', SENDERO_SOUL, variables, opts),
    getPromptWithFallback('sendero-slack-rules', SLACK_RULES_FALLBACK, variables, opts),
  ]);

  const dynamicPreamble = renderSlackPreamble(ctx);
  return `${soul.text}\n\n${dynamicPreamble}\n\n${rulesPrompt.text}`;
}

function renderSlackPreamble(ctx: SlackPersonaContext): string {
  const lines: string[] = ['## Tenant context'];
  if (ctx.orgName) lines.push(`- Workspace: ${ctx.orgName}`);
  if (ctx.planTier) lines.push(`- Plan: ${ctx.planTier}`);
  lines.push('', '## Slack context');
  lines.push(
    ctx.channelName
      ? `- Channel: #${ctx.channelName} (${ctx.channelId})`
      : `- Channel: ${ctx.channelId}`
  );
  if (ctx.routingPreamble.trim()) {
    lines.push(ctx.routingPreamble.trim());
  }
  return lines.join('\n');
}
