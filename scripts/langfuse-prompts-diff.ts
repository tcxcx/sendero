/**
 * Compare the live Langfuse prompts against the committed snapshot at
 * scripts/langfuse-prompts.snapshot.json. Exits 0 when in sync, 1 on any drift.
 *
 * Use cases:
 *   - PR check: catches when somebody edits a prompt in the Langfuse UI
 *     without committing a snapshot update via `bun langfuse:prompts:pull`.
 *   - Local sanity: `bun langfuse:prompts:diff` before deploying.
 *
 *   bun scripts/langfuse-prompts-diff.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const AUTH = `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`;

interface SnapshotEntry {
  name: string;
  version: number;
  type: string;
  labels: string[];
  tags: string[];
  prompt: string;
}

interface ListedPrompt {
  name: string;
}

interface FullPrompt {
  name: string;
  version: number;
  type: string;
  labels?: string[];
  tags?: string[];
  prompt: string;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${HOST}${path}`, {
    headers: { authorization: AUTH },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function loadSnapshot(): SnapshotEntry[] {
  const path = resolve(import.meta.dir, 'langfuse-prompts.snapshot.json');
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SnapshotEntry[];
  } catch (err) {
    console.error(`Cannot read snapshot at ${path}: ${err}`);
    console.error('Run `bun scripts/langfuse-prompts-pull.ts` first.');
    process.exit(1);
  }
}

async function fetchLive(): Promise<SnapshotEntry[]> {
  const list = await fetchJson<{ data: ListedPrompt[] }>('/api/public/v2/prompts?limit=100');
  const sendero = list.data
    .filter(p => p.name.startsWith('sendero-'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const out: SnapshotEntry[] = [];
  for (const p of sendero) {
    const full = await fetchJson<FullPrompt>(
      `/api/public/v2/prompts/${encodeURIComponent(p.name)}?label=production`
    );
    out.push({
      name: full.name,
      version: full.version,
      type: full.type,
      labels: (full.labels ?? []).filter(l => l !== 'latest').sort(),
      tags: (full.tags ?? []).slice().sort(),
      prompt: full.prompt,
    });
  }
  return out;
}

function diff(snapshot: SnapshotEntry[], live: SnapshotEntry[]): string[] {
  const drifts: string[] = [];
  const snapByName = new Map(snapshot.map(e => [e.name, e]));
  const liveByName = new Map(live.map(e => [e.name, e]));

  for (const e of snapshot) {
    if (!liveByName.has(e.name)) {
      drifts.push(`✗ ${e.name} — in snapshot but missing in Langfuse`);
    }
  }
  for (const e of live) {
    if (!snapByName.has(e.name)) {
      drifts.push(`✗ ${e.name} — in Langfuse but missing from snapshot (run pull)`);
      continue;
    }
    const snap = snapByName.get(e.name)!;
    if (snap.version !== e.version) {
      drifts.push(`✗ ${e.name} — snapshot v${snap.version}, live v${e.version}`);
    }
    if (snap.prompt !== e.prompt) {
      const snapLines = snap.prompt.split('\n').length;
      const liveLines = e.prompt.split('\n').length;
      drifts.push(
        `✗ ${e.name} — content differs (snapshot ${snap.prompt.length}c/${snapLines}L, live ${e.prompt.length}c/${liveLines}L)`
      );
    }
    if (JSON.stringify(snap.labels) !== JSON.stringify(e.labels)) {
      drifts.push(
        `✗ ${e.name} — labels differ (snapshot ${snap.labels.join(',')}, live ${e.labels.join(',')})`
      );
    }
  }
  return drifts;
}

async function main(): Promise<void> {
  const [snapshot, live] = await Promise.all([Promise.resolve(loadSnapshot()), fetchLive()]);
  const drifts = diff(snapshot, live);

  if (drifts.length === 0) {
    console.log(`✓ Snapshot in sync with Langfuse (${snapshot.length} prompts)`);
    process.exit(0);
  }

  console.error('Snapshot drift detected:');
  for (const d of drifts) console.error(`  ${d}`);
  console.error('\nResolve with one of:');
  console.error('  - `bun scripts/langfuse-prompts-pull.ts`     # accept live state');
  console.error('  - `bun scripts/seed-langfuse-prompts.ts`     # re-seed from code fallbacks');
  process.exit(1);
}

await main();
