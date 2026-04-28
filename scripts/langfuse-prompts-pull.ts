/**
 * Pull every Sendero-managed Langfuse prompt at the `production` label and
 * write a stable JSON snapshot to scripts/langfuse-prompts.snapshot.json.
 *
 * The snapshot is committed to git so PRs that touch live prompts also commit
 * the diff — pairs with langfuse-prompts-diff.ts which fails CI when the live
 * project drifts from the committed snapshot.
 *
 *   bun scripts/langfuse-prompts-pull.ts                # writes snapshot
 *   bun scripts/langfuse-prompts-pull.ts --print        # writes + prints to stdout
 *
 * Requires: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_BASE_URL.
 */

import { writeFileSync } from 'node:fs';
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
  versions: number[];
  labels: string[];
  type: string;
  tags?: string[];
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

async function main(): Promise<void> {
  // List all prompts; we filter to sendero-* in code so this script
  // doesn't pull unrelated experiments out of the same Langfuse project.
  const list = await fetchJson<{ data: ListedPrompt[] }>('/api/public/v2/prompts?limit=100');

  const senderoPrompts = list.data
    .filter(p => p.name.startsWith('sendero-'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const snapshot: SnapshotEntry[] = [];
  for (const p of senderoPrompts) {
    // Always pull the `production` label — the running app reads
    // production at runtime, so that's the source of truth we diff
    // against. `latest` is too noisy for a committed snapshot.
    const full = await fetchJson<FullPrompt>(
      `/api/public/v2/prompts/${encodeURIComponent(p.name)}?label=production`
    );
    snapshot.push({
      name: full.name,
      version: full.version,
      type: full.type,
      labels: (full.labels ?? []).filter(l => l !== 'latest').sort(),
      tags: (full.tags ?? []).slice().sort(),
      prompt: full.prompt,
    });
  }

  const json = JSON.stringify(snapshot, null, 2) + '\n';
  const outPath = resolve(import.meta.dir, 'langfuse-prompts.snapshot.json');
  writeFileSync(outPath, json);

  console.log(`Wrote ${snapshot.length} prompts to ${outPath}`);
  for (const e of snapshot) {
    console.log(`  ${e.name} v${e.version} (${e.prompt.length} chars)`);
  }

  if (process.argv.includes('--print')) {
    console.log('\n--- snapshot ---');
    console.log(json);
  }
}

await main();
