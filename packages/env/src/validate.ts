/**
 * `@sendero/env#validate` turbo task entry point.
 *
 * Runs `bun run src/validate.ts` at the top of the build graph so a
 * misconfigured deploy fails fast with a named list of missing vars —
 * not mid-request when a route throws 500. Set `SKIP_ENV_VALIDATION=1`
 * to bypass (useful during a `typecheck`-only CI job).
 *
 * The pattern mirrors desk-v1's `@bu/env#build` being a `dependsOn`
 * for every downstream app, plus an upgraded "fail with a list" loud
 * message so an operator sees all gaps in one line.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Required {
  /** Env var name. */
  name: string;
  /** Human-readable subsystem the var belongs to. */
  scope: string;
  /** Accepts any of these keys as satisfying the requirement. */
  accepts?: string[];
  /** Free-form hint printed on failure. */
  hint?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

function loadEnvLocal(path: string) {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || process.env[key]) continue;
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvLocal(join(repoRoot, '.env.local'));
loadEnvLocal(join(repoRoot, 'apps', 'app', '.env.local'));

const REQUIRED: Required[] = [
  {
    name: 'NEXT_PUBLIC_APP_URL',
    scope: 'app',
    hint: 'Canonical app origin; use http://localhost:3010 locally and the deployed app URL in prod',
  },
  {
    name: 'NEXT_PUBLIC_SENDERO_GUEST_LINK_ORIGIN',
    scope: 'app',
    hint: 'Origin used when generating guest claim links; usually matches NEXT_PUBLIC_APP_URL',
  },
  { name: 'DATABASE_URL', scope: 'db', hint: 'Neon pooled connection string' },
  { name: 'DIRECT_URL', scope: 'db', hint: 'Neon direct (non-pooled) connection string' },
  {
    name: 'AI_GATEWAY_API_KEY',
    scope: 'agent',
    accepts: ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    hint: 'Vercel AI Gateway (preferred) OR a direct provider key — any one satisfies the agent',
  },
  { name: 'CLERK_SECRET_KEY', scope: 'auth', hint: 'from Clerk Dashboard → API keys' },
  {
    name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    scope: 'auth',
    hint: 'from Clerk Dashboard → API keys',
  },
  {
    name: 'CLERK_WEBHOOK_SECRET',
    scope: 'auth',
    hint: 'svix signing secret from Clerk Dashboard → Webhooks',
  },
  { name: 'TREASURY_PRIVATE_KEY', scope: 'onchain', hint: 'Operator EOA for escrow' },
  {
    name: 'ARC_ESCROW_ADDRESS',
    scope: 'onchain',
    accepts: [
      'ARC_ESCROW_ADDRESS',
      'NEXT_PUBLIC_ARC_ESCROW_ADDRESS',
      'SENDERO_GUEST_ESCROW',
      'NEXT_PUBLIC_SENDERO_GUEST_ESCROW',
    ],
    hint: 'Deployed SenderoGuestEscrow',
  },
  {
    name: 'NEXT_PUBLIC_SENDERO_GUEST_ESCROW',
    scope: 'onchain',
    accepts: ['NEXT_PUBLIC_SENDERO_GUEST_ESCROW', 'NEXT_PUBLIC_ARC_ESCROW_ADDRESS'],
    hint: 'Public escrow address read by the guest claim page',
  },
  {
    name: 'SENDERO_AGENT_TOKEN_ID',
    scope: 'onchain',
    accepts: ['SENDERO_AGENT_TOKEN_ID', 'SENDERO_AGENT_ID'],
    hint: 'ERC-8004 agent token id',
  },
  { name: 'CIRCLE_API_KEY', scope: 'circle' },
  {
    name: 'CIRCLE_ENTITY_SECRET',
    scope: 'circle',
    accepts: ['CIRCLE_ENTITY_SECRET', 'CIRCLE_ENTITY_SECRET_CIPHERTEXT'],
  },
  {
    name: 'CIRCLE_TREASURY_WALLET_ID',
    scope: 'circle',
    hint: 'Circle developer-controlled treasury wallet id used for balance and transfers',
  },
  {
    name: 'CIRCLE_TREASURY_ADDRESS',
    scope: 'circle',
    hint: 'Circle developer-controlled treasury wallet address',
  },
  {
    name: 'NEXT_PUBLIC_CIRCLE_CLIENT_KEY',
    scope: 'circle',
    accepts: ['NEXT_PUBLIC_CIRCLE_CLIENT_KEY', 'NEXT_PUBLIC_CIRCLE_MODULAR_CLIENT_KEY'],
    hint: 'Circle Modular Wallets client key for passkey guest wallets',
  },
  { name: 'DUFFEL_API_TOKEN', scope: 'duffel' },
  // Keep ANTHROPIC_API_KEY as a soft fallback check too so operators see
  // it listed — but the agent-level check above already accepts gateway OR
  // any direct key, so this is informational.
  {
    name: 'NEXT_PUBLIC_ARC_CHAIN_ID',
    scope: 'onchain',
    hint: 'Chain id for the frontend (5042002 on Arc Testnet)',
  },
  {
    name: 'DUFFEL_WEBHOOK_SECRET',
    scope: 'duffel',
    hint: 'HMAC secret from the Duffel dashboard for POST /api/webhooks/duffel',
  },
  {
    name: 'CRON_SECRET',
    scope: 'billing',
    hint: 'Shared secret for Vercel cron routes and operational PDF fallback',
  },
  {
    name: 'SENDERO_TREASURY_ADDRESS',
    scope: 'onchain',
    hint: 'Destination EOA/MSCA for nanopay batch settlements (0x... on Arc)',
  },
  {
    name: 'INVOICE_SIGNING_SECRET',
    scope: 'invoicing',
    hint: "32+ char secret for signing invoice public URL JWTs; generate: node -e \"console.log(require('node:crypto').randomBytes(32).toString('base64url'))\"",
  },
  {
    name: 'BLOB_READ_WRITE_TOKEN',
    scope: 'invoicing',
    hint: 'Vercel Blob token — auto-provisioned by Marketplace Blob integration on arc-web',
  },
  {
    name: 'RESEND_API_KEY',
    scope: 'email',
    hint: 'Resend API key for guest invites and platform invoices',
  },
  {
    name: 'RESEND_WEBHOOK_SECRET',
    scope: 'email',
    hint: 'Resend webhook signing secret for POST /api/webhooks/resend',
  },
  {
    name: 'SENDERO_EMAIL_FROM',
    scope: 'email',
    hint: 'RFC-5322 From header, e.g. Sendero <hello@sendero.travel>',
  },
];

interface Gap {
  scope: string;
  name: string;
  hint?: string;
  tried?: string[];
}

function assertProductionClerkLiveKeys(): void {
  if (process.env.SKIP_ENV_VALIDATION === '1') return;
  if (process.env.VERCEL_ENV !== 'production') return;
  const sk = process.env.CLERK_SECRET_KEY ?? '';
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  if (!sk && !pk) return;
  if (sk.startsWith('ak_') || pk.startsWith('pk_test_')) {
    console.error(
      '[sendero/env] ✖  Vercel Production (VERCEL_ENV=production) must use Clerk live API keys (sk_live_…, pk_live_…). In Clerk Dashboard → API Keys, switch to Production and copy those keys into the Production environment on Vercel.'
    );
    process.exit(1);
  }
}

export function validate(): { ok: true } | { ok: false; gaps: Gap[] } {
  if (process.env.SKIP_ENV_VALIDATION === '1') {
    return { ok: true };
  }
  const gaps: Gap[] = [];
  for (const req of REQUIRED) {
    const keys = req.accepts ?? [req.name];
    const satisfied = keys.some(k => Boolean(process.env[k]));
    if (!satisfied) {
      gaps.push({ scope: req.scope, name: req.name, hint: req.hint, tried: req.accepts });
    }
  }
  return gaps.length === 0 ? { ok: true } : { ok: false, gaps };
}

function main() {
  const result = validate();
  if (result.ok === true) {
    assertProductionClerkLiveKeys();
    // eslint-disable-next-line no-console
    console.log('[sendero/env] ✔  all required variables present');
    return;
  }
  const gaps = result.gaps;
  console.error('[sendero/env] ✖  missing environment variables:\n');
  const grouped: Record<string, Gap[]> = {};
  for (const gap of gaps) {
    if (!grouped[gap.scope]) grouped[gap.scope] = [];
    grouped[gap.scope].push(gap);
  }
  for (const scope of Object.keys(grouped)) {
    console.error(`  [${scope}]`);
    for (const gap of grouped[scope]) {
      const line = gap.tried
        ? `    ${gap.name}  (accepts: ${gap.tried.join(', ')})`
        : `    ${gap.name}`;
      console.error(gap.hint ? `${line}  — ${gap.hint}` : line);
    }
  }
  console.error('\n  Bypass once: SKIP_ENV_VALIDATION=1 turbo run build');
  console.error('  Fix: populate the above in .env.local (or the deploy env).');
  process.exit(1);
}

// Run as a script when invoked directly via `bun run ./src/validate.ts`.
const invoked = typeof process !== 'undefined' && process.argv[1]?.endsWith('validate.ts');
if (invoked) main();
