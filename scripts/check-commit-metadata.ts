// Sendero ship metadata check.
//
// Runs from the lefthook `commit-msg` hook. Inspects the staged diff and the
// commit message, then either warns (advisory) or blocks the commit (error).
//
// Hard errors (exit 1):
//   - L or XL commit without a `Change-Size:` trailer matching the bucket.
//   - XL commit without a verifiable QA artifact trailer (see below).
//
// Everything else stays advisory (printed but exit 0).
//
// QA artifact trailers (XL gate). At least ONE of these is required for XL.
// All URLs must be https. Hostnames are allowlisted to deploy/CI providers
// we actually use, so the trailer can be re-verified post-hoc.
//
//   QA-Preview:    https://pr-16-sendero-app.vercel.app/dashboard/scan
//     Allowlist: *.vercel.app, *.workers.dev, *.pages.dev
//
//   QA-Trace:      https://github.com/<org>/<repo>/actions/runs/<id>
//                  https://blob.vercel-storage.com/<id>/playwright-trace.zip
//     Allowlist: github.com (path must contain /actions/runs/),
//                blob.vercel-storage.com, *.public.blob.vercel-storage.com
//
//   QA-Screenshot: https://abc.public.blob.vercel-storage.com/scan-pass.png
//     Allowlist: blob.vercel-storage.com, *.blob.vercel-storage.com
//
// Legacy `QA-Route: /path -> pass` is still accepted as a soft pass with a
// deprecation warning. It will be rejected after the sunset date below.
//
// Online verification (off by default — keep the gate offline-friendly):
//   pass `--online` as an extra argv, OR set LEFTHOOK_QA_ONLINE=1.
// When enabled, each artifact URL gets a 5s HEAD request; non-2xx/3xx adds
// a warning. Lefthook does NOT enable this by default; CI may opt in.
//
// Bypass for genuine emergencies:
//   LEFTHOOK=0 git commit ...    # skips ALL hooks
//   git commit --no-verify ...   # ditto
//
// Do NOT add a per-script env-var escape hatch — that creates pressure to use
// it routinely, which defeats the gate.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Sunset for legacy `QA-Route:` text trailer. 30 days from this script's
// last meaningful update (2026-04-24). After this date the deprecation
// warning should be promoted to a hard error.
const QA_ROUTE_SUNSET = '2026-05-24';

const messagePath = process.argv[2];
const onlineFlag = process.argv.includes('--online') || process.env.LEFTHOOK_QA_ONLINE === '1';
const message = messagePath ? readFileSync(messagePath, 'utf8') : '';

const numstat = execFileSync('git', ['diff', '--cached', '--numstat'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const files = numstat.map(line => {
  const [adds, deletes, ...pathParts] = line.split(/\s+/);
  const path = pathParts.join(' ');
  return {
    path,
    adds: adds === '-' ? 0 : Number(adds),
    deletes: deletes === '-' ? 0 : Number(deletes),
  };
});

if (files.length === 0) {
  process.exit(0);
}

const totalLines = files.reduce((sum, file) => sum + file.adds + file.deletes, 0);
const configFiles = files.filter(file =>
  /(^|\/)(package\.json|bun\.lock|turbo\.json|biome\.json|lefthook\.yml|\.mise\.toml|tsconfig.*\.json|next\.config\.[mc]?js|playwright\.config\.ts|postcss\.config\.[mc]?js|tailwind\.config\.ts)$|^\.github\//.test(
    file.path
  )
);
const testFiles = files.filter(file =>
  /(^|\/)(e2e|test|tests|__tests__)\/|(\.|-)(spec|test)\.[cm]?[jt]sx?$|\.t\.sol$/.test(file.path)
);
const sourceFiles = files.filter(
  file =>
    /\.(ts|tsx|js|jsx|mjs|cjs|sol)$/.test(file.path) &&
    !configFiles.includes(file) &&
    !testFiles.includes(file)
);

const inferredSize =
  totalLines >= 600 || files.length >= 20
    ? 'XL'
    : totalLines >= 200
      ? 'L'
      : totalLines >= 50
        ? 'M'
        : 'S';

const warnings: string[] = [];
const errors: { msg: string; fix: string }[] = [];

// Change-Size: required (and must match bucket) for L and XL. Advisory below L.
const changeSizeMatch = message.match(/^Change-Size:\s*(S|M|L|XL)\b/im);
const declaredSize = changeSizeMatch ? changeSizeMatch[1].toUpperCase() : null;

if (inferredSize === 'L' || inferredSize === 'XL') {
  if (!declaredSize) {
    errors.push({
      msg: `${inferredSize} commit missing Change-Size trailer`,
      fix: `add "Change-Size: ${inferredSize}" to the commit body`,
    });
  } else if (declaredSize !== inferredSize) {
    errors.push({
      msg: `Change-Size: ${declaredSize} mislabels a ${inferredSize}-bucket commit (${totalLines} lines, ${files.length} files)`,
      fix: `update trailer to "Change-Size: ${inferredSize}"`,
    });
  }
} else if (!changeSizeMatch) {
  warnings.push(`add Change-Size: ${inferredSize}`);
}

if (!/^PR-ID:\s*(#?\d+|pending|n\/a)\b/im.test(message)) {
  warnings.push('add PR-ID: pending, n/a, or #123');
}

// ---------- QA artifact gate (XL only) ----------

type QaKind = 'Preview' | 'Trace' | 'Screenshot';
type QaTrailer = { kind: QaKind; url: string; raw: string };

function parseQaTrailers(body: string): QaTrailer[] {
  const out: QaTrailer[] = [];
  const re = /^QA-(Preview|Trace|Screenshot):\s*(\S+)\s*$/gim;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(body)) !== null) {
    out.push({ kind: m[1] as QaKind, url: m[2], raw: m[0] });
  }
  return out;
}

function hostMatchesSuffix(host: string, suffix: string): boolean {
  // suffix like ".vercel.app" matches host "x.vercel.app" or "a.b.vercel.app".
  // Bare host equality is handled by callers separately.
  return host.endsWith(suffix);
}

function validateQaTrailer(t: QaTrailer): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(t.url);
  } catch {
    return { ok: false, reason: `not a valid URL: ${t.url}` };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: `must be https (got ${parsed.protocol || 'no scheme'})` };
  }
  const host = parsed.hostname.toLowerCase();

  if (t.kind === 'Preview') {
    const ok =
      hostMatchesSuffix(host, '.vercel.app') ||
      hostMatchesSuffix(host, '.workers.dev') ||
      hostMatchesSuffix(host, '.pages.dev');
    if (!ok) {
      return {
        ok: false,
        reason: `QA-Preview host not allowlisted (${host}); expected *.vercel.app, *.workers.dev, or *.pages.dev`,
      };
    }
    return { ok: true };
  }

  if (t.kind === 'Trace') {
    if (host === 'github.com') {
      if (!/\/actions\/runs\//.test(parsed.pathname)) {
        return {
          ok: false,
          reason: `QA-Trace github.com URL must include /actions/runs/<id> (got ${parsed.pathname})`,
        };
      }
      return { ok: true };
    }
    if (
      host === 'blob.vercel-storage.com' ||
      hostMatchesSuffix(host, '.public.blob.vercel-storage.com') ||
      hostMatchesSuffix(host, '.blob.vercel-storage.com')
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `QA-Trace host not allowlisted (${host}); expected github.com/.../actions/runs/, blob.vercel-storage.com, or *.blob.vercel-storage.com`,
    };
  }

  // Screenshot
  if (host === 'blob.vercel-storage.com' || hostMatchesSuffix(host, '.blob.vercel-storage.com')) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: `QA-Screenshot host not allowlisted (${host}); expected blob.vercel-storage.com or *.blob.vercel-storage.com`,
  };
}

async function pingArtifact(url: string): Promise<string | null> {
  // Returns null on success, an error string on failure. 5s timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) return `HEAD ${res.status} for ${url}`;
    return null;
  } catch (err) {
    return `HEAD failed for ${url}: ${(err as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}

const qaRouteRequired = inferredSize === 'XL' || totalLines >= 600;
const qaTrailers = parseQaTrailers(message);
const validQa: QaTrailer[] = [];
for (const t of qaTrailers) {
  const result = validateQaTrailer(t);
  if (result.ok) {
    validQa.push(t);
  } else {
    // Per-trailer rejection is a hard error so authors don't paste
    // half-broken URLs and assume they passed.
    errors.push({
      msg: `QA-${t.kind} trailer invalid — ${result.reason}`,
      fix: `fix the URL or remove the trailer; see scripts/check-commit-metadata.ts header for allowlist`,
    });
  }
}

const legacyQaRouteMatch = message.match(/^QA-Route:\s*\S.*->\s*(\S+)/im);
const hasLegacyQaRoute = Boolean(legacyQaRouteMatch);

if (qaRouteRequired) {
  if (validQa.length === 0 && !hasLegacyQaRoute) {
    errors.push({
      msg: 'XL commit missing verifiable QA artifact trailer',
      fix: 'add at least one of QA-Preview / QA-Trace / QA-Screenshot with an https URL from the allowlisted hosts (see script header)',
    });
  } else if (validQa.length === 0 && hasLegacyQaRoute) {
    warnings.push(
      `QA-Route is deprecated — upgrade to QA-Preview/QA-Trace/QA-Screenshot. Sunset ${QA_ROUTE_SUNSET}.`
    );
  }
}

if ((inferredSize === 'XL' || totalLines >= 600) && testFiles.length === 0) {
  warnings.push('XL commit changed no smoke/e2e/test files');
}

if (
  configFiles.length > 0 &&
  sourceFiles.length > 0 &&
  !/^Config-Churn:\s*(mixed|isolated)\b/im.test(message)
) {
  warnings.push(
    'config/package changes are mixed with source; split commit or add Config-Churn: mixed with rationale'
  );
}

// Online ping (opt-in). Runs only when there are valid trailers and
// we're not already failing — don't spend network time on a doomed commit.
if (onlineFlag && validQa.length > 0 && errors.length === 0) {
  const results = await Promise.all(validQa.map(t => pingArtifact(t.url)));
  for (const r of results) {
    if (r) warnings.push(`online QA check: ${r}`);
  }
}

if (errors.length > 0) {
  console.log('\n✘ Sendero ship metadata error');
  console.log(
    `  Staged size: ${inferredSize} (${totalLines} changed lines, ${files.length} files)`
  );
  for (const error of errors) {
    console.log(`  ✘ ERROR: ${error.msg}`);
    console.log(`    fix: ${error.fix}`);
  }
}

if (warnings.length > 0) {
  console.log('\n! Sendero ship metadata advisory');
  console.log(
    `  Staged size: ${inferredSize} (${totalLines} changed lines, ${files.length} files)`
  );
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

if (errors.length > 0 || warnings.length > 0) {
  console.log('\n  Suggested commit body trailers:');
  console.log(`  PR-ID: pending`);
  console.log(`  Change-Size: ${inferredSize}`);
  console.log(`  Test: <focused check or smoke/e2e spec>`);
  console.log(`  QA-Preview: https://pr-<n>-sendero-app.vercel.app/<route>`);
  console.log(`  # or QA-Trace: https://github.com/<org>/<repo>/actions/runs/<id>`);
  console.log(`  # or QA-Screenshot: https://<id>.public.blob.vercel-storage.com/<file>.png`);
  console.log(
    `\n  Bypass for emergencies: LEFTHOOK=0 git commit ...   |   git commit --no-verify ...`
  );
}

console.log(`\ncommit-metadata: ${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
