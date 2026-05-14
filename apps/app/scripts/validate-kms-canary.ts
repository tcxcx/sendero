/**
 * Canary validation — verify the Gateway-signer KMS read path activated
 * for the sandbox tenant after PR #48 deploys.
 *
 * Reads recent `wallet_access_logs` rows for the canary tenant, then
 * cross-references the matching `signing_events` (`kmsKeyVersion`)
 * inside the same time window to classify each decrypt:
 *
 *   - `projects/sendero-494217/...`  → KMS path ✓ (the goal)
 *   - `env-v1`                       → still env-mode (canary not active)
 *   - other                          → unexpected
 *
 * Why two tables: `wallet_access_logs.kekVersion` is an Int and does not
 * carry the KMS key resource path. The string discriminator (`env-v1`
 * vs `projects/...`) lives on `signing_events.kmsKeyVersion`, written
 * by `recordSignerAccessEvent` from the same `decryptSigner` call.
 *
 * Exit code 0 if ≥1 row inside the window is on the KMS path; 1 otherwise.
 *
 * Usage:
 *   bun apps/app/scripts/validate-kms-canary.ts
 *   bun apps/app/scripts/validate-kms-canary.ts --minutes 30
 *   bun apps/app/scripts/validate-kms-canary.ts --limit 20
 *   bun apps/app/scripts/validate-kms-canary.ts --trigger-action
 *
 * Flags:
 *   --minutes N         Time window for both tables (default 60).
 *   --limit N           Max wallet_access_logs rows to render (default 10).
 *   --tenant <id>       Override canary tenant id (default sendero-sandbox).
 *   --trigger-action    Cold-cache call to getGatewaySigner(tenantId) to
 *                       force a fresh audit row. NO on-chain action.
 *
 * Read-only against prod DB unless `--trigger-action` is passed, in which
 * case the script still only triggers a single signer decrypt (one
 * wallet_access_logs row + one signing_events row).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

loadEnvFile(resolve(process.cwd(), '.env.local'));
loadEnvFile(resolve(process.cwd(), 'apps/app/.env.local'));

import { prisma } from '@sendero/database';

const DEFAULT_TENANT_ID = 'cmp24bjrh0000ol9kf6vl1v6v';
const DEFAULT_TENANT_SLUG = 'sendero-sandbox';
const EXPECTED_SIGNER_ADDRESS = '0xa041bba8b05c2e9414f1dde8a244028121dc4419';
const KMS_PREFIX = 'projects/sendero-494217/';

interface Cli {
  minutes: number;
  limit: number;
  tenantId: string;
  triggerAction: boolean;
}

function parseCli(argv: string[]): Cli {
  const cli: Cli = {
    minutes: 60,
    limit: 10,
    tenantId: DEFAULT_TENANT_ID,
    triggerAction: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--minutes') cli.minutes = Number(required(argv, ++i, arg));
    else if (arg === '--limit') cli.limit = Number(required(argv, ++i, arg));
    else if (arg === '--tenant') cli.tenantId = required(argv, ++i, arg);
    else if (arg === '--trigger-action') cli.triggerAction = true;
    else if (arg === '--help' || arg === '-h') usage(0);
    else throw new Error(`unknown arg: ${arg}`);
  }
  if (!Number.isFinite(cli.minutes) || cli.minutes < 1 || cli.minutes > 1440) {
    throw new Error('--minutes must be a positive integer ≤ 1440');
  }
  if (!Number.isInteger(cli.limit) || cli.limit < 1 || cli.limit > 200) {
    throw new Error('--limit must be an integer between 1 and 200');
  }
  return cli;
}

function required(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function usage(code: number): never {
  console.log(`Usage:
  bun apps/app/scripts/validate-kms-canary.ts [--minutes 60] [--limit 10]
  bun apps/app/scripts/validate-kms-canary.ts --trigger-action
  bun apps/app/scripts/validate-kms-canary.ts --tenant <tenantId>`);
  process.exit(code);
}

type Classification = 'kms' | 'env' | 'unexpected' | 'no-signing-event';

interface ClassifiedRow {
  occurredAt: Date;
  callerSurface: string;
  callerUserId: string | null;
  kekVersion: number;
  context: string | null;
  signerKmsKeyVersion: string | null;
  classification: Classification;
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  const windowStart = new Date(Date.now() - cli.minutes * 60_000);

  console.log(
    `[kms-canary] tenant=${cli.tenantId} (${DEFAULT_TENANT_SLUG}) ` +
      `window=${cli.minutes}m (>= ${windowStart.toISOString()})`
  );

  if (cli.triggerAction) {
    await triggerColdRead(cli.tenantId);
  }

  const auditRows = await prisma.walletAccessLog.findMany({
    where: { tenantId: cli.tenantId, occurredAt: { gte: windowStart } },
    orderBy: { occurredAt: 'desc' },
    take: cli.limit,
  });

  if (auditRows.length === 0) {
    console.log('[kms-canary] no wallet_access_logs rows in window');
    console.log('[kms-canary] hint: pass --trigger-action to force a fresh decrypt');
    process.exit(1);
  }

  const signingEvents = await prisma.signingEvent.findMany({
    where: {
      principalId: cli.tenantId,
      messageKind: { startsWith: 'signer-access:tenant' },
      createdAt: { gte: windowStart },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      kmsKeyVersion: true,
      signerAddress: true,
      messageKind: true,
    },
  });

  const classified: ClassifiedRow[] = auditRows.map(row => {
    const match = nearestSigningEvent(signingEvents, row.occurredAt);
    const signerKmsKeyVersion = match?.kmsKeyVersion ?? null;
    return {
      occurredAt: row.occurredAt,
      callerSurface: row.callerSurface,
      callerUserId: row.callerUserId,
      kekVersion: row.kekVersion,
      context: row.context,
      signerKmsKeyVersion,
      classification: classify(signerKmsKeyVersion),
    };
  });

  printRows(classified);

  const summary = summarize(classified);
  console.log('\n[kms-canary] summary:');
  console.log(`  total rendered:        ${classified.length}`);
  console.log(`  KMS path (kms):        ${summary.kms}`);
  console.log(`  env-mode (env):        ${summary.env}`);
  console.log(`  unexpected:            ${summary.unexpected}`);
  console.log(`  no signing_event peer: ${summary['no-signing-event']}`);

  const addressMismatch = signingEvents.find(
    ev =>
      ev.signerAddress.toLowerCase() !== EXPECTED_SIGNER_ADDRESS.toLowerCase() &&
      ev.signerAddress.length === EXPECTED_SIGNER_ADDRESS.length
  );
  if (addressMismatch) {
    console.warn(
      `[kms-canary] warning: signing_events.signerAddress=${addressMismatch.signerAddress} ` +
        `does not match expected ${EXPECTED_SIGNER_ADDRESS}`
    );
  }

  if (summary.kms >= 1) {
    console.log('[kms-canary] ✓ KMS read path is active for canary tenant');
    process.exit(0);
  }
  console.error('[kms-canary] ✗ no KMS-path decrypt seen in window');
  console.error(
    '[kms-canary] check SENDERO_GATEWAY_SIGNER_KMS_CANARY_TENANTS, ' +
      'SENDERO_GATEWAY_SIGNER_KMS_READ_MODE, and that the canary row has ' +
      "kekProvider='kms_v1' + newEnvelope + kmsKeyResource set"
  );
  process.exit(1);
}

function nearestSigningEvent(
  events: Array<{ createdAt: Date; kmsKeyVersion: string; signerAddress: string }>,
  target: Date
): { createdAt: Date; kmsKeyVersion: string; signerAddress: string } | null {
  // wallet_access_logs and signing_events are written from the same
  // decryptSigner call but on independent void promises — match within
  // ±5s on createdAt.
  const targetMs = target.getTime();
  let best: { createdAt: Date; kmsKeyVersion: string; signerAddress: string } | null = null;
  let bestDelta = Infinity;
  for (const ev of events) {
    const delta = Math.abs(ev.createdAt.getTime() - targetMs);
    if (delta < bestDelta && delta <= 5_000) {
      best = ev;
      bestDelta = delta;
    }
  }
  return best;
}

function classify(signerKmsKeyVersion: string | null): Classification {
  if (signerKmsKeyVersion === null) return 'no-signing-event';
  if (signerKmsKeyVersion.startsWith(KMS_PREFIX)) return 'kms';
  if (signerKmsKeyVersion === 'env-v1' || /^env-v\d+$/.test(signerKmsKeyVersion)) return 'env';
  return 'unexpected';
}

function summarize(rows: ClassifiedRow[]): Record<Classification, number> {
  const acc: Record<Classification, number> = {
    kms: 0,
    env: 0,
    unexpected: 0,
    'no-signing-event': 0,
  };
  for (const r of rows) acc[r.classification]++;
  return acc;
}

function printRows(rows: ClassifiedRow[]): void {
  console.log('\n[kms-canary] recent wallet_access_logs rows (newest first):');
  for (const r of rows) {
    const mark =
      r.classification === 'kms'
        ? '✓ kms'
        : r.classification === 'env'
          ? '· env'
          : r.classification === 'unexpected'
            ? '? unx'
            : '∅ no-evt';
    console.log(
      `  ${r.occurredAt.toISOString()}  ${mark}  ` +
        `surface=${r.callerSurface.padEnd(8)} ` +
        `ctx=${(r.context ?? '∅').padEnd(20).slice(0, 20)} ` +
        `kek=v${r.kekVersion}  ` +
        `kms=${truncate(r.signerKmsKeyVersion ?? '∅', 60)}`
    );
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

async function triggerColdRead(tenantId: string): Promise<void> {
  console.log('[kms-canary] --trigger-action: cold-cache call to getGatewaySigner');
  // Lazy import so the read-only default path doesn't pull viem/crypto.
  const { getGatewaySigner, invalidateGatewaySignerCache } = await import(
    '@sendero/circle/gateway-signer'
  );
  invalidateGatewaySignerCache(tenantId);
  const signer = await getGatewaySigner(tenantId, {
    caller: { surface: 'cli', context: 'validate-kms-canary' },
  });
  if (!signer) {
    throw new Error(
      `trigger-action: getGatewaySigner returned null — no TenantGatewaySigner row for ${tenantId}`
    );
  }
  console.log(
    `[kms-canary] cold read ok: address=${signer.address} kekVersion=${signer.kekVersion} ` +
      `kmsKeyVersion=${signer.kmsKeyVersion ?? '(env)'}`
  );
  // Audit writes are fire-and-forget — give them a beat to land before we query.
  await new Promise(r => setTimeout(r, 750));
}

function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // missing file is fine; bun may have already auto-loaded one
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

main()
  .catch(err => {
    console.error('[kms-canary] failed:', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
