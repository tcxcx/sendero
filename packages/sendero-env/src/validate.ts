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

const REQUIRED: Required[] = [
  { name: 'DATABASE_URL', scope: 'db', hint: 'Neon pooled connection string' },
  { name: 'DIRECT_URL', scope: 'db', hint: 'Neon direct (non-pooled) connection string' },
  {
    name: 'AI_GATEWAY_API_KEY',
    scope: 'agent',
    accepts: ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'],
    hint: 'Vercel AI Gateway (preferred) OR a direct provider key — any one satisfies the agent',
  },
  { name: 'CLERK_SECRET_KEY', scope: 'auth' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', scope: 'auth' },
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
  { name: 'DUFFEL_API_TOKEN', scope: 'duffel' },
  // Keep ANTHROPIC_API_KEY as a soft fallback check too so operators see
  // it listed — but the agent-level check above already accepts gateway OR
  // any direct key, so this is informational.
  {
    name: 'NEXT_PUBLIC_ARC_CHAIN_ID',
    scope: 'onchain',
    hint: 'Chain id for the frontend (5042002 on Arc Testnet)',
  },
];

interface Gap {
  scope: string;
  name: string;
  hint?: string;
  tried?: string[];
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
