/**
 * Seed the `sendero-golden-turns` dataset in Langfuse with representative
 * inputs covering the canonical agent paths. Idempotent on the dataset
 * (createOrUpdate) but item creation is additive — re-running adds duplicates,
 * so prefer to seed once and edit items in the Langfuse UI thereafter.
 *
 *   bun scripts/seed-langfuse-dataset.ts
 */

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const AUTH = `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`;
const DATASET_NAME = 'sendero-golden-turns';

interface DatasetItem {
  input: { text: string; locale: string; channel: 'web' | 'whatsapp' | 'slack' | 'mcp' };
  expectedOutput: { mustMention: string[]; mustNotMention?: string[]; expectedToolCall?: string };
  metadata: { scenario: string; intent: string };
}

const ITEMS: DatasetItem[] = [
  {
    input: {
      text: 'I need to fly from Buenos Aires (EZE) to Mendoza (MDZ) next Friday morning for one person.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['search', 'flight'],
      expectedToolCall: 'search_flights',
    },
    metadata: { scenario: 'search-flights', intent: 'individual-traveler-booking' },
  },
  {
    input: {
      text: 'Hold the cheapest morning flight on the EZE→MDZ offer set for me; we will settle on-chain in USDC.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['hold', 'escrow'],
      expectedToolCall: 'book_flight',
    },
    metadata: { scenario: 'hold-and-settle', intent: 'individual-traveler-booking' },
  },
  {
    input: {
      text: 'Cancel my booking with reference BK-2026-001 and refund the full amount.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['refund'],
      expectedToolCall: 'sendero.refund',
    },
    metadata: { scenario: 'refund-flow', intent: 'cancellation' },
  },
  {
    input: {
      text: 'Book a $5000 first-class flight LAX → JFK for tomorrow.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['policy', 'approval'],
      mustNotMention: ['booked', 'confirmed'],
    },
    metadata: { scenario: 'policy-block', intent: 'over-cap-booking' },
  },
  {
    input: {
      text: 'Necesito un vuelo de Buenos Aires a Madrid para el próximo lunes, una persona.',
      locale: 'es-AR',
      channel: 'whatsapp',
    },
    expectedOutput: {
      mustMention: ['vuelo', 'Madrid'],
      mustNotMention: ['flight'],
      expectedToolCall: 'search_flights',
    },
    metadata: { scenario: 'locale-spanish', intent: 'individual-traveler-booking' },
  },
  {
    input: {
      text: 'Make it for two people instead — the flight you just quoted me.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['two', 'passenger'],
    },
    metadata: { scenario: 'multi-turn-history', intent: 'modify-prior-quote' },
  },
  {
    input: {
      text: "Here's the hotel receipt — log it as an expense for trip TRP-001.",
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['receipt', 'expense'],
      expectedToolCall: 'scan_document',
    },
    metadata: { scenario: 'document-scan', intent: 'expense-logging' },
  },
  {
    input: {
      text: 'What is our current Arc treasury USDC balance?',
      locale: 'en-US',
      channel: 'slack',
    },
    expectedOutput: {
      mustMention: ['USDC', 'balance'],
      expectedToolCall: 'check_treasury',
    },
    metadata: { scenario: 'treasury-check', intent: 'corporate-ops' },
  },
  {
    // Same prompt run through both surfaces (sendero-chat-routing-rules
    // for /api/agent/chat, sendero-web-chat-rules for /api/chat) is
    // expected to land near-identical Duffel sandbox prices. /qa on
    // 2026-04-28 found a 2x drift ($483 vs $935 premium economy
    // SFO→LHR) between surfaces — judge flagged hallucination=yes on
    // the cheaper one. Captures that anomaly for regression detection.
    input: {
      text: 'Search premium economy flights from San Francisco (SFO) to London Heathrow (LHR) departing 2026-05-14 returning 2026-05-21 for 1 passenger.',
      locale: 'en-US',
      channel: 'web',
    },
    expectedOutput: {
      mustMention: ['SFO', 'LHR', 'premium economy'],
      mustNotMention: ['$483'],
      expectedToolCall: 'search_flights',
    },
    metadata: {
      scenario: 'premium-economy-price-drift',
      intent: 'cross-surface-price-parity',
      flaggedBy: 'qa-2026-04-28',
    },
  },
];

async function ensureDataset(): Promise<void> {
  const res = await fetch(`${HOST}/api/public/v2/datasets`, {
    method: 'POST',
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: DATASET_NAME,
      description: 'Golden agent turns covering search/hold/refund/policy/locale/multi-turn paths.',
      metadata: { owner: 'platform', surface: 'all' },
    }),
  });
  if (res.ok) {
    console.log(`✓ Created dataset ${DATASET_NAME}`);
    return;
  }
  // 409-like duplicate is fine — Langfuse v2 datasets endpoint is upsert-ish.
  const text = await res.text();
  if (res.status === 400 && text.includes('already exists')) {
    console.log(`• Dataset ${DATASET_NAME} already exists`);
    return;
  }
  throw new Error(`Create dataset failed: ${res.status} ${text}`);
}

async function addItem(item: DatasetItem, index: number): Promise<void> {
  const res = await fetch(`${HOST}/api/public/dataset-items`, {
    method: 'POST',
    headers: { authorization: AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({
      datasetName: DATASET_NAME,
      input: item.input,
      expectedOutput: item.expectedOutput,
      metadata: item.metadata,
    }),
  });
  if (!res.ok) {
    throw new Error(`Item ${index} failed: ${res.status} ${await res.text()}`);
  }
  console.log(`  ✓ ${item.metadata.scenario}`);
}

async function main(): Promise<void> {
  await ensureDataset();
  console.log(`Adding ${ITEMS.length} items…`);
  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i];
    if (!item) continue;
    await addItem(item, i);
  }
  console.log('Done.');
}

await main();
