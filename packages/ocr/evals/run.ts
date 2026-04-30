#!/usr/bin/env bun
/**
 * @sendero/ocr golden-set runner.
 *
 * Walks `evals/golden/{kind}/*.yml`, extracts the paired document via
 * `extractDocument()`, and scores field-level precision against the
 * ground truth. Prints a per-kind table + median/p95 latency +
 * per-doc miss list, and appends a JSONL record to `evals/results.jsonl`
 * so we can track accuracy over time.
 *
 * Ground-truth format is documented in `evals/README.md`.
 *
 * Usage:
 *   bun run eval                          # everything
 *   bun run eval receipts                 # one kind
 *   bun run eval receipts/coffee-shop     # one fixture
 */

import { readdir, readFile, appendFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { extractDocument, type DocumentKind } from '../src/extract';

const EVAL_ROOT = resolve(import.meta.dir, 'golden');
const RESULTS_PATH = resolve(import.meta.dir, 'results.jsonl');

const KIND_DIRS: Record<DocumentKind, string> = {
  invoice: 'invoices',
  receipt: 'receipts',
  boarding_pass: 'boarding-passes',
  id_document: 'id-documents',
};

const MIME_FROM_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
};

interface GoldenFile {
  kind: DocumentKind;
  slug: string;
  path: string;
  expected: Record<string, unknown>;
  fuzzy: Set<string>;
  description: string;
}

interface FixtureResult {
  kind: DocumentKind;
  slug: string;
  hits: number;
  total: number;
  missed: string[];
  fuzzyHits: number;
  latencyMs: number;
  provider: string;
  model: string;
  error?: string;
}

async function main() {
  const filter = process.argv[2] ?? null;
  const fixtures = await loadFixtures(filter);
  if (fixtures.length === 0) {
    console.error(
      `No fixtures found${filter ? ` matching "${filter}"` : ''}. Drop a {slug}.yml + {slug}.{pdf|png|jpg} into evals/golden/{kind}/.`
    );
    process.exit(2);
  }

  const results: FixtureResult[] = [];
  for (const fx of fixtures) {
    results.push(await runOne(fx));
  }

  printReport(results);
  await appendFile(
    RESULTS_PATH,
    JSON.stringify({
      ts: new Date().toISOString(),
      fixtureCount: fixtures.length,
      results: results.map(r => ({
        kind: r.kind,
        slug: r.slug,
        score: r.total === 0 ? null : r.hits / r.total,
        latencyMs: r.latencyMs,
        model: r.model,
      })),
    }) + '\n',
    'utf8'
  );
}

async function loadFixtures(filter: string | null): Promise<GoldenFile[]> {
  const kinds = Object.entries(KIND_DIRS).filter(
    ([k]) => !filter || filter === k || filter.startsWith(`${k}/`)
  );
  const out: GoldenFile[] = [];
  for (const [kind, dir] of kinds) {
    const kindDir = join(EVAL_ROOT, dir);
    const entries = await readdir(kindDir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
      const slug = basename(entry, extname(entry));
      if (filter && filter.includes('/') && !filter.endsWith(`/${slug}`)) continue;
      if (slug.toUpperCase() === 'EXAMPLE') continue;
      const ymlPath = join(kindDir, entry);
      const yml = await readFile(ymlPath, 'utf8');
      const parsed = parseSimpleYaml(yml);
      const docPath = await findDocumentFor(kindDir, slug);
      if (!docPath) {
        console.warn(`[evals] skip ${kind}/${slug}: no paired document found`);
        continue;
      }
      out.push({
        kind: kind as DocumentKind,
        slug,
        path: docPath,
        expected: (parsed.expected ?? {}) as Record<string, unknown>,
        fuzzy: new Set((parsed.fuzzy ?? []) as string[]),
        description: String(parsed.description ?? ''),
      });
    }
  }
  return out;
}

async function findDocumentFor(kindDir: string, slug: string): Promise<string | null> {
  const entries = await readdir(kindDir).catch(() => [] as string[]);
  for (const entry of entries) {
    const name = basename(entry, extname(entry));
    const ext = extname(entry).toLowerCase();
    if (name === slug && ext in MIME_FROM_EXT) return join(kindDir, entry);
  }
  return null;
}

async function runOne(fx: GoldenFile): Promise<FixtureResult> {
  const buf = await readFile(fx.path);
  const mediaType = MIME_FROM_EXT[extname(fx.path).toLowerCase()] ?? 'application/octet-stream';
  const data = buf.toString('base64');

  const t0 = Date.now();
  try {
    const result = await extractDocument({ kind: fx.kind, data, mediaType });
    const latencyMs = Date.now() - t0;
    return scoreExtraction(fx, result.data as Record<string, unknown>, result, latencyMs);
  } catch (err) {
    const latencyMs = Date.now() - t0;
    return {
      kind: fx.kind,
      slug: fx.slug,
      hits: 0,
      total: Object.keys(fx.expected).length,
      missed: Object.keys(fx.expected),
      fuzzyHits: 0,
      latencyMs,
      provider: 'error',
      model: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function scoreExtraction(
  fx: GoldenFile,
  actual: Record<string, unknown>,
  meta: { provider: string; model: string },
  latencyMs: number
): FixtureResult {
  const expectedKeys = Object.keys(fx.expected);
  const missed: string[] = [];
  let hits = 0;
  let fuzzyHits = 0;

  for (const key of expectedKeys) {
    const expected = fx.expected[key];
    const got = actual[key];
    const matched = matchField(expected, got, fx.fuzzy.has(key));
    if (matched === 'exact') hits += 1;
    else if (matched === 'fuzzy') {
      hits += 1;
      fuzzyHits += 1;
    } else {
      missed.push(key);
    }
  }

  return {
    kind: fx.kind,
    slug: fx.slug,
    hits,
    total: expectedKeys.length,
    missed,
    fuzzyHits,
    latencyMs,
    provider: meta.provider,
    model: meta.model,
  };
}

function matchField(
  expected: unknown,
  got: unknown,
  allowFuzzy: boolean
): 'exact' | 'fuzzy' | 'miss' {
  if (expected === null || expected === undefined) {
    return got === null || got === undefined ? 'exact' : 'miss';
  }
  if (got === null || got === undefined) return 'miss';
  if (typeof expected === 'number') {
    if (typeof got !== 'number') return 'miss';
    return Math.abs(expected - got) < 0.01 ? 'exact' : 'miss';
  }
  if (typeof expected === 'string') {
    if (typeof got !== 'string') return 'miss';
    if (expected.trim().toLowerCase() === got.trim().toLowerCase()) return 'exact';
    if (!allowFuzzy) return 'miss';
    return fuzzyMatch(expected, got) ? 'fuzzy' : 'miss';
  }
  return expected === got ? 'exact' : 'miss';
}

function fuzzyMatch(a: string, b: string): boolean {
  const aa = a.trim().toLowerCase();
  const bb = b.trim().toLowerCase();
  const threshold = Math.max(2, Math.ceil(Math.max(aa.length, bb.length) / 4));
  return levenshtein(aa, bb) <= threshold;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const next = Math.min(cur + 1, prev[j] + 1, prev[j - 1] + cost);
      prev[j - 1] = cur;
      cur = next;
    }
    prev[b.length] = cur;
  }
  return prev[b.length];
}

function printReport(results: FixtureResult[]): void {
  const byKind = new Map<DocumentKind, FixtureResult[]>();
  for (const r of results) {
    const arr = byKind.get(r.kind) ?? [];
    arr.push(r);
    byKind.set(r.kind, arr);
  }

  for (const [kind, rows] of byKind) {
    const total = rows.reduce((a, r) => a + r.total, 0);
    const hits = rows.reduce((a, r) => a + r.hits, 0);
    const fuzzy = rows.reduce((a, r) => a + r.fuzzyHits, 0);
    const latencies = rows.map(r => r.latencyMs).sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length / 2)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? p50;
    const pct = total === 0 ? 0 : (100 * hits) / total;
    console.log(`\n${kind.toUpperCase()} (${rows.length} doc${rows.length === 1 ? '' : 's'})`);
    console.log(
      `  field score       ${hits}/${total}  ${pct.toFixed(1)}%   ` +
        (fuzzy > 0 ? `(${fuzzy} fuzzy)` : '')
    );
    console.log(`  p50 latency       ${p50} ms`);
    console.log(`  p95 latency       ${p95} ms`);
    for (const r of rows) {
      if (r.error) console.log(`  [ERROR] ${r.slug}: ${r.error}`);
      else if (r.missed.length > 0) console.log(`  [miss] ${r.slug}: ${r.missed.join(', ')}`);
    }
  }
}

function parseSimpleYaml(src: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = src.split(/\r?\n/);
  let currentBlock: string | null = null;
  let block: Record<string, unknown> = {};
  const list: string[] = [];

  const flushBlock = () => {
    if (currentBlock === 'expected') out.expected = { ...block };
    else if (currentBlock === 'fuzzy') out.fuzzy = [...list];
    block = {};
    list.length = 0;
  };

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line) continue;
    if (/^(expected|fuzzy):\s*$/.test(line)) {
      flushBlock();
      currentBlock = line.replace(':', '').trim();
      continue;
    }
    if (currentBlock && /^\s+- /.test(line)) {
      list.push(line.trim().slice(2).trim());
      continue;
    }
    if (currentBlock && /^\s+\S+: /.test(line)) {
      const [k, ...rest] = line.trim().split(':');
      block[k] = parseScalar(rest.join(':').trim());
      continue;
    }
    if (/^\S+: /.test(line)) {
      flushBlock();
      currentBlock = null;
      const [k, ...rest] = line.split(':');
      out[k.trim()] = parseScalar(rest.join(':').trim());
    }
  }
  flushBlock();
  return out;
}

function parseScalar(raw: string): unknown {
  if (raw === 'null' || raw === '~' || raw === '') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
