#!/usr/bin/env bun
/**
 * config-doctor — diff every config file that should agree across the
 * monorepo and fail loudly when they drift. Catches the next "wrangler.toml
 * at repo root vs apps/edge" class of bug before it ships.
 *
 * Six independent checks, each accumulates findings into a shared list:
 *
 *  1. Runtime versions       — .mise.toml ↔ package.json#packageManager
 *                              ↔ engines.node ↔ .nvmrc
 *  2. .env.example coverage  — every process.env.X / Bun.env.X reference
 *                              in production code must appear in
 *                              .env.example. Soft-warn extras.
 *  3. apps/* vercel.json     — valid JSON, framework set, buildCommand
 *                              references real package.json scripts.
 *  4. wrangler canonical     — apps/edge/wrangler.toml exists, root
 *                              wrangler.toml does NOT.
 *  5. next-env.d.ts          — all four next apps share the same
 *                              routes.d.ts import path.
 *
 * ERROR (✘) → exit 1. WARN (⚠) → informational. Run via:
 *   bun run scripts/config-doctor.ts
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

type Severity = 'error' | 'warn';
type Finding = { section: string; severity: Severity; message: string; file?: string };

const REPO_ROOT = process.cwd();
const findings: Finding[] = [];

function record(section: string, severity: Severity, message: string, file?: string) {
  findings.push({ section, severity, message, file });
}

async function main() {
  await checkRuntimeVersions();
  await checkEnvExample();
  await checkVercelJsonPerApp();
  await checkWranglerCanonical();
  await checkNextEnvConsistency();

  printReport();
  const errors = findings.filter(f => f.severity === 'error').length;
  process.exit(errors > 0 ? 1 : 0);
}

// ──────────────────────────────────────────────────────────────────────
// 1. Runtime versions
// ──────────────────────────────────────────────────────────────────────

async function checkRuntimeVersions() {
  const SECTION = 'runtime-versions';

  const misePath = join(REPO_ROOT, '.mise.toml');
  if (!existsSync(misePath)) {
    record(SECTION, 'error', '.mise.toml is missing — required for dev tool pinning.', misePath);
    return;
  }
  const mise = readFileSync(misePath, 'utf8');
  const miseBun = matchToml(mise, 'bun');
  const miseNode = matchToml(mise, 'node');

  const pkgPath = join(REPO_ROOT, 'package.json');
  if (!existsSync(pkgPath)) {
    record(SECTION, 'error', 'root package.json is missing.', pkgPath);
    return;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

  // packageManager: "bun@1.3.10" must match .mise.toml#bun
  if (typeof pkg.packageManager === 'string') {
    const match = pkg.packageManager.match(/^bun@(.+)$/);
    if (match && miseBun && match[1] !== miseBun) {
      record(
        SECTION,
        'error',
        `package.json#packageManager is bun@${match[1]} but .mise.toml pins bun = "${miseBun}". Update one to match the other.`,
        pkgPath
      );
    }
  } else {
    record(
      SECTION,
      'warn',
      'package.json has no `packageManager` field — corepack/Vercel may pick the wrong bun.',
      pkgPath
    );
  }

  // engines.node: optional, but if present must match mise's node major.
  if (pkg.engines?.node && miseNode) {
    const miseMajor = miseNode.split('.')[0];
    const enginesMajor = String(pkg.engines.node).match(/(\d+)/)?.[1];
    if (enginesMajor && enginesMajor !== miseMajor) {
      record(
        SECTION,
        'error',
        `package.json#engines.node = "${pkg.engines.node}" disagrees with .mise.toml node = "${miseNode}". Major versions must match.`,
        pkgPath
      );
    }
  }

  // .nvmrc: optional, but if present must match mise's node.
  const nvmrcPath = join(REPO_ROOT, '.nvmrc');
  if (existsSync(nvmrcPath) && miseNode) {
    const nvmrc = readFileSync(nvmrcPath, 'utf8').trim();
    if (nvmrc !== miseNode) {
      record(
        SECTION,
        'error',
        `.nvmrc says "${nvmrc}" but .mise.toml pins node = "${miseNode}".`,
        nvmrcPath
      );
    }
  }
}

function matchToml(toml: string, key: string): string | null {
  // Captures the value of `key = "<value>"` lines under `[tools]`.
  const re = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`, 'm');
  return toml.match(re)?.[1] ?? null;
}

// ──────────────────────────────────────────────────────────────────────
// 2. .env.example coverage
// ──────────────────────────────────────────────────────────────────────

const ENV_AUTO_INJECTED = new Set([
  'NODE_ENV',
  'CI',
  'PORT',
  'PWD',
  'HOME',
  'PATH',
  'TZ',
  'TMPDIR',
]);

const ENV_AUTO_INJECTED_PREFIXES = [
  'VERCEL_',
  'NEXT_RUNTIME',
  'npm_',
  'NPM_',
  'GITHUB_',
  'CLOUDFLARE_',
  'CF_',
  'TURBO_',
  'SST_',
];

function isAutoInjected(name: string): boolean {
  if (ENV_AUTO_INJECTED.has(name)) return true;
  for (const prefix of ENV_AUTO_INJECTED_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}

async function checkEnvExample() {
  const SECTION = 'env-example';

  const envExamplePath = join(REPO_ROOT, '.env.example');
  if (!existsSync(envExamplePath)) {
    record(SECTION, 'error', '.env.example is missing at repo root.', envExamplePath);
    return;
  }
  const envExample = readFileSync(envExamplePath, 'utf8');
  const declared = new Set<string>();
  for (const line of envExample.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9_]+)\s*=/);
    if (m) declared.add(m[1]);
  }

  // Walk source, extract refs.
  const referenced = new Map<string, string>(); // name → first file seen
  const refRe = /(?:process\.env|Bun\.env)\.([A-Z][A-Z0-9_]+)/g;

  const patterns = [
    new Bun.Glob('apps/**/*.{ts,tsx}'),
    new Bun.Glob('packages/**/src/**/*.ts'),
    new Bun.Glob('packages/**/src/**/*.tsx'),
  ];

  const skipRe =
    /(^|\/)(node_modules|\.next|\.next-turbo|\.next-user|\.next-sendero|\.turbo|dist|build|\.cache-user|\.ponder)(\/|$)|\.test\.tsx?$|\.spec\.tsx?$|(^|\/)scripts\//;

  for (const glob of patterns) {
    for await (const file of glob.scan({ cwd: REPO_ROOT, dot: false })) {
      if (skipRe.test(file)) continue;
      let src: string;
      try {
        src = readFileSync(join(REPO_ROOT, file), 'utf8');
      } catch {
        continue;
      }
      for (const m of src.matchAll(refRe)) {
        const name = m[1];
        if (isAutoInjected(name)) continue;
        if (!referenced.has(name)) referenced.set(name, file);
      }
    }
  }

  // Missing-from-example ⇒ error. Each reference includes the first file
  // we found it in for actionability.
  const missing = [...referenced.keys()].filter(k => !declared.has(k)).sort();
  for (const name of missing) {
    record(
      SECTION,
      'error',
      `${name} is referenced in code (first seen: ${referenced.get(name)}) but missing from .env.example. Add a documented placeholder.`,
      envExamplePath
    );
  }

  // Declared-but-unreferenced ⇒ warn. Often legitimate (third-party
  // injection like Clerk's NEXT_PUBLIC_CLERK_*) but worth flagging.
  const unused = [...declared].filter(k => !referenced.has(k) && !isAutoInjected(k)).sort();
  for (const name of unused) {
    record(
      SECTION,
      'warn',
      `${name} is in .env.example but never referenced via process.env / Bun.env. Drop it or add a comment explaining the consumer.`,
      envExamplePath
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// 3. apps/* vercel.json
// ──────────────────────────────────────────────────────────────────────

const NEXT_APPS = ['app', 'marketing', 'docs', 'help'];

async function checkVercelJsonPerApp() {
  const SECTION = 'vercel-json';

  for (const app of NEXT_APPS) {
    const vercelPath = join(REPO_ROOT, 'apps', app, 'vercel.json');
    if (!existsSync(vercelPath)) continue;

    let cfg: any;
    try {
      cfg = JSON.parse(readFileSync(vercelPath, 'utf8'));
    } catch (err) {
      record(
        SECTION,
        'error',
        `apps/${app}/vercel.json failed to parse: ${(err as Error).message}.`,
        vercelPath
      );
      continue;
    }

    if (!cfg.framework) {
      record(
        SECTION,
        'warn',
        `apps/${app}/vercel.json has no "framework" field — Vercel will autodetect, which is fragile across redeploys.`,
        vercelPath
      );
    }

    if (typeof cfg.buildCommand === 'string') {
      const pkgPath = join(REPO_ROOT, 'apps', app, 'package.json');
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
        const scripts = new Set(Object.keys(pkg.scripts ?? {}));
        // Pull every `bun run <name>` / `bunx run <name>` / `npm run <name>` token.
        const runRe = /\b(?:bun|npm|pnpm|yarn)\s+run\s+([a-z0-9:_-]+)/gi;
        for (const m of cfg.buildCommand.matchAll(runRe)) {
          const script = m[1];
          if (!scripts.has(script)) {
            record(
              SECTION,
              'warn',
              `apps/${app}/vercel.json buildCommand references "${script}" but apps/${app}/package.json has no such script.`,
              vercelPath
            );
          }
        }
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// 4. wrangler canonical
// ──────────────────────────────────────────────────────────────────────

async function checkWranglerCanonical() {
  const SECTION = 'wrangler';

  const canonical = join(REPO_ROOT, 'apps/edge/wrangler.toml');
  if (!existsSync(canonical)) {
    record(
      SECTION,
      'error',
      'apps/edge/wrangler.toml is missing — this is the canonical edge worker config.',
      canonical
    );
  }

  const rootStopgap = join(REPO_ROOT, 'wrangler.toml');
  if (existsSync(rootStopgap)) {
    record(
      SECTION,
      'error',
      'A root wrangler.toml has reappeared. Remove it — apps/edge/wrangler.toml is the only canonical wrangler config (the root stopgap was deleted in df8650e).',
      rootStopgap
    );
  }
}

// ──────────────────────────────────────────────────────────────────────
// 5. next-env.d.ts consistency
// ──────────────────────────────────────────────────────────────────────

async function checkNextEnvConsistency() {
  const SECTION = 'next-env';

  type Entry = { app: string; path: string; importLine: string | null };
  const entries: Entry[] = [];

  for (const app of NEXT_APPS) {
    const filePath = join(REPO_ROOT, 'apps', app, 'next-env.d.ts');
    if (!existsSync(filePath)) {
      record(SECTION, 'warn', `apps/${app}/next-env.d.ts is missing.`, filePath);
      continue;
    }
    const src = readFileSync(filePath, 'utf8');
    // Either `import "./..."` or `/// <reference path="./..." />`. Capture the path.
    const importMatch = src.match(/import\s+["']([^"']+)["']/);
    const refMatch = src.match(/<reference\s+path\s*=\s*["']([^"']+)["']/);
    const found = importMatch?.[1] ?? refMatch?.[1] ?? null;
    entries.push({ app, path: filePath, importLine: found });
  }

  const present = entries.filter(e => e.importLine !== null);
  if (present.length === 0) return;

  const baseline = present[0].importLine!;
  for (const entry of present.slice(1)) {
    if (entry.importLine !== baseline) {
      record(
        SECTION,
        'warn',
        `apps/${entry.app}/next-env.d.ts references "${entry.importLine}" but apps/${present[0].app}/next-env.d.ts uses "${baseline}". With NEXT_DIST_DIR=.next-turbo this drift causes type-check skew.`,
        entry.path
      );
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Reporter
// ──────────────────────────────────────────────────────────────────────

function printReport() {
  if (findings.length === 0) {
    console.log('✓ config-doctor: all configs consistent.');
    return;
  }

  // Group by section, then by severity (errors first).
  const bySection = new Map<string, Finding[]>();
  for (const f of findings) {
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    bySection.get(f.section)!.push(f);
  }

  for (const [section, items] of bySection) {
    console.log(`\n[${section}]`);
    items.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
    for (const f of items) {
      const tag = f.severity === 'error' ? '✘ ERROR' : '⚠ WARN ';
      const where = f.file ? `  → ${relative(REPO_ROOT, f.file)}` : '';
      console.log(`  ${tag}  ${f.message}${where}`);
    }
  }

  const errors = findings.filter(f => f.severity === 'error').length;
  const warns = findings.filter(f => f.severity === 'warn').length;
  console.log(`\nconfig-doctor: ${errors} error(s), ${warns} warning(s)`);
}

main().catch(err => {
  console.error('config-doctor crashed:', err);
  process.exit(2);
});
