/**
 * visual_aesthetic_scorer — HP2 Tool 24.
 *
 * Spec: docs/specs/anticipatory-concierge.md §4.0 HP2 (visual taxonomy)
 * + roadmap §HP2.
 *
 * Scores accessible images for whether a place looks beautiful / tasteful
 * / right for a traveler. Single multimodal Vertex call (Gemini 3 flash)
 * with structured output coerces image content into the AestheticTag
 * taxonomy + a 0-1 score.
 *
 * Image-source policy (autoplan-flagged constraint, see HP2 spec):
 *   - DO use Google Places photos, official websites, public CDN images,
 *     user-supplied URLs.
 *   - DO NOT scrape Instagram. Pass a public Instagram post URL and the
 *     model can read OG metadata, but the tool itself never crawls.
 *
 * Vertex direct → AI Gateway fallback (same pattern as
 * `monocle_place_researcher`). Single pass: vision model accepts both
 * structured output AND image inputs in one call. No grounding tool.
 *
 * **Experimental** (`experimental: true`). Dev-only gate at handler-time.
 *
 * Cost note: each call is one multimodal Gemini-3-flash request. Budget
 * for ~3-5 images per call — beyond that, cost spikes and the marginal
 * signal flattens.
 */

import { z } from 'zod';
import { generateObject } from 'ai';
import { createVertex } from '@ai-sdk/google-vertex';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

// ── AestheticTag taxonomy (mirrors spec) ──────────────────────────────

const AESTHETIC_TAGS = [
  'warm_lighting',
  'natural_light',
  'minimal',
  'old_world',
  'japanese_clean',
  'editorial',
  'romantic',
  'cozy',
  'design_forward',
  'beautiful_counter',
  'good_plating',
  'lush_greenery',
  'rooftop_view',
  // negatives
  'generic',
  'touristy',
  'fluorescent',
  'crowded',
  'soulless',
  'instagram_trap',
] as const;

const PLACE_CATEGORIES = [
  'restaurant',
  'cafe',
  'bar',
  'hotel',
  'museum',
  'date_spot',
  'shop',
] as const;

const inputSchema = z.object({
  placeName: z.string().min(1).max(160),
  category: z.enum(PLACE_CATEGORIES),
  imageUrls: z
    .array(z.string().url())
    .min(1)
    .max(6)
    .describe(
      'Direct image URLs (https). Places photos must be pre-resolved to public URLs. ' +
        'Cap at 6; cost + signal both plateau quickly.'
    ),
  /**
   * Optional traveler taste hint — when given, the model weighs the
   * score against the traveler's stated preferences. Free text from
   * the taste graph.
   */
  travelerTaste: z
    .object({
      likes: z.array(z.string().max(80)).max(10).optional(),
      dislikes: z.array(z.string().max(80)).max(10).optional(),
    })
    .optional(),
  /** Optional context — what kind of visit is the traveler considering. */
  visitContext: z
    .enum(['date', 'solo_lunch', 'deep_work', 'group_dinner', 'celebration', 'tasting'])
    .optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});

export type VisualAestheticScorerInput = z.infer<typeof inputSchema>;

const outputShape = z.object({
  aestheticScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      '0 to 1. 0 = soulless / generic / lifeless. 1 = visually distinctive, well-composed, the kind of place a traveler with taste would actively want to visit. 0.5 = nothing wrong, nothing remarkable. Weight against the traveler taste hint when present.'
    ),
  visualTags: z
    .array(z.enum(AESTHETIC_TAGS))
    .max(8)
    .describe('Tags from the AestheticTag taxonomy. At most 6 picked.'),
  warnings: z
    .array(z.string())
    .max(6)
    .describe(
      "Soft red flags: 'fluorescent overhead lighting', 'photos look heavily filtered', 'bachelorette-party crowd', 'instagram-wall venue', 'the food looks better in photos than reality'. Empty array when nothing concerning."
    ),
  confidence: z
    .enum(['low', 'medium', 'high'])
    .describe(
      "high = ≥3 images, all clearly of this place, broad coverage. medium = 2-3 images or partial coverage. low = 1 image or low-quality / mostly menus / doesn't show interior."
    ),
  bestFor: z
    .array(z.string())
    .max(4)
    .describe(
      'Use cases the visuals support: date / solo_lunch / deep_work / group_dinner / tasting.'
    ),
  notFor: z.array(z.string()).max(4).describe('Use cases the visuals contraindicate.'),
});

export type AestheticTag = (typeof AESTHETIC_TAGS)[number];

export interface VisualAestheticScorerReport {
  aestheticScore: number;
  visualTags: AestheticTag[];
  warnings: string[];
  confidence: 'low' | 'medium' | 'high';
  bestFor: string[];
  notFor: string[];
}

export type VisualAestheticScorerResult =
  | {
      status: 'ok';
      report: VisualAestheticScorerReport;
      via: 'vertex' | 'gateway';
      message: string;
    }
  | { status: 'production_refused'; message: string }
  | { status: 'unavailable'; reason: string; message: string };

// ── Vertex / Gateway plumbing ────────────────────────────────────────

const VERTEX_MODEL_ID = 'gemini-3-flash-preview';
const GATEWAY_MODEL_ID = 'google/gemini-3-flash';

function resolveVertex() {
  const project = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT ?? null;
  const location = process.env.GOOGLE_CLOUD_LOCATION ?? 'global';
  const saJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!project || !saJson) return null;
  try {
    return createVertex({
      project,
      location,
      googleAuthOptions: { credentials: JSON.parse(saJson) },
    });
  } catch {
    return null;
  }
}

type ContentPart = { type: 'text'; text: string } | { type: 'image'; image: URL };

function buildMessages(input: VisualAestheticScorerInput): Array<{
  role: 'user';
  content: ContentPart[];
}> {
  const parts: ContentPart[] = [];
  parts.push({
    type: 'text',
    text: `You are a visual taste editor for Sendero, an AI travel concierge. Score the following images of a ${input.category} called "${input.placeName}".

Pick 3-6 tags from the strict AestheticTag taxonomy in the schema (positive + negative). Use the negative tags only when the visuals genuinely warrant them — most places are neither beautiful nor terrible.

When in doubt, score conservatively (closer to 0.5). Reserve > 0.8 for places that would feel at home in a Monocle / Cereal / Apartamento spread.

${
  input.travelerTaste?.likes?.length
    ? `Traveler likes: ${input.travelerTaste.likes.join(', ')}.`
    : ''
}
${
  input.travelerTaste?.dislikes?.length
    ? `Traveler dislikes: ${input.travelerTaste.dislikes.join(', ')}.`
    : ''
}
${input.visitContext ? `Visit context: ${input.visitContext}.` : ''}
Locale for any narrative output: ${input.locale}.`,
  });
  for (const url of input.imageUrls) {
    parts.push({ type: 'image', image: new URL(url) });
  }
  return [{ role: 'user', content: parts }];
}

async function runWithModel(
  model: Parameters<typeof generateObject>[0]['model'],
  input: VisualAestheticScorerInput,
  providerOptions?: Parameters<typeof generateObject>[0]['providerOptions']
) {
  const result = await generateObject({
    model,
    schema: outputShape,
    messages: buildMessages(input) as never,
    ...(providerOptions ? { providerOptions } : {}),
  });
  return result.object;
}

// ── Orchestrator ─────────────────────────────────────────────────────

export async function runVisualAestheticScorer(
  rawInput: VisualAestheticScorerInput,
  ctx?: ToolContext
): Promise<VisualAestheticScorerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) {
    return { status: 'production_refused', message: gate.reason };
  }

  const input = inputSchema.parse(rawInput);

  // Path 1: Vertex direct.
  const vertex = resolveVertex();
  if (vertex) {
    try {
      const obj = await runWithModel(vertex(VERTEX_MODEL_ID), input);
      return {
        status: 'ok',
        report: obj as VisualAestheticScorerReport,
        via: 'vertex',
        message: `Scored ${input.imageUrls.length} images of ${input.placeName} (score=${obj.aestheticScore.toFixed(2)}, ${obj.visualTags.length} tags).`,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[visual_aesthetic_scorer] Vertex direct failed, falling back to AI Gateway:',
        (err as Error).message ?? err
      );
    }
  }

  // Path 2: AI Gateway fallback.
  try {
    const obj = await runWithModel(GATEWAY_MODEL_ID, input, {
      gateway: { order: ['google'] },
    });
    return {
      status: 'ok',
      report: obj as VisualAestheticScorerReport,
      via: 'gateway',
      message: `Scored ${input.imageUrls.length} images of ${input.placeName} via gateway (score=${obj.aestheticScore.toFixed(2)}).`,
    };
  } catch (err) {
    return {
      status: 'unavailable',
      reason: (err as Error).message ?? 'gateway-failed',
      message: `Couldn't score images of ${input.placeName}. Vertex + gateway both failed — verify the URLs are publicly fetchable.`,
    };
  }
}

// ── Tool registration ────────────────────────────────────────────────

export const visualAestheticScorerTool: ToolDef<
  VisualAestheticScorerInput,
  VisualAestheticScorerResult
> = {
  name: 'visual_aesthetic_scorer',
  internal: true,
  experimental: true,
  description:
    'Score how beautiful / tasteful a place looks from accessible images via Vertex multimodal vision (Gemini 3 flash). Returns aesthetic score 0-1 + tags from a strict taxonomy (warm_lighting, natural_light, minimal, old_world, japanese_clean, editorial, romantic, cozy, design_forward, beautiful_counter, good_plating, lush_greenery, rooftop_view, generic, touristy, fluorescent, crowded, soulless, instagram_trap) + warnings + confidence. Pass 3-6 publicly-fetchable image URLs (Places photos pre-resolved, official websites, user-supplied). Compose with `budget_estimator` via `beauty_budget_ranker` for taste-per-dollar ranking.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['placeName', 'category', 'imageUrls'],
    properties: {
      placeName: { type: 'string', minLength: 1, maxLength: 160 },
      category: { type: 'string', enum: [...PLACE_CATEGORIES] },
      imageUrls: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: { type: 'string', format: 'uri' },
      },
      travelerTaste: {
        type: 'object',
        properties: {
          likes: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 80 } },
          dislikes: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 80 } },
        },
      },
      visitContext: {
        type: 'string',
        enum: ['date', 'solo_lunch', 'deep_work', 'group_dinner', 'celebration', 'tasting'],
      },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runVisualAestheticScorer,
};
