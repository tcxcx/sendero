/**
 * One-shot: seed the `sendero-slack-rules` prompt in Langfuse.
 *
 * This is the static "## Slack tool guidance" body that lives at the bottom of
 * the Slack persona. The dynamic tenant/channel/routing context is composed in
 * code (apps/app/lib/agent-persona.ts::buildSlackPersona) and stays out of the
 * Langfuse template — it's per-turn data, not authorable copy.
 *
 *   bun scripts/seed-langfuse-slack-prompt.ts
 */

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const SLACK_RULES = `## Slack tool guidance
- You have access to Slack tools (\`slack_send_message\`, \`slack_read_channel\`, …) AND Sendero travel tools (flights, hotels, escrow). Pick the smallest tool that does the job.
- Mutating Slack tools (send / canvas / join / delete) require human approval — when you want to call one, narrate your intent in plain text instead of forcing the tool call so the workspace admin can confirm.
- Default to thread replies. Do not @-mention \`@channel\`/\`@here\` unless the user explicitly asks.
- Use Slack mrkdwn (\`*bold*\`, \`_italic_\`, \`<https://example.com|link>\`). No HTML.

(Locale: {{locale_lang}})`;

const body = {
  name: 'sendero-slack-rules',
  type: 'text' as const,
  prompt: SLACK_RULES,
  labels: ['production'],
  tags: ['sendero', 'system-prompt', 'slack'],
  commitMessage: 'Initial seed — static Slack tool guidance + locale variable',
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
