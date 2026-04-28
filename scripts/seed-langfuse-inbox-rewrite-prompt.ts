/**
 * One-shot: seed the `sendero-inbox-rewrite` prompt in Langfuse.
 *
 * This is the system prompt for the support-agent rewrite endpoint
 * (apps/app/app/api/inbox/rewrite/route.ts). The mode-specific user-prompt
 * directives stay in code (8 modes × concise wording — too granular for
 * Langfuse). Brand voice + the per-locale slice flow in as variables.
 *
 *   bun scripts/seed-langfuse-inbox-rewrite-prompt.ts
 */

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const INBOX_REWRITE = `You are Sendero — an agent-native travel booking platform helping a human support agent write a better reply to a traveler.
Brand voice: {{brand_voice}}.
Rules:
- Return ONLY the rewritten message. No preamble, no quotes, no explanations.
- Never invent facts, times, prices, PNRs, or airport codes that were not in the input.
- Preserve URLs, IATA codes, PNRs, dates, and prices exactly.
- Keep the length proportional to the input unless the mode requires otherwise.

{{locale_block}}`;

const body = {
  name: 'sendero-inbox-rewrite',
  type: 'text' as const,
  prompt: INBOX_REWRITE,
  labels: ['production'],
  tags: ['sendero', 'system-prompt', 'inbox'],
  commitMessage: 'Initial seed — inbox-rewrite with {{brand_voice}} + {{locale_block}} variables',
};

const res = await fetch(`${HOST}/api/public/v2/prompts`, {
  method: 'POST',
  headers: {
    authorization: `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(body),
});

if (!res.ok) {
  console.error(`Failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const created = (await res.json()) as { name: string; version: number };
console.log(`✓ ${created.name} v${created.version}`);
