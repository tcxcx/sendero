/**
 * Run the `sendero-golden-turns` dataset against the LIVE production prompts.
 *
 * For each item:
 *   1. Pull the production-labeled `sendero-soul` + `sendero-chat-routing-rules`
 *      from Langfuse (with hardcoded fallbacks via @sendero/langfuse).
 *   2. Compose the system prompt (no tools — this is a prompt-quality smoke,
 *      not a full-stack integration test).
 *   3. Call generateText with experimental_telemetry so Langfuse captures the
 *      generation as a trace linked to the dataset item.
 *   4. Run the four LLM-as-judge evaluators against the response.
 *   5. Apply rule-based scores (mustMention / mustNotMention / locale match)
 *      so failures show up next to the LLM-judge scores in the Langfuse UI.
 *
 * Usage:
 *   bun scripts/langfuse-run-regression.ts                    # all items
 *   bun scripts/langfuse-run-regression.ts --scenario refund  # filter
 *   bun scripts/langfuse-run-regression.ts --run-name nightly-2026-04-28
 *
 * Prereqs: LANGFUSE_*, OPENAI_API_KEY (evaluators use gpt-4.1-nano).
 */

import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';

import {
  aiTelemetryConfig,
  evaluateTrace,
  flushLangfuse,
  getActiveTraceId,
  getPromptWithFallback,
  initLangfuseOtel,
  scoreTrace,
  traceAgent,
} from '@sendero/langfuse';
import { SENDERO_SOUL } from '@sendero/agent';

// Boot OTel before any traceAgent / aiTelemetryConfig call — otherwise the
// LangfuseSpanProcessor isn't registered and getActiveTraceId() returns
// undefined, scores land on the synthetic UUID fallback, and the dataset
// link points at a non-existent trace.
initLangfuseOtel();

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in env (regression LLM + evaluators need it).');
  process.exit(1);
}

const AUTH = `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`;
const DATASET_NAME = 'sendero-golden-turns';
const RUN_NAME = parseArg('--run-name') ?? `regression-${new Date().toISOString().slice(0, 19)}`;
const SCENARIO_FILTER = parseArg('--scenario');

interface DatasetItem {
  id: string;
  input: { text: string; locale: string; channel: string };
  expectedOutput: { mustMention: string[]; mustNotMention?: string[]; expectedToolCall?: string };
  metadata?: { scenario?: string; intent?: string };
}

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

async function fetchItems(): Promise<DatasetItem[]> {
  const res = await fetch(
    `${HOST}/api/public/dataset-items?datasetName=${encodeURIComponent(DATASET_NAME)}&limit=100`,
    { headers: { authorization: AUTH } }
  );
  if (!res.ok) throw new Error(`Fetch items failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: DatasetItem[] };
  return json.data;
}

async function attachRunToItem(args: { itemId: string; traceId: string }): Promise<void> {
  const res = await fetch(`${HOST}/api/public/dataset-run-items`, {
    method: 'POST',
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({
      runName: RUN_NAME,
      datasetItemId: args.itemId,
      traceId: args.traceId,
    }),
  });
  if (!res.ok) {
    console.warn(`  ! attach-run failed (${res.status}): ${await res.text()}`);
  }
}

function checkRules(
  output: string,
  expected: DatasetItem['expectedOutput']
): { passes: number; total: number; failures: string[] } {
  const lower = output.toLowerCase();
  const failures: string[] = [];
  let passes = 0;
  let total = 0;

  for (const phrase of expected.mustMention) {
    total += 1;
    if (lower.includes(phrase.toLowerCase())) passes += 1;
    else failures.push(`mustMention "${phrase}"`);
  }

  for (const phrase of expected.mustNotMention ?? []) {
    total += 1;
    if (!lower.includes(phrase.toLowerCase())) passes += 1;
    else failures.push(`mustNotMention "${phrase}" (present)`);
  }

  return { passes, total, failures };
}

async function runItem(item: DatasetItem, idx: number, count: number): Promise<void> {
  const scenario = item.metadata?.scenario ?? 'unknown';
  console.log(`\n[${idx + 1}/${count}] ${scenario}`);

  if (SCENARIO_FILTER && scenario !== SCENARIO_FILTER) {
    console.log(`  · skipped (filter)`);
    return;
  }

  const localeLang = item.input.locale.toLowerCase().split('-')[0] ?? 'en';
  const today = new Date().toISOString().slice(0, 10);
  const variables = { locale_lang: localeLang, today };

  const [soul, rules] = await Promise.all([
    getPromptWithFallback('sendero-soul', SENDERO_SOUL, variables, {
      label: 'production',
      cacheTtlSeconds: 60,
    }),
    getPromptWithFallback(
      'sendero-chat-routing-rules',
      '## Routing rules\n- Only call tools when no canonical workflow fits.',
      variables,
      { label: 'production', cacheTtlSeconds: 60 }
    ),
  ]);
  const systemPrompt = `${soul.text}\n\n${rules.text}`;

  const traced = await traceAgent(
    'sendero-conversation',
    {
      userId: 'regression-runner',
      tenantId: 'regression-tenant',
      sessionId: `regression:${RUN_NAME}`,
      trigger: 'cron',
      surface: 'app-api',
      channel: item.input.channel,
    },
    async () => {
      const result = await generateText({
        model: openai('gpt-4.1-nano'),
        system: systemPrompt,
        prompt: item.input.text,
        temperature: 0,
        experimental_telemetry: aiTelemetryConfig('sendero-regression', {
          userId: 'regression-runner',
          tenantId: 'regression-tenant',
          surface: 'app-api',
          trigger: 'cron',
          channel: item.input.channel,
          scope: scenario,
        }),
      });
      const traceId = getActiveTraceId() ?? `regression-${item.id}`;
      return { text: result.text, traceId };
    }
  );

  const { text, traceId: innerTraceId } = traced.result;
  const traceId = innerTraceId;

  console.log(`  output: ${text.slice(0, 120).replace(/\n/g, ' ')}…`);

  const rule = checkRules(text, item.expectedOutput);
  const ruleScore = rule.total > 0 ? rule.passes / rule.total : 1;
  await scoreTrace(traceId, 'rule-match', ruleScore, {
    dataType: 'NUMERIC',
    comment: rule.failures.length ? rule.failures.join('; ') : 'all rules pass',
  });
  console.log(
    `  rule-match: ${rule.passes}/${rule.total}` +
      (rule.failures.length ? ` (failures: ${rule.failures.join(', ')})` : '')
  );

  await evaluateTrace({
    traceId,
    input: item.input.text,
    output: text,
  });

  await attachRunToItem({ itemId: item.id, traceId });
}

async function main(): Promise<void> {
  console.log(`Run: ${RUN_NAME}`);
  console.log(`Dataset: ${DATASET_NAME}`);
  console.log(`Filter: ${SCENARIO_FILTER ?? '(all scenarios)'}`);

  const items = await fetchItems();
  console.log(`\nFetched ${items.length} dataset items.`);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;
    try {
      await runItem(item, i, items.length);
    } catch (err) {
      console.error(`  ✗ ${item.metadata?.scenario ?? item.id} failed:`, err);
    }
  }

  await flushLangfuse();
  console.log(`\n✓ Run complete. View at ${HOST}/datasets`);
}

await main();
