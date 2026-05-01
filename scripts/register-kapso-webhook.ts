#!/usr/bin/env bun
/**
 * register-kapso-webhook — prints the exact steps to register Sendero's
 * Kapso project-scope webhook for `whatsapp.phone_number.created`.
 *
 * Kapso's project-scope webhooks are dashboard-only — there is no
 * public API for create/list/delete (verified Apr 2026 against
 * https://docs.kapso.ai/docs/platform/webhooks/overview). So this is
 * an instructions printer, not an automation. The script resolves the
 * right URL from your env and tells you exactly what to paste where.
 *
 * (WhatsApp phone-number-scoped webhooks DO have an API surface at
 *  `POST /platform/v1/whatsapp/phone_numbers/:id/webhooks`, but we
 *  don't need them — Meta already delivers inbound messages to our
 *  /api/webhooks/whatsapp route via the Kapso proxy, and connection
 *  events come through the project-scope channel.)
 *
 * Usage:
 *   bun run scripts/register-kapso-webhook.ts
 *   bun run scripts/register-kapso-webhook.ts --url https://app.sendero.travel/api/webhooks/kapso
 *
 * Environment:
 *   KAPSO_WEBHOOK_BASE_URL  — preferred; e.g. https://app.sendero.travel
 *   NEXT_PUBLIC_APP_URL     — fallback; same shape
 */

/* eslint-disable no-console */

const SENDERO_EVENTS = ['whatsapp.phone_number.created'];
const DASHBOARD_URL = 'https://app.kapso.ai';

function parseArgs(argv: string[]): { url?: string } {
  const out: { url?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') out.url = argv[++i];
  }
  return out;
}

function resolveUrl(args: { url?: string }): string | null {
  if (args.url) return args.url;
  const base = process.env.KAPSO_WEBHOOK_BASE_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? null;
  return base ? `${base.replace(/\/$/, '')}/api/webhooks/kapso` : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = resolveUrl(args);
  if (!url) {
    console.error(
      'Missing webhook URL. Pass --url <publicUrl> or set KAPSO_WEBHOOK_BASE_URL / NEXT_PUBLIC_APP_URL.'
    );
    process.exit(1);
  }
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    console.error(
      `Refusing to instruct registering a localhost URL with Kapso (${url}). Use ngrok / a Vercel preview / production.`
    );
    process.exit(1);
  }

  console.log('────────────────────────────────────────');
  console.log('Kapso project-webhook registration (dashboard-only)');
  console.log('────────────────────────────────────────');
  console.log('');
  console.log('Kapso does not expose project-webhook create/list via the public API.');
  console.log('Register from the dashboard once, then paste the secret into env.');
  console.log('');
  console.log(`1. Open ${DASHBOARD_URL} → sign in to the Sendero project.`);
  console.log('2. Open the left sidebar → Webhooks → Create webhook.');
  console.log('3. Fill in:');
  console.log(`     URL    : ${url}`);
  console.log(`     Events : ${SENDERO_EVENTS.join(', ')}`);
  console.log('     Active : true');
  console.log('     Kind   : kapso');
  console.log('4. Save. The dashboard shows the signing secret — copy it.');
  console.log('5. Add the secret to your env (.env.local for dev, Vercel env for prod):');
  console.log('');
  console.log('     KAPSO_GLOBAL_WEBHOOK_SECRET=<paste-here>');
  console.log('');
  console.log('6. Restart the dev server (env changes need a hot reload).');
  console.log('');
  console.log('Verify:');
  console.log(`  curl -X POST ${url} \\`);
  console.log("    -H 'x-webhook-signature: <test-signature>' \\");
  console.log("    -H 'content-type: application/json' \\");
  console.log('    -d \'{"type":"whatsapp.phone_number.created","data":{...}}\'');
  console.log(
    '  → should return {"error":"invalid_signature"} if KAPSO_GLOBAL_WEBHOOK_SECRET is set,'
  );
  console.log('    or {"error":"webhook_not_configured"} (503) if it is not.');
  console.log('');
  console.log('When a real customer finishes Meta Embedded Signup in the wizard, Kapso will');
  console.log('POST to this URL signed with that secret. The handler dedupes via WebhookEvent');
  console.log('and updates the matching WhatsAppInstall to status=active with the real');
  console.log('phone_number_id.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
