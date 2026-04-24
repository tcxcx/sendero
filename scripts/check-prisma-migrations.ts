#!/usr/bin/env bun
/**
 * Static lint for Prisma migrations staged in this commit.
 *
 * Catches the one-shot landmines we actually hit in review:
 *
 *  1. `ALTER TYPE "Foo" ADD VALUE 'x'` combined with a reference to
 *     `'x'` in the same `.sql` file. That combo breaks on Postgres
 *     <12 and on any tx-wrapped migration because the new enum value
 *     isn't committed yet when the subsequent statement tries to use
 *     it. Safe pattern: split into two migrations — one ADD VALUE,
 *     one that uses the value.
 *
 *  2. `CREATE INDEX` without `CONCURRENTLY` on a non-empty table path
 *     (we can't know empty-vs-not statically; advisory warning only).
 *
 *  3. `ALTER TABLE ... ADD COLUMN ... NOT NULL` with no DEFAULT on an
 *     existing table (locks the table while the backfill runs).
 *     Advisory.
 *
 * Check (1) blocks the commit. (2) and (3) warn. Override with
 * `SKIP_MIGRATION_CHECK=1 git commit`.
 *
 * Invoked from lefthook `pre-commit`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.SKIP_MIGRATION_CHECK === '1') process.exit(0);

const MIGRATION_PATH_RE = /(^|\/)prisma\/migrations\/[^/]+\/migration\.sql$/;

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=AM'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter(f => f && MIGRATION_PATH_RE.test(f));

if (staged.length === 0) process.exit(0);

let blocking = 0;
let advisories = 0;

for (const file of staged) {
  let sql: string;
  try {
    sql = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  // Strip -- line comments so they don't get flagged or mask real
  // statements. Preserve newlines so line numbers stay useful.
  const stripped = sql.replace(/--[^\n]*/g, '');

  // --- Block (1): ALTER TYPE ADD VALUE with same-file reference ---
  const addValueRe = /ALTER\s+TYPE\s+"?(\w+)"?\s+ADD\s+VALUE\s+'([^']+)'/gi;
  for (const m of stripped.matchAll(addValueRe)) {
    const newValue = m[2];
    // Mask the ADD VALUE line itself before searching for same-file
    // references to the new value. Any other single-quoted occurrence
    // is a data-modification or CHECK constraint that will break on
    // `prisma migrate deploy`.
    const withoutAddLine = stripped.replace(m[0], '');
    const usageRe = new RegExp(`'${newValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 'g');
    if (usageRe.test(withoutAddLine)) {
      console.error(
        `[check-prisma-migrations] ${file}: ALTER TYPE ADD VALUE '${newValue}' is referenced elsewhere in the same migration.`
      );
      console.error(
        '  This fails on Postgres <12 and on any tx-wrapped migration. Split into two migrations:'
      );
      console.error('    1) ADD VALUE only');
      console.error(`    2) Reference '${newValue}' in a subsequent migration`);
      blocking += 1;
    }
  }

  // --- Advisory (2): CREATE INDEX without CONCURRENTLY ---
  const createIndexRe = /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!CONCURRENTLY\b)/gi;
  if (createIndexRe.test(stripped)) {
    console.warn(`[check-prisma-migrations] ${file}: CREATE INDEX without CONCURRENTLY.`);
    console.warn(
      '  On a large table this blocks writes. If the table is small (or empty), ignore.'
    );
    advisories += 1;
  }

  // --- Advisory (3): ADD COLUMN NOT NULL without DEFAULT ---
  const addColRe = /ALTER\s+TABLE\s+[^;]+?ADD\s+COLUMN\s+[^;]*?NOT\s+NULL(?![^;]*?DEFAULT)/gi;
  if (addColRe.test(stripped)) {
    console.warn(`[check-prisma-migrations] ${file}: ADD COLUMN NOT NULL without DEFAULT.`);
    console.warn(
      '  Writes to the table block while the backfill runs. Add a DEFAULT, or split into 3 migrations (nullable → backfill → NOT NULL).'
    );
    advisories += 1;
  }
}

if (blocking > 0) {
  console.error(
    `[check-prisma-migrations] ${blocking} blocking issue${blocking === 1 ? '' : 's'}. Fix or bypass with SKIP_MIGRATION_CHECK=1.`
  );
  process.exit(1);
}

if (advisories > 0) {
  console.warn(
    `[check-prisma-migrations] ${advisories} advisory${advisories === 1 ? '' : 's'} — commit proceeds.`
  );
}
