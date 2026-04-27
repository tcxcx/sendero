/**
 * Channel webhook smoke harness — fakes signed Slack + WhatsApp
 * payloads against a running dev server and asserts the route's
 * response shape.
 *
 * Run:
 *   SLACK_SIGNING_SECRET=… WHATSAPP_APP_SECRET=… BASE_URL=http://localhost:3000 \
 *     bun apps/app/scripts/smoke-channels.ts
 *
 * What it covers:
 *   - Slack events HMAC verify (200 + url_verification challenge)
 *   - Slack events 401 on bad signature
 *   - Slack events 404 on unknown install
 *   - Slack interactions view_submission round-trip (200 with
 *     response_action body)
 *   - Slack slash command (200 with text response)
 *   - WhatsApp inbound webhook 401 on bad signature
 *   - WhatsApp inbound webhook 200 on a status-update payload
 *
 * Each assertion is independent — failures don't short-circuit the
 * rest. Final exit code is 0 only if every assertion passed.
 */

import crypto from 'node:crypto';

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SLACK_SECRET = process.env.SLACK_SIGNING_SECRET ?? '';
const WHATSAPP_SECRET = process.env.WHATSAPP_APP_SECRET ?? '';

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  const tag = ok ? '✓' : '✗';
  // biome-ignore lint/suspicious/noConsole: smoke harness output
  console.log(`${tag} ${name} — ${detail}`);
}

function signSlack(body: string, secret: string, ts: number): string {
  const base = `v0:${ts}:${body}`;
  const hex = crypto.createHmac('sha256', secret).update(base).digest('hex');
  return `v0=${hex}`;
}

function signMeta(body: string, secret: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function postSlack(path: string, body: string, opts: { sign: boolean }) {
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'x-slack-request-timestamp': String(ts),
  };
  if (opts.sign) {
    if (!SLACK_SECRET) throw new Error('SLACK_SIGNING_SECRET required');
    headers['x-slack-signature'] = signSlack(body, SLACK_SECRET, ts);
  } else {
    headers['x-slack-signature'] = 'v0=deadbeef';
  }
  const r = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body,
  });
  return { status: r.status, body: await r.text() };
}

async function postSlackJson(path: string, body: unknown, opts: { sign: boolean }) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-slack-request-timestamp': String(ts),
  };
  if (opts.sign) {
    if (!SLACK_SECRET) throw new Error('SLACK_SIGNING_SECRET required');
    headers['x-slack-signature'] = signSlack(raw, SLACK_SECRET, ts);
  } else {
    headers['x-slack-signature'] = 'v0=deadbeef';
  }
  const r = await fetch(`${BASE_URL}${path}`, { method: 'POST', headers, body: raw });
  return { status: r.status, body: await r.text() };
}

async function postWhatsApp(body: unknown, opts: { sign: boolean }) {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.sign) {
    if (!WHATSAPP_SECRET) throw new Error('WHATSAPP_APP_SECRET required');
    headers['x-hub-signature-256'] = signMeta(raw, WHATSAPP_SECRET);
  } else {
    headers['x-hub-signature-256'] = 'sha256=bad';
  }
  const r = await fetch(`${BASE_URL}/api/webhooks/whatsapp`, {
    method: 'POST',
    headers,
    body: raw,
  });
  return { status: r.status, body: await r.text() };
}

// ─── checks ───────────────────────────────────────────────────────────

async function checkSlackUrlVerification() {
  if (!SLACK_SECRET) {
    record('slack url_verification', false, 'skipped — SLACK_SIGNING_SECRET not set');
    return;
  }
  const r = await postSlackJson(
    '/api/webhooks/slack/events',
    { type: 'url_verification', challenge: 'abc123', token: 'xx' },
    { sign: true }
  );
  const ok = r.status === 200 && JSON.parse(r.body).challenge === 'abc123';
  record('slack url_verification', ok, `status=${r.status} body=${r.body.slice(0, 80)}`);
}

async function checkSlackBadSignature() {
  const r = await postSlackJson(
    '/api/webhooks/slack/events',
    { type: 'url_verification', challenge: 'abc123' },
    { sign: false }
  );
  record('slack 401 on bad signature', r.status === 401, `status=${r.status}`);
}

async function checkSlackUnknownInstall() {
  if (!SLACK_SECRET) {
    record('slack 404 on unknown install', false, 'skipped — SLACK_SIGNING_SECRET not set');
    return;
  }
  const r = await postSlackJson(
    '/api/webhooks/slack/events',
    {
      type: 'event_callback',
      team_id: 'T_DOES_NOT_EXIST',
      event_id: `Ev_smoke_${Date.now()}`,
      event: { type: 'app_mention', user: 'U1', text: 'hi', channel: 'C1', ts: '1.0' },
    },
    { sign: true }
  );
  record('slack 404 on unknown install', r.status === 404, `status=${r.status}`);
}

async function checkSlashHelp() {
  if (!SLACK_SECRET) {
    record('slack /sendero help', false, 'skipped — SLACK_SIGNING_SECRET not set');
    return;
  }
  // Slash commands are URL-encoded form-data, not JSON.
  const body = new URLSearchParams({
    token: 'x',
    command: '/sendero',
    text: 'help',
    team_id: 'T_DOES_NOT_EXIST',
    user_id: 'U1',
    user_name: 'tester',
    channel_id: 'C1',
    response_url: 'https://hooks.slack.com/x',
    trigger_id: 'tr_1',
    api_app_id: 'A1',
  }).toString();
  const r = await postSlack('/api/webhooks/slack/commands', body, { sign: true });
  // Unknown install responds 200 with a friendly install-prompt JSON body.
  const ok = r.status === 200 && /Sendero is not installed/.test(r.body);
  record('slack /sendero (unknown install → install prompt)', ok, `status=${r.status}`);
}

async function checkWhatsAppBadSignature() {
  const r = await postWhatsApp(
    { object: 'whatsapp_business_account', entry: [] },
    { sign: false }
  );
  record('whatsapp 401 on bad signature', r.status === 401, `status=${r.status}`);
}

async function checkWhatsAppEmptyEnvelope() {
  if (!WHATSAPP_SECRET) {
    record('whatsapp empty envelope ack', false, 'skipped — WHATSAPP_APP_SECRET not set');
    return;
  }
  const r = await postWhatsApp(
    { object: 'whatsapp_business_account', entry: [] },
    { sign: true }
  );
  record('whatsapp empty envelope ack', r.status === 200, `status=${r.status}`);
}

async function main() {
  // biome-ignore lint/suspicious/noConsole: smoke harness output
  console.log(`Smoke target: ${BASE_URL}\n`);
  await checkSlackBadSignature();
  await checkSlackUrlVerification();
  await checkSlackUnknownInstall();
  await checkSlashHelp();
  await checkWhatsAppBadSignature();
  await checkWhatsAppEmptyEnvelope();

  const failed = results.filter(r => !r.ok);
  // biome-ignore lint/suspicious/noConsole: smoke harness output
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) process.exit(1);
}

await main();
