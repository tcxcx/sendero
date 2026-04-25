// Sendero ship metadata check.
//
// Runs from the lefthook `commit-msg` hook. Inspects the staged diff and the
// commit message, then either warns (advisory) or blocks the commit (error).
//
// Hard errors (exit 1):
//   - XL commit without a `QA-Route:` trailer.
//   - L or XL commit without a `Change-Size:` trailer matching the bucket.
//
// Everything else stays advisory (printed but exit 0).
//
// Bypass for genuine emergencies:
//   LEFTHOOK=0 git commit ...    # skips ALL hooks
//   git commit --no-verify ...   # ditto
//
// Do NOT add a per-script env-var escape hatch — that creates pressure to use
// it routinely, which defeats the gate.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const messagePath = process.argv[2];
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

// QA-Route: required for XL. Accepts any token after `->`.
const qaRouteRequired = inferredSize === 'XL' || totalLines >= 600;
const hasQaRoute = /^QA-Route:\s*\S.*->\s*\S+/im.test(message);
if (qaRouteRequired && !hasQaRoute) {
  errors.push({
    msg: 'XL commit missing QA-Route trailer',
    fix: 'add "QA-Route: /your/route -> pass" (or fail) to the commit body',
  });
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
  console.log(`  QA-Route: <route tested> -> <pass/fail>`);
  console.log(
    `\n  Bypass for emergencies: LEFTHOOK=0 git commit ...   |   git commit --no-verify ...`
  );
}

console.log(`\ncommit-metadata: ${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
