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

if (!/^Change-Size:\s*(S|M|L|XL)\b/im.test(message)) {
  warnings.push(`add Change-Size: ${inferredSize}`);
}

if (!/^PR-ID:\s*(#?\d+|pending|n\/a)\b/im.test(message)) {
  warnings.push('add PR-ID: pending, n/a, or #123');
}

if ((inferredSize === 'XL' || totalLines >= 600) && !/^QA-Route:\s*.+/im.test(message)) {
  warnings.push('XL commit should include QA-Route: /route -> pass/fail');
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

if (warnings.length > 0) {
  console.log('\n! Sendero ship metadata advisory');
  console.log(
    `  Staged size: ${inferredSize} (${totalLines} changed lines, ${files.length} files)`
  );
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
  console.log('\n  Suggested commit body trailers:');
  console.log(`  PR-ID: pending`);
  console.log(`  Change-Size: ${inferredSize}`);
  console.log(`  Test: <focused check or smoke/e2e spec>`);
  console.log(`  QA-Route: <route tested> -> <pass/fail>`);
}
