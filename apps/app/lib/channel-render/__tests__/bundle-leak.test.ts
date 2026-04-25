/**
 * Bundle-leak guard for the `@/lib/channel-render` barrel.
 *
 * We hit this exact bug at runtime ("Cannot find module 'node:fs'")
 * on /dashboard/agent-chat first load: a barrel re-export pulled the
 * per-channel slack renderer into the client bundle, and slack
 * transitively imports `@slack/web-api` which requires node:fs.
 *
 * Approach (deterministic, no environment shenanigans): walk the
 * import graph statically from `lib/channel-render/index.ts`. Follow
 * every relative import. If any reachable module imports a forbidden
 * specifier (`node:fs`, `@slack/*`, `@sendero/slack`, `@sendero/whatsapp`),
 * fail with the offending path chain so the regression is obvious.
 *
 * This catches the foot-gun cheaply and works in any test runtime.
 * Approach B (vitest happy-dom dynamic import) was rejected because
 * the repo standardizes on `bun:test`, which does not ship a
 * browser-like environment.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const BARREL = resolve(__dirname, '../index.ts');
const ROOT = resolve(__dirname, '../../..');

const FORBIDDEN_SPECIFIERS = [
  'node:fs',
  'node:fs/promises',
  'fs',
  'fs/promises',
  '@slack/web-api',
  '@slack/types',
  '@sendero/slack',
  '@sendero/whatsapp',
];

const FORBIDDEN_PREFIXES = ['@slack/', '@sendero/slack', '@sendero/whatsapp'];

// Files we know intentionally drag node-only modules. The static
// traversal should never reach these from the barrel; if it does, the
// barrel has regressed.
const SERVER_ONLY_GUARDS = [
  resolve(__dirname, '../channels/slack.ts'),
  resolve(__dirname, '../channels/whatsapp.ts'),
];

interface Reach {
  path: string;
  via: string[];
}

function readImports(filePath: string): string[] {
  const src = readFileSync(filePath, 'utf8');
  // Strip block + line comments so commented-out imports do not count.
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const specs = new Set<string>();
  // `import … from 'x'`, `import 'x'`, `export … from 'x'`, dynamic import('x')
  const patterns = [
    /\bimport\s+(?:[^'"`;]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:[^'"`;]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m = re.exec(stripped);
    while (m !== null) {
      specs.add(m[1]);
      m = re.exec(stripped);
    }
  }
  return [...specs];
}

const TS_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

function resolveLocalImport(spec: string, fromFile: string): string | null {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null;
  const baseDir = dirname(fromFile);
  const target = resolve(baseDir, spec);

  // Bare hit (already has extension)
  if (existsSync(target) && statSync(target).isFile()) return target;

  // Try with each TS/JS extension
  for (const ext of TS_EXTS) {
    const withExt = `${target}${ext}`;
    if (existsSync(withExt) && statSync(withExt).isFile()) return withExt;
  }

  // Try as directory with index.{ext}
  if (existsSync(target) && statSync(target).isDirectory()) {
    for (const ext of TS_EXTS) {
      const idx = resolve(target, `index${ext}`);
      if (existsSync(idx) && statSync(idx).isFile()) return idx;
    }
  }

  return null;
}

interface ScanResult {
  visited: Set<string>;
  /** spec -> chain of files that introduced it, root first. */
  forbiddenHits: Array<{ spec: string; via: string[] }>;
}

function scan(entry: string): ScanResult {
  const visited = new Set<string>();
  const forbiddenHits: Array<{ spec: string; via: string[] }> = [];
  const queue: Reach[] = [{ path: entry, via: [entry] }];

  while (queue.length > 0) {
    const { path, via } = queue.shift() as Reach;
    if (visited.has(path)) continue;
    visited.add(path);

    let imports: string[];
    try {
      imports = readImports(path);
    } catch {
      // Unreadable file — record nothing, skip. The traversal is best
      // effort; we only need to guarantee the barrel itself does not
      // surface a forbidden specifier.
      continue;
    }

    for (const spec of imports) {
      const isForbidden =
        FORBIDDEN_SPECIFIERS.includes(spec) ||
        FORBIDDEN_PREFIXES.some(p => spec === p || spec.startsWith(`${p}/`));

      if (isForbidden) {
        forbiddenHits.push({ spec, via: [...via, `(imports) ${spec}`] });
        continue;
      }

      const localTarget = resolveLocalImport(spec, path);
      if (localTarget?.startsWith(ROOT)) {
        queue.push({ path: localTarget, via: [...via, localTarget] });
      }
      // Non-local, non-forbidden specifiers (other workspace pkgs,
      // npm deps) are out of scope for this static check. Adding full
      // package.json + node_modules resolution would balloon the test
      // for marginal benefit — the grep in the second case catches
      // direct imports of forbidden npm packages from local code.
    }
  }

  return { visited, forbiddenHits };
}

describe('channel-render barrel: bundle-leak guard', () => {
  test('barrel does not import any per-channel server module by file path', () => {
    const src = readFileSync(BARREL, 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/channels\/(slack|whatsapp|web)['"]/);
    expect(src).not.toMatch(
      /export\s+\{[^}]+\}\s+from\s+['"]\.\/channels\/(slack|whatsapp|web)['"]/
    );
    expect(src).not.toMatch(/import\s*\(\s*['"]\.\/channels\/(slack|whatsapp|web)['"]\s*\)/);
  });

  test('barrel does not import any node-only or slack/whatsapp package directly', () => {
    const src = readFileSync(BARREL, 'utf8');
    for (const spec of FORBIDDEN_SPECIFIERS) {
      expect(src).not.toContain(`from '${spec}'`);
      expect(src).not.toContain(`from "${spec}"`);
    }
  });

  test('static import-graph traversal from barrel never reaches a forbidden specifier', () => {
    const result = scan(BARREL);
    if (result.forbiddenHits.length > 0) {
      const lines = result.forbiddenHits.map(h => `  - ${h.spec}\n    via: ${h.via.join(' -> ')}`);
      throw new Error(
        `Bundle leak: the channel-render barrel transitively imports a server-only specifier.\n${lines.join('\n')}`
      );
    }
    expect(result.forbiddenHits).toEqual([]);
  });

  test('static traversal never enters per-channel server modules', () => {
    const result = scan(BARREL);
    for (const guarded of SERVER_ONLY_GUARDS) {
      expect(result.visited.has(guarded)).toBe(false);
    }
  });

  test('per-channel server modules DO import forbidden specifiers (negative control)', () => {
    // Sanity check that the test harness is meaningful: scanning the
    // slack channel renderer must surface a forbidden hit, otherwise
    // the regex / FORBIDDEN list has drifted and the guard above could
    // silently pass without protecting anything.
    const result = scan(SERVER_ONLY_GUARDS[0]);
    expect(result.forbiddenHits.length).toBeGreaterThan(0);
  });
});
