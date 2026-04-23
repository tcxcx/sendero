#!/usr/bin/env bun
/**
 * register-duffel-webhook — one-shot script that POSTs to
 * POST /air/webhooks with the full event set Sendero handles, prints
 * the resulting webhook secret, and reminds the operator to add it
 * to .env as DUFFEL_WEBHOOK_SECRET.
 *
 * Usage:
 *   bun run scripts/register-duffel-webhook.ts \
 *     --url https://www.sendero.travel/api/webhooks/duffel \
 *     --events order.cancelled,service.refunded        # optional override
 *
 * Environment:
 *   DUFFEL_API_TOKEN — must be present. The token's mode (test/live)
 *     determines which environment the webhook is created in.
 *
 * Safety:
 *   - Reads the existing webhook list first. If one already points at
 *     the same URL, we list it and exit without duplicating.
 *   - Never deletes. Use the Duffel dashboard or /air/webhooks/:id
 *     (DELETE) to tear one down.
 */

/* eslint-disable no-console */

interface DuffelWebhook {
  id: string;
  url: string;
  secret?: string;
  events: string[];
  active: boolean;
  live_mode: boolean;
  created_at: string;
}

const DEFAULT_EVENTS = [
  'ping.triggered',
  'order.created',
  'order.updated',
  'order.issued',
  'order.cancelled',
  'order.airline_initiated_change_detected',
  'service.refunded',
  'air.payment.pending',
  'air.payment.succeeded',
  'air.payment.failed',
  'air.payment.cancelled',
  'air.airline_credit.created',
  'air.airline_credit.spent',
  'air.airline_credit.invalidated',
];

function parseArgs(argv: string[]): { url?: string; events?: string[] } {
  const out: { url?: string; events?: string[] } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') out.url = argv[++i];
    else if (arg === '--events')
      out.events = argv[++i]
        ?.split(',')
        .map(s => s.trim())
        .filter(Boolean);
  }
  return out;
}

async function duffelFetch(
  path: string,
  init?: RequestInit & { token: string }
): Promise<Response> {
  const { token, ...rest } = init ?? { token: '' };
  return fetch(`https://api.duffel.com${path}`, {
    ...rest,
    headers: {
      ...(rest.headers ?? {}),
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Duffel-Version': 'v2',
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

async function listWebhooks(token: string): Promise<DuffelWebhook[]> {
  const res = await duffelFetch('/air/webhooks', { token });
  if (!res.ok) throw new Error(`list /air/webhooks ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: DuffelWebhook[] };
  return json.data;
}

async function createWebhook(token: string, url: string, events: string[]): Promise<DuffelWebhook> {
  const res = await duffelFetch('/air/webhooks', {
    token,
    method: 'POST',
    body: JSON.stringify({ data: { url, events } }),
  });
  if (!res.ok) throw new Error(`create /air/webhooks ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: DuffelWebhook };
  return json.data;
}

async function main() {
  const token = process.env.DUFFEL_API_TOKEN;
  if (!token) {
    console.error('DUFFEL_API_TOKEN is required.');
    process.exit(1);
  }
  const args = parseArgs(process.argv.slice(2));
  const url = args.url || process.env.DUFFEL_WEBHOOK_URL;
  if (!url) {
    console.error('Missing --url or DUFFEL_WEBHOOK_URL');
    process.exit(1);
  }
  const events = args.events?.length ? args.events : DEFAULT_EVENTS;

  const existing = await listWebhooks(token);
  const match = existing.find(w => w.url === url);
  if (match) {
    console.log('Webhook already exists for this URL:');
    console.log(`  id      : ${match.id}`);
    console.log(`  events  : ${match.events.join(', ')}`);
    console.log(`  active  : ${match.active}`);
    console.log(`  liveMode: ${match.live_mode}`);
    console.log('\nNo changes made. Use the dashboard to edit or delete.');
    return;
  }

  const hook = await createWebhook(token, url, events);
  console.log('Created Duffel webhook.');
  console.log(`  id       : ${hook.id}`);
  console.log(`  url      : ${hook.url}`);
  console.log(`  liveMode : ${hook.live_mode}`);
  console.log(`  events   : ${hook.events.join(', ')}`);
  if (hook.secret) {
    console.log('');
    console.log('────────────────────────────────────────');
    console.log('WEBHOOK SECRET (copy to .env once, Duffel will not show it again):');
    console.log(`  DUFFEL_WEBHOOK_SECRET=${hook.secret}`);
    console.log('────────────────────────────────────────');
  } else {
    console.warn(
      'No secret returned — check the response shape; may need a different Duffel version.'
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
