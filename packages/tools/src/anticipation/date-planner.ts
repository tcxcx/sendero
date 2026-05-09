/**
 * Date planner tools — HP3 #31 / #33 / #32 / #34 (roadmap §HP3).
 *
 * Four small, pure tools shipped together because they share the
 * DateBudgetTier vocabulary + a tasteful, policy-bounded voice:
 *
 *   - date_budget_optimizer  — desired vibe → moves ranked by budget tier
 *   - date_perfume_advisor   — fragrance profile by day/night + tier
 *   - date_game_tips         — confidence + conversation + timing advice
 *   - date_plan_builder      — multi-stop plan from caller-supplied candidates
 *
 * **Voice policy (load-bearing, do NOT soften):**
 *   - Confident, kind, consent-aware.
 *   - Never reduce the date object to a target. No manipulation, pickup
 *     artist tactics, sexual pressure, creepy personalization, or gender
 *     stereotypes. The spec lists these as NOT ALLOWED — guardrail
 *     enforced at content time, not runtime.
 *
 * All four are **experimental** + **internal** + dev-only gated. Pure
 * functions, no external APIs.
 *
 * Spec: docs/specs/anticipatory-concierge.md §HP3 + roadmap §HP3.
 */

import { z } from 'zod';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

// ── Shared types ─────────────────────────────────────────────────────

export const DATE_BUDGET_TIERS = ['budget', 'medium', 'premium', 'splurge'] as const;
export type DateBudgetTier = (typeof DATE_BUDGET_TIERS)[number];

export const DATE_VIBES = [
  'casual',
  'chill',
  'romantic',
  'design_forward',
  'old_world',
  'high_energy',
  'quiet',
  'cultural',
  'foodie',
  'outdoorsy',
] as const;
export type DateVibe = (typeof DATE_VIBES)[number];

export const TIMELINE_ROLES = ['opener', 'anchor', 'second_move', 'exit'] as const;
export type DateTimelineRole = (typeof TIMELINE_ROLES)[number];

// ── 1. date_budget_optimizer ─────────────────────────────────────────

const budgetOptimizerInput = z.object({
  vibe: z.enum(DATE_VIBES).default('romantic'),
  budgetTier: z.enum(DATE_BUDGET_TIERS).default('medium'),
  city: z.string().max(120).optional(),
  preferredTimeOfDay: z.enum(['afternoon', 'evening', 'late_night']).default('evening'),
});

export type DateBudgetOptimizerInput = z.infer<typeof budgetOptimizerInput>;

interface DateMoveTemplate {
  role: DateTimelineRole;
  category: string;
  /** Tier this move is sized for. */
  tier: DateBudgetTier;
  vibes: DateVibe[];
  description: string;
  /** Per-person spend envelope, USD-equivalent. */
  expectedSpend: string;
}

const MOVE_LIBRARY: DateMoveTemplate[] = [
  // BUDGET tier — ~$25-40/person across all moves
  {
    role: 'opener',
    category: 'specialty_coffee',
    tier: 'budget',
    vibes: ['casual', 'chill', 'design_forward'],
    description: 'Specialty coffee + pastry, walking distance to the anchor.',
    expectedSpend: '$6-12',
  },
  {
    role: 'opener',
    category: 'gallery',
    tier: 'budget',
    vibes: ['cultural', 'design_forward', 'quiet'],
    description: 'Free / low-cost gallery or museum hour.',
    expectedSpend: '$0-12',
  },
  {
    role: 'anchor',
    category: 'casual_restaurant',
    tier: 'budget',
    vibes: ['casual', 'foodie'],
    description: 'Beloved neighborhood spot with a strong house dish.',
    expectedSpend: '$15-25',
  },
  {
    role: 'second_move',
    category: 'walk',
    tier: 'budget',
    vibes: ['romantic', 'chill', 'quiet'],
    description: 'Walk to a viewpoint or quiet square — free, beautiful when the weather plays.',
    expectedSpend: '$0',
  },
  // MEDIUM tier — ~$40-90/person
  {
    role: 'opener',
    category: 'wine_bar',
    tier: 'medium',
    vibes: ['romantic', 'old_world', 'cultural'],
    description: 'One glass at a wine bar with a great by-the-glass list.',
    expectedSpend: '$12-22',
  },
  {
    role: 'opener',
    category: 'cocktail_bar',
    tier: 'medium',
    vibes: ['high_energy', 'design_forward'],
    description: 'A single signature cocktail to break the ice — short, deliberate.',
    expectedSpend: '$14-22',
  },
  {
    role: 'anchor',
    category: 'mid_restaurant',
    tier: 'medium',
    vibes: ['romantic', 'foodie', 'design_forward'],
    description: 'Mid-tier restaurant with a focused menu and warm room.',
    expectedSpend: '$30-55',
  },
  {
    role: 'second_move',
    category: 'jazz_club',
    tier: 'medium',
    vibes: ['romantic', 'cultural', 'old_world'],
    description: 'Late jazz set or live music, shared one-drink minimum.',
    expectedSpend: '$15-25',
  },
  {
    role: 'second_move',
    category: 'rooftop_bar',
    tier: 'medium',
    vibes: ['romantic', 'high_energy'],
    description: 'Rooftop or terrace nightcap, weather-dependent.',
    expectedSpend: '$15-22',
  },
  // PREMIUM tier — ~$90-180/person
  {
    role: 'anchor',
    category: 'fine_restaurant',
    tier: 'premium',
    vibes: ['romantic', 'foodie', 'cultural'],
    description: 'Fine restaurant — chef-led, well-paced, not a tasting marathon.',
    expectedSpend: '$70-130',
  },
  {
    role: 'second_move',
    category: 'cocktail_bar',
    tier: 'premium',
    vibes: ['romantic', 'design_forward'],
    description: "Proper cocktail bar after dinner — bartender's choice, sit at the counter.",
    expectedSpend: '$25-40',
  },
  {
    role: 'second_move',
    category: 'concert',
    tier: 'premium',
    vibes: ['cultural', 'high_energy'],
    description: 'Concert / theater / dance booked in advance.',
    expectedSpend: '$30-90',
  },
  // SPLURGE tier — explicit-request only
  {
    role: 'anchor',
    category: 'tasting_menu',
    tier: 'splurge',
    vibes: ['foodie', 'cultural', 'romantic'],
    description: 'Tasting menu with pairing — long, structured, only when both want it.',
    expectedSpend: '$180-380',
  },
  {
    role: 'second_move',
    category: 'private_experience',
    tier: 'splurge',
    vibes: ['romantic', 'cultural'],
    description: 'Private experience — speakeasy reservation, jazz table, arranged in advance.',
    expectedSpend: '$60-150',
  },
  // EXIT — universal
  {
    role: 'exit',
    category: 'walk_home',
    tier: 'budget',
    vibes: ['romantic', 'chill', 'quiet'],
    description:
      'Walk along a safe, well-lit route — no rush, easy to step away whenever feels right.',
    expectedSpend: '$0',
  },
  {
    role: 'exit',
    category: 'late_dessert',
    tier: 'medium',
    vibes: ['romantic', 'foodie'],
    description: 'Shared late dessert, optional — only when the energy is mutual.',
    expectedSpend: '$10-18',
  },
];

export interface DateBudgetOptimizerResult {
  status: 'ok' | 'production_refused';
  message?: string;
  tier?: DateBudgetTier;
  vibe?: DateVibe;
  moves?: DateMoveTemplate[];
  totalEnvelope?: string;
}

function tierAllows(moveTier: DateBudgetTier, requestedTier: DateBudgetTier): boolean {
  const order: DateBudgetTier[] = ['budget', 'medium', 'premium', 'splurge'];
  return order.indexOf(moveTier) <= order.indexOf(requestedTier);
}

export async function runDateBudgetOptimizer(
  rawInput: DateBudgetOptimizerInput,
  ctx?: ToolContext
): Promise<DateBudgetOptimizerResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = budgetOptimizerInput.parse(rawInput);
  const moves = MOVE_LIBRARY.filter(
    m => m.vibes.includes(input.vibe) && tierAllows(m.tier, input.budgetTier)
  );
  // Prefer the tier the caller asked for, then fall back to lower tiers.
  const tierOrder: DateBudgetTier[] = ['splurge', 'premium', 'medium', 'budget'];
  moves.sort((a, b) => tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier));

  const ENVELOPE: Record<DateBudgetTier, string> = {
    budget: '~$25-40/person across the night',
    medium: '~$40-90/person across the night',
    premium: '~$90-180/person across the night',
    splurge: '~$180-400/person — explicitly chosen by both, not auto-suggested',
  };

  return {
    status: 'ok',
    tier: input.budgetTier,
    vibe: input.vibe,
    moves: moves.slice(0, 12),
    totalEnvelope: ENVELOPE[input.budgetTier],
    message: `${moves.length} moves matching ${input.vibe} × ${input.budgetTier}.`,
  };
}

const dateBudgetOptimizerTool: ToolDef<DateBudgetOptimizerInput, DateBudgetOptimizerResult> = {
  name: 'date_budget_optimizer',
  internal: true,
  experimental: true,
  description:
    'Translate a desired date vibe + budget tier into a curated list of move templates (opener / anchor / second_move / exit) with expected spend envelopes. Pure — no external API. Pass to `date_plan_builder` to compose into a real plan with specific places via `cheap_michelin_finder` / `wine_bar_finder` / etc. Splurge tier surfaces only when both have explicitly chosen it.',
  inputSchema: budgetOptimizerInput,
  jsonSchema: {
    type: 'object',
    properties: {
      vibe: { type: 'string', enum: [...DATE_VIBES] },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      city: { type: 'string', maxLength: 120 },
      preferredTimeOfDay: { type: 'string', enum: ['afternoon', 'evening', 'late_night'] },
    },
  },
  handler: runDateBudgetOptimizer,
};

// ── 2. date_perfume_advisor ──────────────────────────────────────────

const perfumeInput = z.object({
  timeOfDay: z.enum(['day', 'night']).default('night'),
  vibe: z.enum(DATE_VIBES).default('romantic'),
  /** Climate hint — 'warm' (≥20°C) / 'cool' (10-20°C) / 'cold' (<10°C). */
  climate: z.enum(['warm', 'cool', 'cold']).default('cool'),
  budgetTier: z.enum(DATE_BUDGET_TIERS).default('medium'),
});

export type DatePerfumeAdvisorInput = z.infer<typeof perfumeInput>;

export interface PerfumeProfile {
  family: string;
  notes: string[];
  intent: string;
}

export interface DatePerfumeAdvisorResult {
  status: 'ok' | 'production_refused';
  message?: string;
  profile?: PerfumeProfile;
  applicationTip?: string;
  guardrail?: string;
}

const PROFILES: Record<string, PerfumeProfile> = {
  day_warm: {
    family: 'citrus',
    notes: ['neroli', 'bergamot', 'green tea', 'subtle musk'],
    intent: 'Light, alive, signals you took the day seriously without trying too hard.',
  },
  day_cool: {
    family: 'tea / light woods',
    notes: ['white tea', 'iris', 'soft cedar', 'fig leaf'],
    intent: 'Quiet warmth — close to skin, polite.',
  },
  day_cold: {
    family: 'soft woods',
    notes: ['cedar', 'iris', 'subtle vanilla', 'cardamom'],
    intent: 'A discreet halo of warmth without leaving sillage in a small room.',
  },
  night_warm: {
    family: 'amber',
    notes: ['amber', 'jasmine', 'soft tobacco', 'oud-light'],
    intent: 'Warm, confident, a few notches above day.',
  },
  night_cool: {
    family: 'warm woods + amber',
    notes: ['sandalwood', 'amber', 'spicy citrus', 'leather-light'],
    intent: 'Classic evening — projection enough to be noticed close, never a cloud.',
  },
  night_cold: {
    family: 'oriental',
    notes: ['amber', 'tobacco', 'vanilla', 'spice'],
    intent: 'Heavy enough to feel through coats; the goal is discovery, not announcement.',
  },
};

export async function runDatePerfumeAdvisor(
  rawInput: DatePerfumeAdvisorInput,
  ctx?: ToolContext
): Promise<DatePerfumeAdvisorResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = perfumeInput.parse(rawInput);
  const key = `${input.timeOfDay}_${input.climate}`;
  const profile = PROFILES[key]!;

  const sprayCount =
    input.timeOfDay === 'night' && input.climate === 'cold'
      ? 3
      : input.timeOfDay === 'night'
        ? 2
        : 1;

  return {
    status: 'ok',
    profile,
    applicationTip: `${sprayCount} spray${sprayCount === 1 ? '' : 's'}, applied to chest + inside of one wrist (NOT rubbed). Reapply nothing during the date.`,
    guardrail:
      'The goal is discovery, not announcement. If anyone smells you from across a room, it is too much.',
    message: `${profile.family} profile for a ${input.timeOfDay} date in ${input.climate} weather.`,
  };
}

const datePerfumeAdvisorTool: ToolDef<DatePerfumeAdvisorInput, DatePerfumeAdvisorResult> = {
  name: 'date_perfume_advisor',
  internal: true,
  description:
    "Suggest a fragrance profile (family, notes, intent) for a date based on time-of-day + vibe + climate + budget tier. Returns spray count + application tip + the 'discovery, not announcement' guardrail. Pure tool, no external API.",
  inputSchema: perfumeInput,
  jsonSchema: {
    type: 'object',
    properties: {
      timeOfDay: { type: 'string', enum: ['day', 'night'] },
      vibe: { type: 'string', enum: [...DATE_VIBES] },
      climate: { type: 'string', enum: ['warm', 'cool', 'cold'] },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
    },
  },
  handler: runDatePerfumeAdvisor,
};

// ── 3. date_game_tips ────────────────────────────────────────────────

const gameTipsInput = z.object({
  context: z.enum(['first_date', 'second_date', 'long_term', 'reconnect']).default('first_date'),
  /** Quiet / loud venue context affects conversation pacing tips. */
  venueQuiet: z.boolean().optional(),
  /** Already-chosen vibe — affects which tips lean confidence vs. presence. */
  vibe: z.enum(DATE_VIBES).default('romantic'),
});

export type DateGameTipsInput = z.infer<typeof gameTipsInput>;

export interface DateGameTipsResult {
  status: 'ok' | 'production_refused';
  message?: string;
  confidence?: string[];
  conversation?: string[];
  timing?: string[];
  gracefulExit?: string[];
  guardrail?: string;
}

export async function runDateGameTips(
  rawInput: DateGameTipsInput,
  ctx?: ToolContext
): Promise<DateGameTipsResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = gameTipsInput.parse(rawInput);

  const confidence: string[] = [
    'Arrive 5 minutes early, find your seat, and let your shoulders drop. The other person is more nervous than you assume.',
    'You do not need to be impressive. You need to be interested.',
    'Eye contact for 3 seconds at a time, then look away. Never staring.',
  ];

  const conversation: string[] = [
    'Ask about texture, not facts. "What was the day like?" beats "Where did you grow up?"',
    'Listen for what they care about and follow that thread. People remember being heard, not being entertained.',
    'When you disagree gently, do it warmly. "I see it differently — say more, I want to understand."',
    'Silence is not a failure. The first 5 seconds of quiet is where the real conversation starts.',
  ];

  if (input.venueQuiet === false) {
    conversation.push(
      "Loud room: lean in slightly, stay calm, ask shorter questions. Don't shout — let the room do the work of bringing you closer."
    );
  }

  const timing: string[] = [
    'A great first date is short. 90 minutes leaves people wanting more; 3 hours grinds.',
    'Suggest the second move only when energy is mutual. If you sense hesitation, end it — gracefully.',
    'Pay or split with confidence and zero performance. Whatever you do, do it without making it a moment.',
  ];

  if (input.context === 'first_date') {
    timing.push(
      "Don't pre-book everything — leaving 30 minutes of unstructured time is where the real connection happens."
    );
  }

  const gracefulExit: string[] = [
    'A graceful exit is a gift. "I had a really nice time. I want to text you tomorrow." — short, warm, no negotiating.',
    'No drawn-out goodbyes. Standing-up, eye-contact, calm walk to the curb / station / car.',
    'If the date is not working, end it kindly and early. "I think we should call it a night — I appreciate you meeting me."',
  ];

  const guardrail =
    'No manipulation, no pickup tactics, no pressure. Consent is conversational AND continuous — every move (second drink, walk, dessert, anything) is a question, not a maneuver.';

  return {
    status: 'ok',
    confidence,
    conversation,
    timing,
    gracefulExit,
    guardrail,
    message: `Tasteful date tips for ${input.context} (${input.vibe}). Voice: confident, kind, consent-aware.`,
  };
}

const dateGameTipsTool: ToolDef<DateGameTipsInput, DateGameTipsResult> = {
  name: 'date_game_tips',
  internal: true,
  description:
    'Give tasteful, respectful, confidence-building date tips. Returns four bucketed lists — confidence, conversation, timing, graceful exit — plus a consent-aware guardrail line. Strict policy: no manipulation, no pickup-artist tactics, no pressure, no gender stereotypes. Pure tool, no external API.',
  inputSchema: gameTipsInput,
  jsonSchema: {
    type: 'object',
    properties: {
      context: { type: 'string', enum: ['first_date', 'second_date', 'long_term', 'reconnect'] },
      venueQuiet: { type: 'boolean' },
      vibe: { type: 'string', enum: [...DATE_VIBES] },
    },
  },
  handler: runDateGameTips,
};

// ── 4. date_plan_builder ─────────────────────────────────────────────

const candidateSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(60),
  /** opener / anchor / second_move / exit — caller may pre-classify. */
  role: z.enum(TIMELINE_ROLES).optional(),
  url: z.string().max(500).optional(),
  expectedSpend: z.string().max(60).optional(),
  rationale: z.string().max(280).optional(),
});

const planBuilderInput = z.object({
  city: z.string().min(1).max(120),
  candidates: z.array(candidateSchema).min(2).max(20),
  vibe: z.enum(DATE_VIBES).default('romantic'),
  budgetTier: z.enum(DATE_BUDGET_TIERS).default('medium'),
  /** Whether to include an optional second_move in the plan. */
  includeSecondMove: z.boolean().default(true),
  preferredTimeOfDay: z.enum(['afternoon', 'evening', 'late_night']).default('evening'),
});

export type DatePlanBuilderInput = z.infer<typeof planBuilderInput>;

export interface DatePlanStop {
  role: DateTimelineRole;
  name: string;
  category: string;
  url?: string;
  expectedSpend?: string;
  why: string;
}

export interface DatePlanBuilderResult {
  status: 'ok' | 'production_refused' | 'unavailable';
  message: string;
  city?: string;
  vibe?: DateVibe;
  budgetTier?: DateBudgetTier;
  plan?: DatePlanStop[];
  /** What to skip if energy fades — second_move first, then exit upgrade. */
  fallback?: string;
}

const ROLE_BIAS: Record<string, DateTimelineRole> = {
  cafe: 'opener',
  bakery: 'opener',
  wine_bar: 'opener',
  bar: 'opener',
  cocktail_bar: 'opener',
  gallery: 'opener',
  museum: 'opener',
  casual_restaurant: 'anchor',
  mid_restaurant: 'anchor',
  fine_restaurant: 'anchor',
  ramen: 'anchor',
  tasting_menu: 'anchor',
  jazz_club: 'second_move',
  concert: 'second_move',
  rooftop_bar: 'second_move',
  walk: 'exit',
  walk_home: 'exit',
  late_dessert: 'exit',
};

function inferRole(category: string): DateTimelineRole {
  return ROLE_BIAS[category] ?? 'anchor';
}

export async function runDatePlanBuilder(
  rawInput: DatePlanBuilderInput,
  ctx?: ToolContext
): Promise<DatePlanBuilderResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };

  const input = planBuilderInput.parse(rawInput);

  // Bucket candidates by role.
  const byRole: Record<DateTimelineRole, typeof input.candidates> = {
    opener: [],
    anchor: [],
    second_move: [],
    exit: [],
  };
  for (const c of input.candidates) {
    const role = c.role ?? inferRole(c.category);
    byRole[role].push({ ...c, role });
  }

  // Build plan: pick first available per role; opener + anchor required.
  if (byRole.opener.length === 0 || byRole.anchor.length === 0) {
    return {
      status: 'unavailable',
      message:
        'Date plan needs at least one opener AND one anchor candidate. Re-run with more options or pre-classify candidates with the `role` field.',
    };
  }

  const plan: DatePlanStop[] = [];
  const opener = byRole.opener[0]!;
  const anchor = byRole.anchor[0]!;
  plan.push({
    role: 'opener',
    name: opener.name,
    category: opener.category,
    ...(opener.url ? { url: opener.url } : {}),
    ...(opener.expectedSpend ? { expectedSpend: opener.expectedSpend } : {}),
    why: opener.rationale ?? 'Low-pressure opener — short, warm, easy to land.',
  });
  plan.push({
    role: 'anchor',
    name: anchor.name,
    category: anchor.category,
    ...(anchor.url ? { url: anchor.url } : {}),
    ...(anchor.expectedSpend ? { expectedSpend: anchor.expectedSpend } : {}),
    why: anchor.rationale ?? 'Anchor — chef-led food, focused room, matches the vibe.',
  });

  if (input.includeSecondMove && byRole.second_move.length > 0) {
    const second = byRole.second_move[0]!;
    plan.push({
      role: 'second_move',
      name: second.name,
      category: second.category,
      ...(second.url ? { url: second.url } : {}),
      ...(second.expectedSpend ? { expectedSpend: second.expectedSpend } : {}),
      why: second.rationale ?? 'Optional second move — only when energy is mutual.',
    });
  }

  if (byRole.exit.length > 0) {
    const exit = byRole.exit[0]!;
    plan.push({
      role: 'exit',
      name: exit.name,
      category: exit.category,
      ...(exit.url ? { url: exit.url } : {}),
      ...(exit.expectedSpend ? { expectedSpend: exit.expectedSpend } : {}),
      why: exit.rationale ?? 'Graceful exit — short, warm, no negotiation.',
    });
  } else {
    plan.push({
      role: 'exit',
      name: 'Walk to the corner',
      category: 'walk_home',
      why: 'No prebooked exit — a short walk lets either side step away when it feels right.',
    });
  }

  return {
    status: 'ok',
    city: input.city,
    vibe: input.vibe,
    budgetTier: input.budgetTier,
    plan,
    fallback:
      'If the energy fades after the anchor, drop the second_move and jump to a graceful exit. Always optional.',
    message: `${plan.length}-stop ${input.vibe} date plan in ${input.city} (${input.budgetTier} tier).`,
  };
}

const datePlanBuilderTool: ToolDef<DatePlanBuilderInput, DatePlanBuilderResult> = {
  name: 'date_plan_builder',
  internal: true,
  description:
    "Compose a multi-stop date plan from caller-supplied candidates. Each candidate has a name + category + optional pre-classified `role` (opener / anchor / second_move / exit). The tool buckets, picks the best per role, and emits a structured timeline with rationale + fallback guidance ('if energy fades, drop the second_move'). Use after sourcing candidates via `cheap_michelin_finder` / `wine_bar_finder` / `monocle_place_researcher`.",
  inputSchema: planBuilderInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'candidates'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      candidates: {
        type: 'array',
        minItems: 2,
        maxItems: 20,
        items: {
          type: 'object',
          required: ['name', 'category'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 160 },
            category: { type: 'string', maxLength: 60 },
            role: { type: 'string', enum: [...TIMELINE_ROLES] },
            url: { type: 'string', maxLength: 500 },
            expectedSpend: { type: 'string', maxLength: 60 },
            rationale: { type: 'string', maxLength: 280 },
          },
        },
      },
      vibe: { type: 'string', enum: [...DATE_VIBES] },
      budgetTier: { type: 'string', enum: [...DATE_BUDGET_TIERS] },
      includeSecondMove: { type: 'boolean' },
      preferredTimeOfDay: { type: 'string', enum: ['afternoon', 'evening', 'late_night'] },
    },
  },
  handler: runDatePlanBuilder,
};

// ── Barrel exports ───────────────────────────────────────────────────

export { dateBudgetOptimizerTool, datePerfumeAdvisorTool, dateGameTipsTool, datePlanBuilderTool };
