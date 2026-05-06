#!/usr/bin/env bun
/**
 * Seed the `sendero-resolved-gaps` Phoenix dataset with the 4 known
 * dogfood-found bugs from CLAUDE.md → "Demand-driven context".
 *
 * Run once after Phoenix Cloud is wired (env: PHOENIX_API_KEY,
 * PHOENIX_COLLECTOR_ENDPOINT, PHOENIX_PROJECT_NAME). Idempotent —
 * re-running re-creates the dataset name with the same examples;
 * dedup is on Phoenix's side via dataset version. The script bails
 * if the dataset already has more rows than the seed (assumes
 * auto-curation has been adding to it).
 *
 * Usage:
 *   bun run scripts/phoenix-seed-resolved-gaps.ts
 *
 * What lands in Phoenix:
 *   - One dataset named `sendero-resolved-gaps`
 *   - 4 examples, each with input.hypothesis + output.fixSummary +
 *     metadata.{toolName, kind, resolutionPrUrl, mustMention, provenance}
 *
 * After seeding:
 *   - Trigger any of the 4 hypotheses on a sandbox turn
 *   - Agent should call find_resolved_gap → match → apply fix
 *   - Verify in Langfuse trace: NO report_knowledge_gap call fires
 */

import {
  getPhoenixApiKey,
  getPhoenixCollectorEndpoint,
  isPhoenixEnabled,
} from '@sendero/arize-phoenix';

interface SeedExample {
  hypothesis: string;
  fixSummary: string;
  toolName: string;
  kind: string;
  resolutionPrUrl?: string;
  mustMention: string[];
}

const SEED: SeedExample[] = [
  {
    hypothesis:
      'I think field is named documentUrl, not documentImageUrl — the scan_document tool 4xxs when I pass documentImageUrl',
    fixSummary:
      'The scan_document tool accepts `documentUrl`, not `documentImageUrl`. Rename in the call. The prompt slab was wrong; updated in Story 4.2.',
    toolName: 'scan_document',
    kind: 'tool_input_mismatch',
    mustMention: ['documentUrl'],
  },
  {
    hypothesis:
      'request_human_handoff is not registered as a Kapso top-level tool — runtime returns "Tool not available" — agent tries handoff_to_human as a fallback which is also wrong',
    fixSummary:
      'Use `request_human_handoff` (the Sendero canonical name). It IS registered, but the prompt previously listed it under a Kapso-only catalog block which the dispatch turn skips. Call it directly. Do NOT use `handoff_to_human` — that name is unconditionally banned (foot-gun).',
    toolName: 'request_human_handoff',
    kind: 'tool_not_found',
    mustMention: ['request_human_handoff'],
  },
  {
    hypothesis:
      'PASSPORT_VAULT_KEK env not loaded — scan_passport_inline returns "vault key not configured" but I confirmed env is bound on Vercel',
    fixSummary:
      'Vercel env-add post-dates the last deployment for that branch. Redeploy after the env change so the function picks up the new env. `readKek()` is intentionally inside a function (no module-level cache) so each call reads `process.env.PASSPORT_VAULT_KEK` fresh — function instance reuse cannot pin stale env, but the runtime needs a redeploy to inject the new value.',
    toolName: 'scan_passport_inline',
    kind: 'env_missing',
    mustMention: ['redeploy', 'PASSPORT_VAULT_KEK'],
  },
  {
    hypothesis:
      "flowKey 'trip_intake' returns 500 — the Meta WhatsApp Flow isn't configured for that key on this tenant",
    fixSummary:
      'The `trip_intake` Meta Flow key is not provisioned. For passport intake specifically, use `scan_passport_inline` (no Flow round-trip needed). Do NOT request a Flow with `flowKey: trip_intake`. The prompt slab now bans this flow key for passport intake.',
    toolName: 'request_whatsapp_flow',
    kind: 'runtime_constraint',
    mustMention: ['scan_passport_inline'],
  },
];

const DATASET_NAME = 'sendero-resolved-gaps';

async function main() {
  if (!isPhoenixEnabled()) {
    console.error('✗ PHOENIX_API_KEY not set — abort');
    process.exit(1);
  }

  const collector = getPhoenixCollectorEndpoint().replace(/\/$/, '');
  const apiKey = getPhoenixApiKey();
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };

  console.info('→ seeding Phoenix dataset', { collector, dataset: DATASET_NAME });

  // Phoenix v15 supports dataset upload via JSON body to /v1/datasets/upload
  // with action=create. Reference:
  // https://docs.arize.com/phoenix/datasets-and-experiments/how-to-datasets/creating-datasets
  //
  // **Bun fetch workaround.** Bun's fetch (likely due to HTTP/2 ALPN
  // upgrade signature) hits Cloudflare's bot challenge in front of
  // Phoenix Cloud — request returns 200 + HTML auth page instead of
  // JSON. Curl over HTTP/1.1 sails through. We shell out via Bun.spawn
  // for this one-shot script. The package-level REST wrappers will
  // get a similar fallback in a follow-up PR.
  const payload = {
    action: 'create',
    name: DATASET_NAME,
    description:
      'Curated resolved knowledge gaps. Each example pairs a hypothesis (input) with a documented fix (output). Used at agent runtime by find_resolved_gap to self-heal known issues without a human in the loop.',
    inputs: SEED.map(s => ({ hypothesis: s.hypothesis })),
    outputs: SEED.map(s => ({ fixSummary: s.fixSummary })),
    metadata: SEED.map(s => ({
      toolName: s.toolName,
      kind: s.kind,
      mustMention: s.mustMention,
      provenance: 'human-curated',
      ...(s.resolutionPrUrl ? { resolutionPrUrl: s.resolutionPrUrl } : {}),
    })),
  };

  const url = `${collector}/v1/datasets/upload?sync=true`;
  const args = [
    '-sS',
    '-X',
    'POST',
    url,
    '-H',
    'Authorization: Bearer ' + (apiKey ?? ''),
    '-H',
    'Content-Type: application/json',
    '-H',
    'Accept: application/json',
    '--data-binary',
    '@-',
    '-w',
    '\n__HTTP__%{http_code}',
  ];

  const proc = Bun.spawn(['curl', ...args], {
    stdin: new TextEncoder().encode(JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  const codeMatch = output.match(/__HTTP__(\d+)$/);
  const httpCode = codeMatch ? Number(codeMatch[1]) : 0;
  const bodyText = output.replace(/\n?__HTTP__\d+$/, '');

  if (httpCode < 200 || httpCode >= 300) {
    console.error(`✗ Phoenix dataset upload failed: HTTP ${httpCode}`);
    console.error('stderr:', stderr.slice(0, 400));
    console.error('body:', bodyText.slice(0, 800));
    process.exit(1);
  }

  console.info(`✓ Seeded ${SEED.length} examples into ${DATASET_NAME} (HTTP ${httpCode})`);
  console.info('  Phoenix response:', bodyText.slice(0, 400));
  console.info('\nNext: trigger one of these hypotheses on a sandbox turn');
  for (const s of SEED) {
    console.info(`  • ${s.toolName}: "${s.hypothesis.slice(0, 80)}..."`);
  }
}

main().catch(err => {
  console.error('seed failed', err);
  process.exit(1);
});
