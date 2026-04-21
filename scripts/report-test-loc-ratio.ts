import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.sol']);
const generatedPattern =
  /(^|\/)(generated|dist|build|storybook-static|coverage|node_modules|\.next|\.turbo|\.wrangler|\.ponder|\.source)\//;
const configPattern =
  /(^|\/)(package\.json|bun\.lock|turbo\.json|biome\.json|lefthook\.yml|tsconfig.*\.json|next\.config\.[mc]?js|postcss\.config\.[mc]?js|tailwind\.config\.ts|playwright\.config\.ts)$/;
const testPattern = /(^|\/)(e2e|test|tests|__tests__)\/|(\.|-)(spec|test)\.[cm]?[jt]sx?$|\.t\.sol$/;

const args = new Set(process.argv.slice(2));
const targetArg = process.argv.find(arg => arg.startsWith('--target='));
const target = targetArg ? Number(targetArg.split('=')[1]) : 0.1;
const failBelow = args.has('--fail-below');

function loc(path: string) {
  const text = readFileSync(path, 'utf8');
  return text.split(/\r?\n/).filter(line => line.trim().length > 0).length;
}

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter(file => sourceExtensions.has(extname(file)))
  .filter(file => !generatedPattern.test(file))
  .filter(file => !configPattern.test(file));

let testLoc = 0;
let sourceLoc = 0;

for (const file of files) {
  const lines = loc(file);
  if (testPattern.test(file)) {
    testLoc += lines;
  } else {
    sourceLoc += lines;
  }
}

const ratio = sourceLoc === 0 ? 0 : testLoc / sourceLoc;
const targetLoc = Math.ceil(sourceLoc * target);
const gap = Math.max(targetLoc - testLoc, 0);
const ratioText = (ratio * 100).toFixed(2);
const targetText = (target * 100).toFixed(0);

console.log(`Test LOC ratio: ${ratioText}%`);
console.log(`Source LOC:     ${sourceLoc}`);
console.log(`Test LOC:       ${testLoc}`);
console.log(`Target:         ${targetText}% (${targetLoc} test LOC)`);
console.log(`Gap:            ${gap} test LOC`);

if (gap > 0) {
  console.log(
    `Next ratchet: add smoke/e2e coverage for XL commits until the platform-week ratio is ${targetText}%+.`
  );
}

if (failBelow && ratio < target) {
  process.exit(1);
}
