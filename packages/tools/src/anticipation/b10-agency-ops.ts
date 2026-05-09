/**
 * B10 — Agency Ops / Travel Team Automation (10 tools).
 *
 *   - supplier_quote_comparator       B10 #143 (pure)
 *   - manual_supplier_researcher      B10 #144 (CSE)
 *   - supplier_contact_extractor      B10 #145 (Vertex grounded)
 *   - supplier_reliability_score      B10 #146 (pure)
 *   - ops_followup_scheduler          B10 #147 (pure)
 *   - booking_gap_auditor             B10 #148 (pure)
 *   - handoff_context_builder         B10 #149 (pure composer)
 *   - post_trip_feedback_analyzer     B10 #150 (pure)
 *   - agency_margin_guard             B10 #151 (pure)
 *   - preferred_supplier_router       B10 #152 (pure)
 *
 * All experimental + internal + dev-gated.
 */

import { z } from 'zod';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import { cseSearch } from '@sendero/web-search';

import { assertDevOnlyToolAllowed } from '../dev-gate';
import type { ToolContext, ToolDef } from '../types';

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

// ── 1. supplier_quote_comparator (pure) ──────────────────────────────

const quoteComparatorInput = z.object({
  quotes: z
    .array(
      z.object({
        supplier: z.string().min(1).max(120),
        kind: z.enum(['flight', 'hotel', 'transfer', 'experience', 'package', 'other']),
        priceUsd: z.number().min(0).max(100_000),
        currency: z.string().length(3).default('USD'),
        deliverables: z.array(z.string().max(120)).max(8).optional(),
        cancellationTerms: z.string().max(200).optional(),
        depositPct: z.number().min(0).max(100).optional(),
        validityDays: z.number().int().min(1).max(365).optional(),
      })
    )
    .min(2)
    .max(20),
});
type QuoteComparatorInput = z.infer<typeof quoteComparatorInput>;

const supplierQuoteComparatorTool: ToolDef = {
  name: 'supplier_quote_comparator',
  internal: true,
  experimental: true,
  description:
    'Compare supplier quotes side-by-side. Pure tool — caller passes quotes[] with price + terms + deliverables. Returns ranked list (cheapest first) + flags (deposit > 50%, validity < 7 days, missing terms). Use during agency RFQ review.',
  inputSchema: quoteComparatorInput,
  jsonSchema: {
    type: 'object',
    required: ['quotes'],
    properties: { quotes: { type: 'array', minItems: 2, maxItems: 20 } },
  },
  handler: async (rawInput: QuoteComparatorInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = quoteComparatorInput.parse(rawInput);
    const ranked = input.quotes
      .map(q => {
        const flags: string[] = [];
        if (typeof q.depositPct === 'number' && q.depositPct > 50)
          flags.push(`deposit ${q.depositPct}% > 50% — chase soft-hold first`);
        if (typeof q.validityDays === 'number' && q.validityDays < 7)
          flags.push(`validity ${q.validityDays}d — too short for traveler decision cycle`);
        if (!q.cancellationTerms) flags.push('cancellation terms missing — never accept without');
        if (!q.deliverables || q.deliverables.length === 0)
          flags.push('deliverables missing — request line-item breakdown');
        return { ...q, flags };
      })
      .sort((a, b) => a.priceUsd - b.priceUsd);

    const cheapest = ranked[0]!;
    const second = ranked[1];
    const delta = second ? second.priceUsd - cheapest.priceUsd : 0;

    return {
      status: 'ok' as const,
      ranked,
      cheapest,
      delta,
      message: `${ranked.length} quotes ranked; cheapest: ${cheapest.supplier} ($${cheapest.priceUsd}). Spread to next: $${delta}.`,
    };
  },
};

// ── 2. manual_supplier_researcher ────────────────────────────────────

const manualSupplierInput = z.object({
  city: z.string().min(1).max(120),
  countryCode: z.string().length(2).optional(),
  serviceKind: z.enum([
    'transfer',
    'guide',
    'driver',
    'wedding_planner',
    'event_planner',
    'photographer',
    'translator',
    'medical_concierge',
    'private_chef',
  ]),
  languageCode: z.string().max(10).default('en'),
  limit: z.number().int().min(1).max(15).default(8),
});
type ManualSupplierInput = z.infer<typeof manualSupplierInput>;

const manualSupplierResearcherTool: ToolDef = {
  name: 'manual_supplier_researcher',
  internal: true,
  experimental: true,
  description:
    "Find local suppliers for services that don't have an API — drivers, guides, wedding/event planners, photographers, translators, medical concierge, private chefs. CSE-led search. Use for the long tail of agency operations.",
  inputSchema: manualSupplierInput,
  jsonSchema: {
    type: 'object',
    required: ['city', 'serviceKind'],
    properties: {
      city: { type: 'string', minLength: 1, maxLength: 120 },
      countryCode: { type: 'string', minLength: 2, maxLength: 2 },
      serviceKind: {
        type: 'string',
        enum: [
          'transfer',
          'guide',
          'driver',
          'wedding_planner',
          'event_planner',
          'photographer',
          'translator',
          'medical_concierge',
          'private_chef',
        ],
      },
      languageCode: { type: 'string', maxLength: 10 },
      limit: { type: 'integer', minimum: 1, maximum: 15 },
    },
  },
  handler: async (rawInput: ManualSupplierInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = manualSupplierInput.parse(rawInput);
    const r = await cseSearch({
      query: `${input.serviceKind.replace(/_/g, ' ')} ${input.city}`,
      limit: input.limit + 4,
      lang: input.languageCode,
      ...(input.countryCode ? { country: input.countryCode } : {}),
    });
    if (!r.available)
      return {
        status: 'unavailable' as const,
        message: `CSE unavailable: ${r.reason ?? 'unknown'}.`,
      };
    const suppliers = r.results.slice(0, input.limit).map(hit => ({
      name: hit.title.trim(),
      url: hit.link,
      snippet: hit.snippet,
      sourceHost: hit.displayLink,
    }));
    return {
      status: 'ok' as const,
      suppliers,
      message: `${suppliers.length} ${input.serviceKind} candidates in ${input.city}.`,
    };
  },
};

// ── 3. supplier_contact_extractor (Vertex grounded) ──────────────────

const contactExtractorInput = z.object({
  supplierUrl: z.string().url(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type ContactExtractorInput = z.infer<typeof contactExtractorInput>;

const contactExtractShape = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  formUrl: z.string().nullable(),
  hours: z.string().nullable(),
  responseTimeNote: z.string().nullable(),
});

const supplierContactExtractorTool: ToolDef = {
  name: 'supplier_contact_extractor',
  internal: true,
  experimental: true,
  description:
    'Extract contact channels (email / phone / WhatsApp / form / hours / typical response time) from a supplier URL. Vertex-grounded with Gateway fallback. Use after `manual_supplier_researcher` returns candidates.',
  inputSchema: contactExtractorInput,
  jsonSchema: {
    type: 'object',
    required: ['supplierUrl'],
    properties: {
      supplierUrl: { type: 'string', format: 'uri' },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: ContactExtractorInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = contactExtractorInput.parse(rawInput);

    const prompt = `Look up the contact channels for the supplier at ${input.supplierUrl}. Extract: email address, phone number (E.164 if visible), WhatsApp number, contact form URL, hours of operation, typical response time. Pull only from the official site at that URL. Return null for any field not visible.`;
    const coercePrompt = (text: string, _: string[]) =>
      `Coerce into contact extract schema. Locale: ${input.locale}.\n\nReport:\n"""\n${text}\n"""`;

    const vertex = resolveVertex();
    async function viaPath(modelLike: any, providerOptions?: any) {
      const grounded = await generateText({
        model: modelLike,
        tools: {
          google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
        },
        prompt,
        ...(providerOptions ? { providerOptions } : {}),
      });
      const text = grounded.text?.trim() ?? '';
      if (!text) return null;
      const coerced = await generateObject({
        model: modelLike,
        schema: contactExtractShape,
        prompt: coercePrompt(text, []),
        ...(providerOptions ? { providerOptions } : {}),
      });
      return coerced.object;
    }
    if (vertex) {
      try {
        const obj = await viaPath(vertex(VERTEX_MODEL_ID));
        if (obj)
          return {
            status: 'ok' as const,
            contact: obj,
            via: 'vertex' as const,
            message: `Contact extracted via Vertex.`,
          };
      } catch {}
    }
    try {
      const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
      if (obj)
        return {
          status: 'ok' as const,
          contact: obj,
          via: 'gateway' as const,
          message: `Contact extracted via gateway.`,
        };
      return { status: 'unavailable' as const, message: 'No grounded contact data returned.' };
    } catch (err) {
      return {
        status: 'unavailable' as const,
        message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
      };
    }
  },
};

// ── 4. supplier_reliability_score (pure) ─────────────────────────────

const reliabilityInput = z.object({
  supplier: z.string().min(1).max(120),
  publicSignals: z.object({
    avgRating: z.number().min(0).max(5).optional(),
    reviewCount: z.number().int().min(0).max(1_000_000).optional(),
    yearsInBusiness: z.number().int().min(0).max(100).optional(),
    websiteHttps: z.boolean().optional(),
  }),
  internalFeedback: z.object({
    pastEngagements: z.number().int().min(0).max(1000).default(0),
    onTimeRate: z.number().min(0).max(1).optional(),
    travelerSatisfaction: z.number().min(0).max(5).optional(),
    issueCount: z.number().int().min(0).max(100).default(0),
  }),
});
type ReliabilityInput = z.infer<typeof reliabilityInput>;

const supplierReliabilityScoreTool: ToolDef = {
  name: 'supplier_reliability_score',
  internal: true,
  experimental: true,
  description:
    "Score a supplier's reliability from public signals + internal feedback. Pure formula — public weight 40% (rating × log10(reviews+1) × hsweb), internal weight 60% (onTime × satisfaction × penalty for issues). Returns 0-100 + flags.",
  inputSchema: reliabilityInput,
  jsonSchema: {
    type: 'object',
    required: ['supplier', 'publicSignals', 'internalFeedback'],
    properties: {
      supplier: { type: 'string', minLength: 1, maxLength: 120 },
      publicSignals: { type: 'object' },
      internalFeedback: { type: 'object' },
    },
  },
  handler: async (rawInput: ReliabilityInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = reliabilityInput.parse(rawInput);

    let publicScore = 0;
    if (input.publicSignals.avgRating && input.publicSignals.reviewCount) {
      publicScore = Math.min(
        1,
        ((input.publicSignals.avgRating / 5) * Math.log10(input.publicSignals.reviewCount + 1)) /
          2.5
      );
    }
    if (input.publicSignals.websiteHttps === false) publicScore -= 0.1;
    publicScore = Math.max(0, Math.min(1, publicScore));

    let internalScore = 0;
    if (input.internalFeedback.pastEngagements >= 1) {
      const onTime = input.internalFeedback.onTimeRate ?? 0.85;
      const sat = (input.internalFeedback.travelerSatisfaction ?? 4) / 5;
      const issuePenalty = Math.min(0.4, input.internalFeedback.issueCount / 10);
      internalScore = Math.max(0, Math.min(1, onTime * 0.5 + sat * 0.5 - issuePenalty));
    }

    const combined =
      input.internalFeedback.pastEngagements > 0
        ? publicScore * 0.4 + internalScore * 0.6
        : publicScore;

    const score100 = Math.round(combined * 100);
    const flags: string[] = [];
    if (publicScore < 0.3) flags.push('Weak public signal — request references.');
    if (input.internalFeedback.issueCount >= 3)
      flags.push(
        `${input.internalFeedback.issueCount} prior issues on file — escalate to ops review.`
      );
    if (input.internalFeedback.pastEngagements === 0)
      flags.push('No prior engagement — start with low-stakes booking.');

    return {
      status: 'ok' as const,
      score: score100,
      publicScore,
      internalScore,
      flags,
      message: `${input.supplier}: ${score100}/100 (${flags.length} flags).`,
    };
  },
};

// ── 5. ops_followup_scheduler (pure) ─────────────────────────────────

const followupInput = z.object({
  contextKind: z.enum([
    'quote_pending',
    'docs_pending',
    'payment_pending',
    'check_in_window',
    'post_trip',
    'feedback_pending',
  ]),
  lastTouchIso: z.string(),
  travelerName: z.string().min(1).max(120).optional(),
  notesShort: z.string().max(280).optional(),
});
type FollowupInput = z.infer<typeof followupInput>;

const opsFollowupSchedulerTool: ToolDef = {
  name: 'ops_followup_scheduler',
  internal: true,
  experimental: true,
  description:
    'Schedule the next ops follow-up given a context kind + last-touch timestamp. Pure rules — returns next action + nextTouchIso. Use to drive the ops dashboard "what to do today" queue.',
  inputSchema: followupInput,
  jsonSchema: {
    type: 'object',
    required: ['contextKind', 'lastTouchIso'],
    properties: {
      contextKind: {
        type: 'string',
        enum: [
          'quote_pending',
          'docs_pending',
          'payment_pending',
          'check_in_window',
          'post_trip',
          'feedback_pending',
        ],
      },
      lastTouchIso: { type: 'string' },
      travelerName: { type: 'string', minLength: 1, maxLength: 120 },
      notesShort: { type: 'string', maxLength: 280 },
    },
  },
  handler: async (rawInput: FollowupInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = followupInput.parse(rawInput);
    const last = Date.parse(input.lastTouchIso);
    if (!Number.isFinite(last)) return { status: 'ok' as const, message: 'Invalid lastTouchIso.' };

    const NEXT_OFFSET_HOURS: Record<FollowupInput['contextKind'], number> = {
      quote_pending: 48,
      docs_pending: 24,
      payment_pending: 24,
      check_in_window: 12,
      post_trip: 48,
      feedback_pending: 96,
    };
    const ACTIONS: Record<FollowupInput['contextKind'], string> = {
      quote_pending: 'Resend the quote with a soft 7-day deadline.',
      docs_pending: 'Ask for the missing document with a single, specific request.',
      payment_pending: 'Send payment-link reminder; offer alt rail if friction.',
      check_in_window: 'Confirm flight + send arrival playbook.',
      post_trip: 'Send post-trip thank you + feedback request.',
      feedback_pending: 'Single follow-up; if no response, archive.',
    };
    const offset = NEXT_OFFSET_HOURS[input.contextKind];
    const next = new Date(last + offset * 3600_000);

    return {
      status: 'ok' as const,
      nextTouchIso: next.toISOString(),
      action: ACTIONS[input.contextKind],
      message: `Follow up at ${next.toISOString()}: ${ACTIONS[input.contextKind]}`,
    };
  },
};

// ── 6. booking_gap_auditor (pure) ────────────────────────────────────

const gapAuditorInput = z.object({
  trip: z.object({
    travelerId: z.string().max(120),
    passportOnFile: z.boolean(),
    passportExpiryIso: z.string().optional(),
    passengerCountConfirmed: z.boolean(),
    hotelCheckInConfirmed: z.boolean(),
    transferLocationKnown: z.boolean(),
    invoiceIssued: z.boolean(),
    receiptsCount: z.number().int().min(0),
    flightDepartureIso: z.string().optional(),
  }),
});
type GapAuditorInput = z.infer<typeof gapAuditorInput>;

const bookingGapAuditorTool: ToolDef = {
  name: 'booking_gap_auditor',
  internal: true,
  experimental: true,
  description:
    'Audit a booking for missing info before it goes live: passport, passenger count, hotel check-in, transfer location, invoice, receipts. Pure rules. Use as a pre-flight check before settlement.',
  inputSchema: gapAuditorInput,
  jsonSchema: {
    type: 'object',
    required: ['trip'],
    properties: { trip: { type: 'object' } },
  },
  handler: async (rawInput: GapAuditorInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = gapAuditorInput.parse(rawInput);
    const t = input.trip;
    const gaps: string[] = [];
    if (!t.passportOnFile) gaps.push('Passport not on file.');
    if (t.passportOnFile && t.passportExpiryIso) {
      const expiry = Date.parse(t.passportExpiryIso);
      if (Number.isFinite(expiry) && expiry < Date.now() + 6 * 30 * 86_400_000) {
        gaps.push('Passport expires within 6 months — most countries reject.');
      }
    }
    if (!t.passengerCountConfirmed) gaps.push('Passenger count not confirmed.');
    if (!t.hotelCheckInConfirmed) gaps.push('Hotel check-in details not confirmed.');
    if (!t.transferLocationKnown) gaps.push('Transfer pickup location not set.');
    if (!t.invoiceIssued)
      gaps.push('Invoice not yet issued — corporate clients may need before departure.');
    if (t.receiptsCount === 0) gaps.push('No receipts on file yet.');

    const blocking = gaps.filter(g => /passport|passenger count|check-in|transfer/i.test(g));
    return {
      status: 'ok' as const,
      gaps,
      blocking,
      pctComplete: Math.round(((7 - gaps.length) / 7) * 100),
      message:
        gaps.length === 0
          ? 'No gaps — trip is ready.'
          : `${gaps.length} gaps (${blocking.length} blocking).`,
    };
  },
};

// ── 7. handoff_context_builder (pure composer) ───────────────────────

const handoffContextInput = z.object({
  travelerId: z.string().max(120),
  channelKind: z.enum(['whatsapp', 'slack', 'web', 'email']),
  topic: z.string().min(1).max(200),
  recentTurns: z
    .array(z.object({ role: z.enum(['user', 'agent']), text: z.string().max(800) }))
    .max(8),
  toolsUsed: z.array(z.string().max(60)).max(15),
  lastError: z.string().max(400).optional(),
  travelerProfile: z
    .object({
      name: z.string().max(120).optional(),
      locale: z.string().max(10).optional(),
      nationality: z.string().length(2).optional(),
      activeTripId: z.string().max(120).optional(),
    })
    .optional(),
});
type HandoffContextInput = z.infer<typeof handoffContextInput>;

const handoffContextBuilderTool: ToolDef = {
  name: 'handoff_context_builder',
  internal: true,
  experimental: true,
  description:
    'Build the handoff context bundle for a human operator — channel, topic, recent turns, tools used, last error, traveler profile. Pure tool. Returns a structured payload AND a 1-screen summary text. Compose with `request_human_handoff`.',
  inputSchema: handoffContextInput,
  jsonSchema: {
    type: 'object',
    required: ['travelerId', 'channelKind', 'topic', 'recentTurns', 'toolsUsed'],
    properties: {
      travelerId: { type: 'string', maxLength: 120 },
      channelKind: { type: 'string', enum: ['whatsapp', 'slack', 'web', 'email'] },
      topic: { type: 'string', minLength: 1, maxLength: 200 },
      recentTurns: { type: 'array', maxItems: 8 },
      toolsUsed: { type: 'array', maxItems: 15 },
      lastError: { type: 'string', maxLength: 400 },
      travelerProfile: { type: 'object' },
    },
  },
  handler: async (rawInput: HandoffContextInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = handoffContextInput.parse(rawInput);
    const lines: string[] = [];
    lines.push(`**Topic:** ${input.topic}`);
    lines.push(`**Channel:** ${input.channelKind}`);
    if (input.travelerProfile?.name)
      lines.push(
        `**Traveler:** ${input.travelerProfile.name}${input.travelerProfile.nationality ? ` (${input.travelerProfile.nationality})` : ''}`
      );
    if (input.travelerProfile?.activeTripId)
      lines.push(`**Active trip:** ${input.travelerProfile.activeTripId}`);
    lines.push(`**Tools attempted:** ${input.toolsUsed.join(', ')}`);
    if (input.lastError) lines.push(`**Last error:** ${input.lastError}`);
    lines.push('**Recent turns:**');
    for (const t of input.recentTurns) {
      lines.push(`  ${t.role === 'user' ? '→' : '←'} ${t.text.slice(0, 180)}`);
    }
    return {
      status: 'ok' as const,
      payload: input,
      summaryText: lines.join('\n'),
      message: `Handoff context built (${input.recentTurns.length} turns, ${input.toolsUsed.length} tools).`,
    };
  },
};

// ── 8. post_trip_feedback_analyzer (pure) ────────────────────────────

const feedbackAnalyzerInput = z.object({
  feedback: z.string().min(1).max(2000),
  trip: z.object({
    travelerId: z.string().max(120),
    suppliers: z.array(z.string().max(120)).max(15),
    rating: z.number().min(0).max(5).optional(),
  }),
});
type FeedbackAnalyzerInput = z.infer<typeof feedbackAnalyzerInput>;

const postTripFeedbackAnalyzerTool: ToolDef = {
  name: 'post_trip_feedback_analyzer',
  internal: true,
  experimental: true,
  description:
    'Turn raw post-trip feedback into structured supplier scores + traveler preference inferences. Pure pattern-matching. Use after the trip closes to update both supplier reliability and the traveler taste graph.',
  inputSchema: feedbackAnalyzerInput,
  jsonSchema: {
    type: 'object',
    required: ['feedback', 'trip'],
    properties: {
      feedback: { type: 'string', minLength: 1, maxLength: 2000 },
      trip: { type: 'object' },
    },
  },
  handler: async (rawInput: FeedbackAnalyzerInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = feedbackAnalyzerInput.parse(rawInput);
    const fb = input.feedback;
    const fbLower = fb.toLowerCase();

    const supplierScores: Array<{
      supplier: string;
      sentiment: 'positive' | 'mixed' | 'negative' | 'unmentioned';
    }> = [];
    for (const s of input.trip.suppliers) {
      const sLower = s.toLowerCase();
      const idx = fbLower.indexOf(sLower);
      if (idx === -1) {
        supplierScores.push({ supplier: s, sentiment: 'unmentioned' });
        continue;
      }
      const window = fb.slice(Math.max(0, idx - 80), idx + sLower.length + 80).toLowerCase();
      const positiveTokens = [
        'great',
        'amazing',
        'excellent',
        'love',
        'perfect',
        'recommend',
        'incredible',
      ];
      const negativeTokens = [
        'bad',
        'terrible',
        'rude',
        'late',
        'cancelled',
        'lost',
        'worst',
        'never again',
      ];
      const pos = positiveTokens.some(t => window.includes(t));
      const neg = negativeTokens.some(t => window.includes(t));
      const sentiment: 'positive' | 'mixed' | 'negative' =
        pos && neg ? 'mixed' : neg ? 'negative' : pos ? 'positive' : 'mixed';
      supplierScores.push({ supplier: s, sentiment });
    }

    const inferredPreferences: string[] = [];
    if (/loved|amazing|great/.test(fbLower) && /coffee/i.test(fbLower))
      inferredPreferences.push('specialty_coffee:positive');
    if (/loved|amazing/.test(fbLower) && /ramen/i.test(fbLower))
      inferredPreferences.push('ramen:positive');
    if (/skip|avoid|won't/.test(fbLower) && /touristy|crowded/i.test(fbLower))
      inferredPreferences.push('avoid:touristy_crowded');
    if (/quiet|cozy|warm/.test(fbLower)) inferredPreferences.push('ambience:quiet');
    if (/loud|crowded|chaotic/.test(fbLower)) inferredPreferences.push('avoid:loud');

    return {
      status: 'ok' as const,
      supplierScores,
      inferredPreferences,
      sentimentGlobal:
        typeof input.trip.rating === 'number' && input.trip.rating < 3
          ? 'negative'
          : input.trip.rating && input.trip.rating >= 4
            ? 'positive'
            : 'mixed',
      message: `Analyzed ${supplierScores.length} suppliers + ${inferredPreferences.length} inferred preferences.`,
    };
  },
};

// ── 9. agency_margin_guard (pure) ────────────────────────────────────

const marginGuardInput = z.object({
  cogs: z.number().min(0).max(1_000_000),
  proposedPriceUsd: z.number().min(0).max(1_000_000),
  policy: z.object({
    minMarkupBps: z.number().int().min(0).max(10_000).default(500),
    maxMarkupBps: z.number().int().min(0).max(20_000).default(3500),
    minMarginUsd: z.number().min(0).max(100_000).default(50),
  }),
  context: z.enum(['individual', 'corporate', 'wholesale']).default('individual'),
});
type MarginGuardInput = z.infer<typeof marginGuardInput>;

const agencyMarginGuardTool: ToolDef = {
  name: 'agency_margin_guard',
  internal: true,
  description:
    'Check that a proposed price meets agency margin policy. Pure rules — flags markups below floor / above ceiling / negative margin / missing minimum-margin. Compose before quotes go to clients.',
  inputSchema: marginGuardInput,
  jsonSchema: {
    type: 'object',
    required: ['cogs', 'proposedPriceUsd', 'policy'],
    properties: {
      cogs: { type: 'number', minimum: 0, maximum: 1000000 },
      proposedPriceUsd: { type: 'number', minimum: 0, maximum: 1000000 },
      policy: { type: 'object' },
      context: { type: 'string', enum: ['individual', 'corporate', 'wholesale'] },
    },
  },
  handler: async (rawInput: MarginGuardInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = marginGuardInput.parse(rawInput);
    const margin = input.proposedPriceUsd - input.cogs;
    const markupBps = input.cogs > 0 ? Math.round((margin / input.cogs) * 10_000) : 0;

    const flags: string[] = [];
    let verdict: 'approved' | 'flagged' | 'rejected' = 'approved';
    if (margin < 0) {
      verdict = 'rejected';
      flags.push(`Negative margin: $${margin}.`);
    } else if (margin < input.policy.minMarginUsd) {
      verdict = 'flagged';
      flags.push(`Margin $${margin} < min $${input.policy.minMarginUsd}.`);
    }
    if (markupBps < input.policy.minMarkupBps) {
      verdict = verdict === 'rejected' ? verdict : 'flagged';
      flags.push(
        `Markup ${(markupBps / 100).toFixed(1)}% < min ${input.policy.minMarkupBps / 100}%.`
      );
    }
    if (markupBps > input.policy.maxMarkupBps) {
      verdict = 'rejected';
      flags.push(
        `Markup ${(markupBps / 100).toFixed(1)}% > max ${input.policy.maxMarkupBps / 100}%.`
      );
    }
    return {
      status: 'ok' as const,
      verdict,
      marginUsd: margin,
      markupBps,
      flags,
      message: `${verdict.toUpperCase()}: margin $${margin}, markup ${(markupBps / 100).toFixed(1)}% (${flags.length} flags).`,
    };
  },
};

// ── 10. preferred_supplier_router (pure) ─────────────────────────────

const supplierRouterInput = z.object({
  candidates: z
    .array(
      z.object({
        supplier: z.string().min(1).max(120),
        priceUsd: z.number().min(0).max(100_000),
        kind: z.string().max(60),
        isPreferred: z.boolean().default(false),
        reliabilityScore: z.number().int().min(0).max(100).optional(),
      })
    )
    .min(2)
    .max(20),
  policy: z.object({
    preferenceTiltPct: z.number().min(0).max(50).default(8),
    minReliability: z.number().int().min(0).max(100).default(60),
  }),
});
type SupplierRouterInput = z.infer<typeof supplierRouterInput>;

const preferredSupplierRouterTool: ToolDef = {
  name: 'preferred_supplier_router',
  internal: true,
  experimental: true,
  description:
    'Route to agency-preferred suppliers when within policy tilt. Pure rules — picks the best of: (a) cheapest preferred supplier within `preferenceTiltPct` of overall cheapest, (b) cheapest supplier above `minReliability`. Use to honor commercial agreements without sacrificing cost discipline.',
  inputSchema: supplierRouterInput,
  jsonSchema: {
    type: 'object',
    required: ['candidates', 'policy'],
    properties: {
      candidates: { type: 'array', minItems: 2, maxItems: 20 },
      policy: { type: 'object' },
    },
  },
  handler: async (rawInput: SupplierRouterInput, ctx) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = supplierRouterInput.parse(rawInput);

    // Filter by reliability when scores are provided.
    const eligible = input.candidates.filter(
      c => c.reliabilityScore == null || c.reliabilityScore >= input.policy.minReliability
    );
    if (eligible.length === 0) {
      return {
        status: 'ok' as const,
        message: 'No supplier passes reliability gate; widen policy or escalate.',
      };
    }

    const sorted = [...eligible].sort((a, b) => a.priceUsd - b.priceUsd);
    const cheapest = sorted[0]!;
    const tilt = input.policy.preferenceTiltPct / 100;
    const tiltedCap = cheapest.priceUsd * (1 + tilt);
    const cheapestPreferred = sorted.find(c => c.isPreferred && c.priceUsd <= tiltedCap);

    const winner = cheapestPreferred ?? cheapest;
    const reasons: string[] = [];
    if (cheapestPreferred)
      reasons.push(
        `Preferred supplier ${cheapestPreferred.supplier} within ${input.policy.preferenceTiltPct}% of cheapest.`
      );
    else reasons.push('No preferred supplier within tilt; routing to cheapest.');
    if (winner.reliabilityScore !== undefined)
      reasons.push(`Reliability score ${winner.reliabilityScore}/100.`);
    return {
      status: 'ok' as const,
      winner,
      cheapestOverall: cheapest,
      reasons,
      message: `Route to ${winner.supplier} ($${winner.priceUsd}) — ${reasons.join(' ')}`,
    };
  },
};

// ── exports ──────────────────────────────────────────────────────────

export {
  supplierQuoteComparatorTool,
  manualSupplierResearcherTool,
  supplierContactExtractorTool,
  supplierReliabilityScoreTool,
  opsFollowupSchedulerTool,
  bookingGapAuditorTool,
  handoffContextBuilderTool,
  postTripFeedbackAnalyzerTool,
  agencyMarginGuardTool,
  preferredSupplierRouterTool,
};
