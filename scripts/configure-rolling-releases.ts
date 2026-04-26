#!/usr/bin/env bun
/**
 * Apply Rolling Releases configuration for every Vercel-deployed Sendero app.
 *
 * Source of truth: `apps/<app>/.rolling-release.json` per app.
 * Wire: shells out to `vercel rolling-release configure --cfg='<json>'` from
 * each app directory so Vercel CLI can pick up the linked project from
 * `apps/<app>/.vercel/project.json`.
 *
 * Rolling-release config is a *project-level* setting on Vercel — it is not
 * a `vercel.json` / `vercel.ts` field. This script keeps the config declarative
 * (in git) and idempotent: re-running it just overwrites Vercel's stored
 * config with whatever the JSON says. Disable with the `--disable` flag.
 *
 * Usage:
 *   bun scripts/configure-rolling-releases.ts            # apply all
 *   bun scripts/configure-rolling-releases.ts app docs   # apply selected
 *   bun scripts/configure-rolling-releases.ts --dry-run  # print only
 *   bun scripts/configure-rolling-releases.ts --disable  # disable all
 *
 * Requires: `vercel` CLI on PATH and a logged-in session that can edit each
 * project (`vercel login` or `VERCEL_TOKEN`). Each `apps/<app>` must already
 * be linked to its Vercel project (`vercel link` once per app).
 *
 * Plan-tier requirement: Rolling Releases is a Pro / Enterprise feature.
 * The Hobby tier will reject the configure call with a 403.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Stage = {
  targetPercentage: number;
  duration?: number;
};

type RollingReleaseFile = {
  $comment?: string;
  enabled: boolean;
  advancementType: 'automatic' | 'manual-approval';
  stages: Stage[];
};

const APPS = ['app', 'marketing', 'docs', 'help'] as const;
type AppName = (typeof APPS)[number];

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

function loadConfig(app: AppName): RollingReleaseFile {
  const path = resolve(REPO_ROOT, 'apps', app, '.rolling-release.json');
  if (!existsSync(path)) {
    throw new Error(`Missing rolling-release config: ${path}`);
  }
  const raw = JSON.parse(readFileSync(path, 'utf8')) as RollingReleaseFile;
  // Strip non-standard $comment before forwarding to Vercel.
  const { $comment: _comment, ...cfg } = raw;
  validate(app, cfg);
  return cfg as RollingReleaseFile;
}

function validate(app: AppName, cfg: Omit<RollingReleaseFile, '$comment'>) {
  if (cfg.advancementType !== 'automatic' && cfg.advancementType !== 'manual-approval') {
    throw new Error(`[${app}] advancementType must be "automatic" | "manual-approval"`);
  }
  if (!Array.isArray(cfg.stages) || cfg.stages.length < 2) {
    throw new Error(`[${app}] stages must be an array with at least 2 entries`);
  }
  const last = cfg.stages[cfg.stages.length - 1];
  if (last.targetPercentage !== 100) {
    throw new Error(`[${app}] final stage must be 100%, got ${last.targetPercentage}`);
  }
  let prev = 0;
  for (const stage of cfg.stages) {
    if (stage.targetPercentage <= prev) {
      throw new Error(
        `[${app}] stages must be strictly increasing (got ${prev} → ${stage.targetPercentage})`
      );
    }
    if (stage.targetPercentage < 1 || stage.targetPercentage > 100) {
      throw new Error(`[${app}] targetPercentage must be 1-100, got ${stage.targetPercentage}`);
    }
    if (
      cfg.advancementType === 'automatic' &&
      stage.targetPercentage !== 100 &&
      stage.duration === undefined
    ) {
      throw new Error(`[${app}] automatic stages below 100% require a duration (minutes)`);
    }
    prev = stage.targetPercentage;
  }
}

function runVercel(app: AppName, args: string[], dryRun: boolean): number {
  const cwd = resolve(REPO_ROOT, 'apps', app);
  const cmd = ['vercel', ...args];
  console.log(`\n→ [${app}] ${cmd.join(' ')}`);
  if (dryRun) return 0;
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(`✗ [${app}] vercel exited with code ${result.status}`);
  } else {
    console.log(`✓ [${app}] applied`);
  }
  return result.status ?? 1;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const disable = argv.includes('--disable');
  const selected = argv.filter(a => !a.startsWith('--')) as AppName[];
  const targets: readonly AppName[] = selected.length > 0 ? selected : APPS;

  for (const app of targets) {
    if (!APPS.includes(app)) {
      console.error(`Unknown app: ${app}. Valid: ${APPS.join(', ')}`);
      process.exitCode = 1;
      return;
    }
  }

  let failures = 0;
  for (const app of targets) {
    if (disable) {
      const code = runVercel(app, ['rolling-release', 'configure', '--disable'], dryRun);
      if (code !== 0) failures += 1;
      continue;
    }
    const cfg = loadConfig(app);
    const code = runVercel(
      app,
      ['rolling-release', 'configure', `--cfg=${JSON.stringify(cfg)}`],
      dryRun
    );
    if (code !== 0) failures += 1;
  }

  if (failures > 0) {
    console.error(`\n✗ ${failures} app(s) failed to configure rolling releases.`);
    process.exit(1);
  }
  console.log(`\n✓ Done — ${targets.length} app(s) processed.`);
}

main();
