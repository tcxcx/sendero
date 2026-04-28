/**
 * One-shot: seed the two universal stamp prompts in Langfuse.
 *
 *   sendero-stamp-image-brand-anchor — universal brand visual rules locked into
 *     every stamp image prompt (vermillion linework, parchment substrate, etc).
 *     Surfaces in apps/app/workflows/stamps/shared/moodboard.ts::BRAND_ANCHOR_TEXT.
 *
 *   sendero-stamp-caption-rules — universal caption format/voice rules
 *     (1 sentence, ≤140c, plain text, Sendero editorial voice).
 *     Surfaces in apps/app/workflows/stamps/shared/prompts.ts::captionPromptForKind.
 *
 * The per-kind narrative bodies (BoardingPass / SettlementReceipt /
 * ItineraryMap / TripPassport) stay in code — they interleave dynamic data
 * (route, carrier, USDC amount) too tightly for Langfuse {{var}} substitution.
 *
 *   bun scripts/seed-langfuse-stamp-prompts.ts
 */

const HOST = process.env.LANGFUSE_BASE_URL ?? 'https://us.cloud.langfuse.com';
const PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY;
const SECRET_KEY = process.env.LANGFUSE_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
  console.error('Missing LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY in env.');
  process.exit(1);
}

const STAMP_IMAGE_BRAND_ANCHOR = `Sendero brand: a smart travel guide with taste — editorial, hand-drawn, premium-but-warm.

Visual rules (LOCK):
- Loose vermillion linework (#D65438) on warm parchment background (#EEDCC7).
- Visible paper grain, subtle distressed print texture, slightly imperfect registration.
- Hand-drawn editorial sensibility — slightly literary, observant, map-room sensibility.
- Color accents from the brand palette only: midnight #1F2A44 (text/depth), sea #0F7C82 (travel ops/maps), sand #B6844E (warm editorial moments).
- Square composition.

NEVER:
- Shiny startup gradients, glassmorphism, generic tech blue.
- Sterile geometric perfection.
- Telegram/paper-plane/chat-app icon clichés or literal airplane silhouettes.
- AI-slop neon-on-dark backgrounds or digital-painter rendering.
- Any human face or recognizable person from the reference image.
- Any name, passport number, or PII text from the reference image.`;

const STAMP_CAPTION_RULES = `Return ONLY one sentence, max 140 characters. No quotation marks, no emoji, no hashtags, no labels like "Caption:". Plain text suitable for an unfurl preview. Sendero voice: a smart travel guide with taste — editorial, observant, slightly literary, never gimmicky.`;

const PROMPTS = [
  {
    name: 'sendero-stamp-image-brand-anchor',
    prompt: STAMP_IMAGE_BRAND_ANCHOR,
    tags: ['sendero', 'system-prompt', 'stamp', 'image'],
    commitMessage: 'Initial seed — universal brand visual rules for stamp image generation',
  },
  {
    name: 'sendero-stamp-caption-rules',
    prompt: STAMP_CAPTION_RULES,
    tags: ['sendero', 'system-prompt', 'stamp', 'caption'],
    commitMessage: 'Initial seed — universal voice/format rules for stamp captions',
  },
];

async function seed(p: (typeof PROMPTS)[number]): Promise<void> {
  const res = await fetch(`${HOST}/api/public/v2/prompts`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${btoa(`${PUBLIC_KEY}:${SECRET_KEY}`)}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      name: p.name,
      type: 'text',
      prompt: p.prompt,
      labels: ['production'],
      tags: p.tags,
      commitMessage: p.commitMessage,
    }),
  });
  if (!res.ok) throw new Error(`${p.name}: ${res.status} ${await res.text()}`);
  const created = (await res.json()) as { name: string; version: number };
  console.log(`✓ ${created.name} v${created.version}`);
}

for (const p of PROMPTS) await seed(p);
