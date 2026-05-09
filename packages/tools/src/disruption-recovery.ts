/**
 * disruption_recovery — workflow for the "grandfather can't travel" gap.
 *
 * The wedge: airlines often have undocumented bereavement / serious-illness
 * / legal-hardship waivers that ops folks invoke by phone, but Duffel's
 * fare rules surface only the marketed cancel/change conditions. A
 * traveler hitting "non-refundable" gets told $0 by the API while the
 * airline would actually grant a waiver if asked the right way.
 *
 * This file ships 5 tools + 1 orchestrator that try every recoverable
 * path before falling back to a structured ops handoff:
 *
 *   1. classify_disruption_situation — pure. Maps free-text into a
 *      DisruptionKind enum + recommended path order.
 *   2. research_compassionate_exception_policy — Vertex-grounded against
 *      the airline's bereavement / hardship / illness pages.
 *   3. build_insurance_claim_packet — pure. Bundles facts + narrative
 *      for the traveler's insurer (Cap or 3rd-party).
 *   4. trip_disruption_recovery — the orchestrator. Reads fare rules,
 *      tries Duffel voluntary refund → Duffel change → compassionate
 *      research → insurance packet → ops handoff. Returns a multi-step
 *      "case file" the agent can quote.
 *   5. recovery_case_file_renderer — pure. Formats the case file as a
 *      handoff-ready Slack/email block for ops.
 *
 * **Experimental** + **internal** + dev-gated. Composes existing
 * Duffel tools (`display_offer_conditions`, `cancel_order_quote`,
 * `request_order_change`) and `request_human_handoff` — does NOT
 * duplicate them. The orchestrator hands the agent a chain to run, not
 * the side effects themselves; this keeps each individual operation
 * traceable + auditable in Phoenix.
 */

import { z } from 'zod';
import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';

import { assertDevOnlyToolAllowed } from './dev-gate';
import type { ToolContext, ToolDef } from './types';

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

// ─────────────────────────────────────────────────────────────────────
// 1. classify_disruption_situation
// Pure rules-based classifier over free-text describing the situation.
// ─────────────────────────────────────────────────────────────────────

export const DISRUPTION_KINDS = [
  'bereavement', // immediate-family death — airlines often have explicit policies
  'serious_illness', // self or immediate family — most airlines waiver-friendly
  'legal_hold', // court order / passport seized / detained — waiver-friendly with docs
  'military_orders', // active-duty change — explicit policy at most carriers
  'natural_disaster', // home/destination affected — sometimes auto-waived
  'visa_denied', // entry denied / visa rejected — usually rebooking only
  'force_majeure_other', // war / civil unrest / pandemic
  'voluntary_no_refund_fare', // simple "I changed my mind" on a non-refundable fare
  'missed_connection', // operational, separate flow exists
  'other',
] as const;
export type DisruptionKind = (typeof DISRUPTION_KINDS)[number];

const classifyInput = z.object({
  /** Free-text from the traveler describing what happened. */
  description: z.string().min(3).max(2000),
  /** Optional: when did the disruption become known? Drives time-to-departure logic. */
  disruptionAtIso: z.string().optional(),
  /** Optional: planned departure. */
  departureAtIso: z.string().optional(),
});
export type ClassifyDisruptionInput = z.infer<typeof classifyInput>;

interface RecoveryPath {
  step:
    | 'check_fare_rules'
    | 'duffel_voluntary_refund'
    | 'duffel_change'
    | 'compassionate_exception'
    | 'insurance_claim'
    | 'ops_handoff';
  why: string;
}

export interface ClassifyDisruptionResult {
  status: 'ok' | 'production_refused';
  message: string;
  kind?: DisruptionKind;
  confidence?: 'low' | 'medium' | 'high';
  needsDocumentation?: string[];
  recommendedPath?: RecoveryPath[];
  hoursToDeparture?: number | null;
  /** Quoted fragments that drove the classification. */
  evidence?: string[];
}

const KIND_PATTERNS: Array<{ kind: DisruptionKind; patterns: RegExp[]; needs: string[] }> = [
  {
    kind: 'bereavement',
    patterns: [
      /\b(passed away|died|death|funeral|fallec|murió|murio|falleció|deceased|familia con mucho dolor|loss of|condolencias)\b/i,
    ],
    needs: ['death certificate', 'relationship-to-deceased proof'],
  },
  {
    kind: 'serious_illness',
    patterns: [
      /\b(hospitaliz|surgery|cirug|emergency room|enfermedad grave|grave illness|cáncer|cancer|stroke|accidente|accident)\b/i,
    ],
    needs: ['doctor letter on letterhead', 'admission/discharge records'],
  },
  {
    kind: 'legal_hold',
    patterns: [
      /\b(legal issue|court order|prohibición|prohibicion|impedimento legal|detained|arrest|passport seized|orden judicial|tribunal|migraciones)\b/i,
    ],
    needs: ['court document', 'official ID-detention letter'],
  },
  {
    kind: 'military_orders',
    patterns: [/\b(military orders|active duty|deployment|órdenes militares|despliegue)\b/i],
    needs: ['unit-issued orders document'],
  },
  {
    kind: 'natural_disaster',
    patterns: [
      /\b(hurricane|earthquake|terremoto|huracán|wildfire|flood|tsunami|volcanic|erupción)\b/i,
    ],
    needs: ['government advisory or local-news source for the event'],
  },
  {
    kind: 'visa_denied',
    patterns: [
      /\b(visa denied|denied entry|visa rechazada|rechazaron la visa|negaron la visa|consular refusal)\b/i,
    ],
    needs: ['consulate denial letter', 'passport copy'],
  },
  {
    kind: 'force_majeure_other',
    patterns: [
      /\b(war|civil unrest|coup|pandemic|state of emergency|estado de emergencia|toque de queda)\b/i,
    ],
    needs: ['government advisory referencing the event'],
  },
  {
    kind: 'missed_connection',
    patterns: [/\b(missed connection|misconnect|connection lost|perdimos.*conexión|misconnex)\b/i],
    needs: ['original boarding passes', 'inbound delay receipt'],
  },
  {
    kind: 'voluntary_no_refund_fare',
    patterns: [
      /\b(changed my mind|cambié de opinión|don't want to go anymore|no quiero ir|cambio de planes)\b/i,
    ],
    needs: [],
  },
];

/**
 * Priority order for tiebreaks — more actionable / specific kinds win
 * over softer signals. `legal_hold` beats `bereavement` when both
 * match because "impedimento legal" is the actionable cause; "familia
 * con dolor" is reaction language that often co-occurs with any
 * disruption. Real abuelo case: the family chat carried both signals
 * and an early version of this classifier picked the wrong one.
 */
const KIND_PRIORITY: Record<DisruptionKind, number> = {
  legal_hold: 9,
  serious_illness: 8,
  military_orders: 8,
  visa_denied: 7,
  natural_disaster: 6,
  force_majeure_other: 6,
  bereavement: 5,
  missed_connection: 4,
  voluntary_no_refund_fare: 2,
  other: 0,
};

function pickKindFromText(
  text: string
): { kind: DisruptionKind; matches: string[]; needs: string[] } | null {
  const scored = KIND_PATTERNS.map(entry => {
    const hits: string[] = [];
    for (const p of entry.patterns) {
      const m = text.match(p);
      if (m) hits.push(m[0]);
    }
    return { entry, hits };
  }).filter(s => s.hits.length > 0);

  if (scored.length === 0) return null;

  // Sort by (hits desc, priority desc). The hit count favors specific
  // matches; priority breaks ties toward actionable kinds.
  scored.sort((a, b) => {
    if (b.hits.length !== a.hits.length) return b.hits.length - a.hits.length;
    return KIND_PRIORITY[b.entry.kind] - KIND_PRIORITY[a.entry.kind];
  });

  const top = scored[0]!;
  return { kind: top.entry.kind, matches: top.hits, needs: top.entry.needs };
}

function recommendedPathFor(kind: DisruptionKind, hoursToDeparture: number | null): RecoveryPath[] {
  const beforeDep = hoursToDeparture === null || hoursToDeparture > 0;
  // Universal: always read fare rules first — frees the cheap path when fare is generous.
  const path: RecoveryPath[] = [
    {
      step: 'check_fare_rules',
      why: 'Read what the fare actually allows before assuming non-refundable.',
    },
  ];

  switch (kind) {
    case 'bereavement':
    case 'serious_illness':
    case 'legal_hold':
    case 'military_orders':
      path.push(
        {
          step: 'duffel_voluntary_refund',
          why: 'Some "non-refundable" fares allow refund within 24h or with hardship — try the API first.',
        },
        {
          step: 'compassionate_exception',
          why: `${kind.replace(/_/g, ' ')} typically qualifies for an airline waiver — research the specific policy.`,
        },
        {
          step: 'duffel_change',
          why: 'If waiver denied, push the date to a future window with documented hardship; some waive the change fee.',
        },
        {
          step: 'insurance_claim',
          why: 'Trip-cancellation insurance covers this kind of disruption; build the packet regardless of airline outcome.',
        },
        {
          step: 'ops_handoff',
          why: 'Phone agents can invoke waivers the API cannot — escalate with full case file.',
        }
      );
      break;
    case 'natural_disaster':
    case 'force_majeure_other':
      path.push(
        {
          step: 'duffel_voluntary_refund',
          why: 'Mass-disruption events often trigger automatic airline waivers visible in Duffel.',
        },
        {
          step: 'compassionate_exception',
          why: "Check the airline's travel-advisory page for the specific event.",
        },
        { step: 'duffel_change', why: 'Airlines usually waive change fees for advisory events.' },
        {
          step: 'insurance_claim',
          why: 'Force majeure is typically covered by trip-cancellation insurance.',
        },
        {
          step: 'ops_handoff',
          why: 'For complex multi-leg disruptions ops can rebook on partner carriers.',
        }
      );
      break;
    case 'visa_denied':
      path.push(
        {
          step: 'duffel_voluntary_refund',
          why: 'Some carriers refund on documented visa denial; try the cheap path first.',
        },
        { step: 'duffel_change', why: 'Push to a date after the visa appeal / second attempt.' },
        {
          step: 'insurance_claim',
          why: 'Visa-denial coverage is policy-dependent — build packet only if the policy includes it.',
        },
        {
          step: 'ops_handoff',
          why: 'Visa denial often needs the consular letter forwarded directly to airline ops.',
        }
      );
      break;
    case 'missed_connection':
      path.push({
        step: 'ops_handoff',
        why: 'Use the existing missed-connection / trip_delay_replanner flow, not this workflow.',
      });
      break;
    case 'voluntary_no_refund_fare':
      path.push(
        {
          step: 'duffel_voluntary_refund',
          why: 'Try the API; outside the fare rules this will return $0.',
        },
        {
          step: 'duffel_change',
          why: 'Even non-refundable fares typically allow a date change for a fee + price diff.',
        },
        {
          step: 'insurance_claim',
          why: '"Cancel for any reason" insurance covers this; standard policies do not.',
        }
      );
      break;
    case 'other':
      path.push(
        { step: 'duffel_voluntary_refund', why: 'Try the API path first.' },
        {
          step: 'compassionate_exception',
          why: 'Even if the kind is unknown, the airline may publish a relevant policy.',
        },
        { step: 'ops_handoff', why: 'Unknown kind defaults to ops with full context.' }
      );
      break;
  }

  // Time-to-departure adjustments.
  if (!beforeDep) {
    return [
      {
        step: 'ops_handoff',
        why: 'Departure has passed — voluntary refund/change paths are closed; only ops + insurance remain.',
      },
      {
        step: 'insurance_claim',
        why: 'Even with departure passed, no-show insurance claims may pay out with documentation.',
      },
    ];
  }
  return path;
}

const classifyDisruptionTool: ToolDef = {
  name: 'classify_disruption_situation',
  internal: true,
  description:
    'Classify a free-text disruption description (traveler / family chat / ops note) into a `DisruptionKind` + suggested recovery path order + required documentation. Pure rules-based; the matched evidence string is returned for auditability. Use this as the FIRST step of `trip_disruption_recovery` when the agent receives a "we can\'t travel" message.',
  inputSchema: classifyInput,
  jsonSchema: {
    type: 'object',
    required: ['description'],
    properties: {
      description: { type: 'string', minLength: 3, maxLength: 2000 },
      disruptionAtIso: { type: 'string' },
      departureAtIso: { type: 'string' },
    },
  },
  handler: async (
    rawInput: ClassifyDisruptionInput,
    ctx?: ToolContext
  ): Promise<ClassifyDisruptionResult> => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
    const input = classifyInput.parse(rawInput);

    const matched = pickKindFromText(input.description);
    const kind: DisruptionKind = matched?.kind ?? 'other';
    const evidence = matched?.matches ?? [];
    const confidence: 'low' | 'medium' | 'high' = matched
      ? evidence.length >= 2
        ? 'high'
        : 'medium'
      : 'low';

    let hoursToDeparture: number | null = null;
    if (input.departureAtIso) {
      const dep = Date.parse(input.departureAtIso);
      const now = input.disruptionAtIso ? Date.parse(input.disruptionAtIso) : Date.now();
      if (Number.isFinite(dep) && Number.isFinite(now)) {
        hoursToDeparture = Math.round((dep - now) / 3600_000);
      }
    }

    const path = recommendedPathFor(kind, hoursToDeparture);
    return {
      status: 'ok',
      kind,
      confidence,
      needsDocumentation: matched?.needs ?? [],
      recommendedPath: path,
      hoursToDeparture,
      evidence,
      message: `Classified as ${kind} (${confidence}); ${path.length}-step path (${path.map(p => p.step).join(' → ')}).`,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. research_compassionate_exception_policy (Vertex grounded)
// Look up the airline's published bereavement / hardship policy.
// ─────────────────────────────────────────────────────────────────────

const compassionateInput = z.object({
  airlineName: z.string().min(1).max(120),
  airlineIata: z.string().length(2).optional(),
  kind: z.enum(DISRUPTION_KINDS),
  countryOfTravelerCode: z.string().length(2).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
type CompassionateInput = z.infer<typeof compassionateInput>;

const compassionateShape = z.object({
  policyExists: z.enum(['documented', 'reported_via_phone', 'no_evidence']),
  policySummary: z.string(),
  documentationRequired: z.array(z.string()).max(8),
  refundOrCreditOffered: z.enum(['refund', 'credit', 'fee_waiver', 'rebooking_only', 'unknown']),
  contactPath: z.string(),
  caveats: z.array(z.string()).max(4),
  sourceUris: z.array(z.string()).max(6),
});

export type CompassionateExceptionResult =
  | {
      status: 'ok';
      policy: z.infer<typeof compassionateShape>;
      via: 'vertex' | 'gateway';
      message: string;
    }
  | { status: 'unavailable'; reason: string; message: string }
  | { status: 'production_refused'; message: string };

async function runCompassionateResearch(
  rawInput: CompassionateInput,
  ctx?: ToolContext
): Promise<CompassionateExceptionResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const input = compassionateInput.parse(rawInput);

  const groundingPrompt = `Research ${input.airlineName}${input.airlineIata ? ` (${input.airlineIata})` : ''}'s policy on ${input.kind.replace(/_/g, ' ')} exceptions for a non-refundable ticket. Cover:
- Is there a documented bereavement / serious-illness / hardship / military orders / natural-disaster waiver?
- What documentation does the airline require?
- What does the airline offer (refund / travel credit / fee waiver / rebooking only)?
- How does the traveler reach the right desk (phone, dedicated email, chat)?
- Notable caveats — passenger-name match, time windows, fare-class restrictions, regional differences.

Pull from the airline's own help center first, then from FlyerTalk / TripAdvisor recent reports if the policy isn't documented but is widely reported via phone agents. Never invent.

Country of traveler: ${input.countryOfTravelerCode ?? 'unspecified'}.`;

  const coercePrompt = (
    text: string,
    sources: string[]
  ) => `Coerce the report into the schema. Locale: ${input.locale}.

Report:
"""
${text}
"""

Sources cited:
${sources
  .slice(0, 8)
  .map((u, i) => `${i + 1}. ${u}`)
  .join('\n')}

Rules:
- policyExists: 'documented' if found on the airline's help/policy pages, 'reported_via_phone' if multiple traveler reports describe the waiver but the page doesn't, 'no_evidence' if nothing surfaces.
- contactPath: prefer phone over chat (waivers usually require an agent).`;

  const vertex = resolveVertex();
  async function viaPath(modelLike: any, providerOptions?: any) {
    const grounded = await generateText({
      model: modelLike,
      tools: {
        google_search: vertex ? vertex.tools.googleSearch({}) : google.tools.googleSearch({}),
      },
      prompt: groundingPrompt,
      ...(providerOptions ? { providerOptions } : {}),
    });
    const text = grounded.text?.trim() ?? '';
    const meta = grounded.providerMetadata as
      | { google?: { groundingMetadata?: { groundingChunks?: Array<{ web?: { uri?: string } }> } } }
      | undefined;
    const sources = (meta?.google?.groundingMetadata?.groundingChunks ?? [])
      .map(c => c.web?.uri)
      .filter((u): u is string => !!u);
    if (!text) return null;
    const coerced = await generateObject({
      model: modelLike,
      schema: compassionateShape,
      prompt: coercePrompt(text, sources),
      ...(providerOptions ? { providerOptions } : {}),
    } as never);
    return coerced.object as z.infer<typeof compassionateShape>;
  }

  if (vertex) {
    try {
      const obj = await viaPath(vertex(VERTEX_MODEL_ID));
      if (obj)
        return {
          status: 'ok',
          policy: obj,
          via: 'vertex',
          message: `${input.airlineName} ${input.kind} policy via Vertex (exists=${obj.policyExists}).`,
        };
    } catch {}
  }
  try {
    const obj = await viaPath(GATEWAY_MODEL_ID, { gateway: { order: ['google'] } });
    if (obj)
      return {
        status: 'ok',
        policy: obj,
        via: 'gateway',
        message: `${input.airlineName} ${input.kind} policy via gateway.`,
      };
    return {
      status: 'unavailable',
      reason: 'no-grounded-text',
      message: 'No policy data returned.',
    };
  } catch (err) {
    return {
      status: 'unavailable',
      reason: (err as Error).message ?? 'gateway-failed',
      message: `Vertex + gateway both failed: ${(err as Error).message ?? 'unknown'}.`,
    };
  }
}

const researchCompassionateExceptionPolicyTool: ToolDef = {
  name: 'research_compassionate_exception_policy',
  internal: true,
  experimental: true,
  description:
    "Research an airline's published bereavement / serious-illness / legal-hardship / military-orders / natural-disaster policy. Vertex-grounded against the airline's help center + recent traveler reports. Returns documented vs reported-via-phone vs no-evidence + required docs + offered remedy + contact path. Use after `classify_disruption_situation` flags a hardship kind, BEFORE calling `request_human_handoff`.",
  inputSchema: compassionateInput,
  jsonSchema: {
    type: 'object',
    required: ['airlineName', 'kind'],
    properties: {
      airlineName: { type: 'string', minLength: 1, maxLength: 120 },
      airlineIata: { type: 'string', minLength: 2, maxLength: 2 },
      kind: { type: 'string', enum: [...DISRUPTION_KINDS] },
      countryOfTravelerCode: { type: 'string', minLength: 2, maxLength: 2 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runCompassionateResearch,
};

// ─────────────────────────────────────────────────────────────────────
// 3. build_insurance_claim_packet
// Bundle facts + narrative for the traveler's insurer.
// ─────────────────────────────────────────────────────────────────────

const insuranceClaimInput = z.object({
  travelerName: z.string().min(1).max(160),
  policyNumber: z.string().max(80).optional(),
  insurerName: z.string().min(1).max(120).optional(),
  trip: z.object({
    bookingReference: z.string().max(120),
    bookedTotalUsd: z.number().min(0).max(100_000),
    paidNonRefundableUsd: z.number().min(0).max(100_000),
    departureAtIso: z.string(),
    route: z.string().max(120),
    airlineName: z.string().max(120),
  }),
  disruption: z.object({
    kind: z.enum(DISRUPTION_KINDS),
    description: z.string().max(2000),
    occurredAtIso: z.string().optional(),
    documentationOnFile: z.array(z.string().max(120)).max(8),
  }),
  airlineResponse: z.object({
    refundOfferedUsd: z.number().min(0).max(100_000).default(0),
    creditOfferedUsd: z.number().min(0).max(100_000).default(0),
    waiverGranted: z.boolean().default(false),
    rejectionReason: z.string().max(400).optional(),
  }),
  locale: z.string().min(2).max(10).default('en-US'),
});
type InsuranceClaimInput = z.infer<typeof insuranceClaimInput>;

interface InsuranceClaimPacket {
  claimSubject: string;
  claimNarrative: string;
  amountClaimedUsd: number;
  evidence: Array<{ kind: string; status: 'on_file' | 'needed' }>;
  recommendedNextSteps: string[];
}

const buildInsuranceClaimPacketTool: ToolDef = {
  name: 'build_insurance_claim_packet',
  internal: true,
  description:
    'Bundle a structured insurance-claim packet from the trip + disruption + airline-response facts. Pure tool — does NOT submit the claim, just produces the narrative + evidence checklist + amount. Compose AFTER airline path is exhausted (whether refunded partially or rejected entirely). The amountClaimedUsd is `paidNonRefundable - refundOffered - creditOffered`.',
  inputSchema: insuranceClaimInput,
  jsonSchema: {
    type: 'object',
    required: ['travelerName', 'trip', 'disruption', 'airlineResponse'],
    properties: {
      travelerName: { type: 'string', minLength: 1, maxLength: 160 },
      policyNumber: { type: 'string', maxLength: 80 },
      insurerName: { type: 'string', minLength: 1, maxLength: 120 },
      trip: { type: 'object' },
      disruption: { type: 'object' },
      airlineResponse: { type: 'object' },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (
    rawInput: InsuranceClaimInput,
    ctx?: ToolContext
  ): Promise<{
    status: 'ok' | 'production_refused';
    message: string;
    packet?: InsuranceClaimPacket;
  }> => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
    const input = insuranceClaimInput.parse(rawInput);

    const amountClaimed = Math.max(
      0,
      input.trip.paidNonRefundableUsd -
        input.airlineResponse.refundOfferedUsd -
        input.airlineResponse.creditOfferedUsd
    );

    const isSpanish = /^es/i.test(input.locale);
    const subject = isSpanish
      ? `Reclamo de seguro de viaje — ${input.disruption.kind.replace(/_/g, ' ')} (${input.trip.bookingReference})`
      : `Travel insurance claim — ${input.disruption.kind.replace(/_/g, ' ')} (${input.trip.bookingReference})`;

    const requiredDocByKind: Record<DisruptionKind, string[]> = {
      bereavement: ['death certificate', 'relationship-to-deceased proof'],
      serious_illness: ['doctor letter on letterhead', 'admission/discharge records'],
      legal_hold: ['court document or detention letter'],
      military_orders: ['unit-issued orders document'],
      natural_disaster: ['government advisory naming the event'],
      visa_denied: ['consulate denial letter', 'passport copy'],
      force_majeure_other: ['government advisory naming the event'],
      voluntary_no_refund_fare: ['CFAR rider proof of purchase'],
      missed_connection: ['original boarding passes', 'inbound delay receipt'],
      other: [],
    };
    const required = requiredDocByKind[input.disruption.kind];
    const onFile = new Set(input.disruption.documentationOnFile.map(d => d.toLowerCase()));
    const evidence: InsuranceClaimPacket['evidence'] = [
      ...input.disruption.documentationOnFile.map(d => ({ kind: d, status: 'on_file' as const })),
      ...required
        .filter(d => !onFile.has(d.toLowerCase()))
        .map(d => ({ kind: d, status: 'needed' as const })),
      // Always include trip + airline artifacts
      { kind: 'booking confirmation (PNR + invoice)', status: 'on_file' },
      {
        kind: input.airlineResponse.waiverGranted
          ? 'airline waiver confirmation'
          : 'airline rejection email (with reason verbatim)',
        status: input.airlineResponse.rejectionReason ? 'on_file' : 'needed',
      },
    ];

    const narrative = [
      isSpanish
        ? `Solicitamos cobertura por la imposibilidad de viajar de ${input.travelerName} en el itinerario ${input.trip.route} previsto para el ${input.trip.departureAtIso}.`
        : `We request coverage for ${input.travelerName}'s inability to travel on itinerary ${input.trip.route} scheduled ${input.trip.departureAtIso}.`,
      isSpanish
        ? `Causa: ${input.disruption.kind.replace(/_/g, ' ')}. ${input.disruption.description}`
        : `Cause: ${input.disruption.kind.replace(/_/g, ' ')}. ${input.disruption.description}`,
      isSpanish
        ? `La aerolínea (${input.trip.airlineName}) ${
            input.airlineResponse.waiverGranted
              ? `otorgó una excepción parcial`
              : `denegó la solicitud${input.airlineResponse.rejectionReason ? ` por: "${input.airlineResponse.rejectionReason}"` : ''}`
          }. Reembolso ofrecido: USD ${input.airlineResponse.refundOfferedUsd}. Crédito ofrecido: USD ${input.airlineResponse.creditOfferedUsd}.`
        : `The airline (${input.trip.airlineName}) ${
            input.airlineResponse.waiverGranted
              ? `granted a partial waiver`
              : `denied the request${input.airlineResponse.rejectionReason ? ` for the reason: "${input.airlineResponse.rejectionReason}"` : ''}`
          }. Refund offered: USD ${input.airlineResponse.refundOfferedUsd}. Credit offered: USD ${input.airlineResponse.creditOfferedUsd}.`,
      isSpanish
        ? `Monto reclamado al seguro: USD ${amountClaimed} (no reembolsable pagado USD ${input.trip.paidNonRefundableUsd} − reembolso aerolínea USD ${input.airlineResponse.refundOfferedUsd} − crédito USD ${input.airlineResponse.creditOfferedUsd}).`
        : `Amount claimed from insurance: USD ${amountClaimed} (non-refundable paid USD ${input.trip.paidNonRefundableUsd} − airline refund USD ${input.airlineResponse.refundOfferedUsd} − credit USD ${input.airlineResponse.creditOfferedUsd}).`,
    ].join('\n\n');

    const next: string[] = [
      isSpanish
        ? 'Adjuntar todos los documentos del checklist `evidence`.'
        : 'Attach all documents listed in the evidence checklist.',
      isSpanish
        ? `Enviar a ${input.insurerName ?? 'la aseguradora'}${input.policyNumber ? ` con la póliza ${input.policyNumber}` : ''}.`
        : `Submit to ${input.insurerName ?? 'the insurer'}${input.policyNumber ? ` with policy ${input.policyNumber}` : ''}.`,
      isSpanish
        ? 'Si la aerolínea concedió crédito en lugar de reembolso, indicar al asegurador que el crédito vence — algunos pagan la diferencia.'
        : 'If the airline gave credit instead of refund, tell the insurer the credit has an expiry; some pay the diff.',
    ];
    if (evidence.some(e => e.status === 'needed')) {
      next.unshift(
        isSpanish
          ? 'Conseguir los documentos faltantes ANTES de presentar.'
          : 'Obtain the missing documents BEFORE submitting.'
      );
    }

    return {
      status: 'ok',
      packet: {
        claimSubject: subject,
        claimNarrative: narrative,
        amountClaimedUsd: amountClaimed,
        evidence,
        recommendedNextSteps: next,
      },
      message: `Claim packet built: ${subject} — USD ${amountClaimed} claimable.`,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. trip_disruption_recovery — orchestrator
// Returns the chain to run + decision points; does NOT execute the
// side-effecting tools itself (cancel_order_quote etc.).
// ─────────────────────────────────────────────────────────────────────

const recoveryInput = z.object({
  /** Free-text traveler description. Often a forwarded family-chat message. */
  description: z.string().min(3).max(2000),
  duffelOrderId: z.string().max(120).optional(),
  duffelOfferId: z.string().max(120).optional(),
  airlineName: z.string().min(1).max(120),
  airlineIata: z.string().length(2).optional(),
  travelerName: z.string().min(1).max(160),
  bookingReference: z.string().max(120),
  paidNonRefundableUsd: z.number().min(0).max(100_000),
  bookedTotalUsd: z.number().min(0).max(100_000),
  route: z.string().max(120),
  departureAtIso: z.string(),
  countryOfTravelerCode: z.string().length(2).optional(),
  hasInsurance: z.boolean().default(false),
  policyNumber: z.string().max(80).optional(),
  insurerName: z.string().max(120).optional(),
  locale: z.string().min(2).max(10).default('en-US'),
});
export type TripDisruptionRecoveryInput = z.infer<typeof recoveryInput>;

interface RecoveryStep {
  step: RecoveryPath['step'];
  tool?: string;
  toolArgs?: Record<string, unknown>;
  why: string;
  expectedOutcome: string;
}

export interface TripDisruptionRecoveryResult {
  status: 'ok' | 'unavailable' | 'production_refused';
  message: string;
  classification?: ClassifyDisruptionResult;
  /** Ordered chain of tool calls the agent should execute in sequence. */
  chain?: RecoveryStep[];
  /** Compassionate-policy research result (already executed when applicable). */
  compassionateResearch?: CompassionateExceptionResult;
  /** Stored case-file metadata for ops handoff. */
  caseFile?: {
    summary: string;
    documentsRequired: string[];
    likelyOutcome:
      | 'partial_refund'
      | 'full_refund'
      | 'credit_only'
      | 'rebooking_only'
      | 'ops_required'
      | 'insurance_only';
  };
}

async function runTripDisruptionRecovery(
  rawInput: TripDisruptionRecoveryInput,
  ctx?: ToolContext
): Promise<TripDisruptionRecoveryResult> {
  const gate = assertDevOnlyToolAllowed(ctx);
  if (gate.allowed === false) return { status: 'production_refused', message: gate.reason };
  const input = recoveryInput.parse(rawInput);

  // Step 1: classify.
  const classification = (await classifyDisruptionTool.handler(
    {
      description: input.description,
      departureAtIso: input.departureAtIso,
    } as never,
    ctx
  )) as ClassifyDisruptionResult;
  if (classification.status !== 'ok') {
    return {
      status: 'unavailable',
      message: 'Classification failed; cannot build recovery chain.',
      classification,
    };
  }

  const kind = classification.kind!;
  const isHardship = ['bereavement', 'serious_illness', 'legal_hold', 'military_orders'].includes(
    kind
  );

  // Step 2: research compassionate policy (only for hardship kinds).
  let compassionate: CompassionateExceptionResult | undefined;
  if (isHardship) {
    compassionate = await runCompassionateResearch(
      {
        airlineName: input.airlineName,
        ...(input.airlineIata ? { airlineIata: input.airlineIata } : {}),
        kind,
        ...(input.countryOfTravelerCode
          ? { countryOfTravelerCode: input.countryOfTravelerCode }
          : {}),
        locale: input.locale,
      } as never,
      ctx
    );
  }

  // Step 3: build the chain.
  const chain: RecoveryStep[] = [];
  for (const path of classification.recommendedPath ?? []) {
    switch (path.step) {
      case 'check_fare_rules':
        chain.push({
          step: 'check_fare_rules',
          tool: 'display_offer_conditions',
          ...(input.duffelOfferId ? { toolArgs: { offerId: input.duffelOfferId } } : {}),
          why: path.why,
          expectedOutcome:
            'Returns refund + change conditions per slice. Cheap and always-correct snapshot of what the API will allow.',
        });
        break;
      case 'duffel_voluntary_refund':
        chain.push({
          step: 'duffel_voluntary_refund',
          tool: 'cancel_order_quote',
          ...(input.duffelOrderId ? { toolArgs: { orderId: input.duffelOrderId } } : {}),
          why: path.why,
          expectedOutcome:
            'Returns refundAmount + penaltyAmount. If refundAmount > 0, follow up with confirm_cancel_order to execute.',
        });
        break;
      case 'duffel_change':
        chain.push({
          step: 'duffel_change',
          tool: 'request_order_change',
          ...(input.duffelOrderId ? { toolArgs: { orderId: input.duffelOrderId } } : {}),
          why: path.why,
          expectedOutcome:
            "Returns alternative-date offers. Pick one with select_order_change_offer + confirm_order_change. Watch the change_total_amount — that's the out-of-pocket diff.",
        });
        break;
      case 'compassionate_exception':
        chain.push({
          step: 'compassionate_exception',
          tool:
            compassionate?.status === 'ok'
              ? 'research_compassionate_exception_policy'
              : 'request_human_handoff',
          why: path.why,
          expectedOutcome:
            compassionate?.status === 'ok'
              ? `Already researched: policyExists=${compassionate.policy.policyExists}, offers=${compassionate.policy.refundOrCreditOffered}. Required docs: ${compassionate.policy.documentationRequired.join(', ')}. Contact: ${compassionate.policy.contactPath}.`
              : 'Phone the airline directly with documentation; some waivers exist only via agent.',
        });
        break;
      case 'insurance_claim':
        if (input.hasInsurance) {
          chain.push({
            step: 'insurance_claim',
            tool: 'build_insurance_claim_packet',
            toolArgs: {
              travelerName: input.travelerName,
              ...(input.policyNumber ? { policyNumber: input.policyNumber } : {}),
              ...(input.insurerName ? { insurerName: input.insurerName } : {}),
              trip: {
                bookingReference: input.bookingReference,
                bookedTotalUsd: input.bookedTotalUsd,
                paidNonRefundableUsd: input.paidNonRefundableUsd,
                departureAtIso: input.departureAtIso,
                route: input.route,
                airlineName: input.airlineName,
              },
              disruption: { kind, description: input.description, documentationOnFile: [] },
              airlineResponse: { refundOfferedUsd: 0, creditOfferedUsd: 0, waiverGranted: false },
              locale: input.locale,
            },
            why: path.why,
            expectedOutcome:
              'Returns claim subject + narrative + evidence checklist + amount claimable. Build ONLY after airline path resolves so refund/credit numbers are accurate.',
          });
        } else {
          chain.push({
            step: 'insurance_claim',
            why: 'Skipped — traveler has no insurance on file. Tell traveler to check credit-card travel coverage as a fallback.',
            expectedOutcome:
              'Note: many premium credit cards include trip-cancellation insurance; ask the traveler to check card benefits.',
          });
        }
        break;
      case 'ops_handoff':
        chain.push({
          step: 'ops_handoff',
          tool: 'request_human_handoff',
          toolArgs: {
            topic: `${kind} disruption — ${input.travelerName} on ${input.airlineName} ${input.bookingReference}`,
            severity: isHardship ? 'high' : 'medium',
          },
          why: path.why,
          expectedOutcome:
            'Ops takes over with full case file. Include the compassionate-research findings + Duffel transcripts + insurance status.',
        });
        break;
    }
  }

  // Step 4: predict likely outcome.
  let likelyOutcome: NonNullable<TripDisruptionRecoveryResult['caseFile']>['likelyOutcome'] =
    'ops_required';
  if (kind === 'voluntary_no_refund_fare') likelyOutcome = 'rebooking_only';
  else if (compassionate?.status === 'ok' && compassionate.policy.policyExists !== 'no_evidence') {
    likelyOutcome =
      compassionate.policy.refundOrCreditOffered === 'refund'
        ? 'partial_refund'
        : compassionate.policy.refundOrCreditOffered === 'credit'
          ? 'credit_only'
          : compassionate.policy.refundOrCreditOffered === 'rebooking_only'
            ? 'rebooking_only'
            : 'ops_required';
  } else if (input.hasInsurance) {
    likelyOutcome = 'insurance_only';
  }

  const docsRequired = [
    ...(classification.needsDocumentation ?? []),
    ...(compassionate?.status === 'ok' ? compassionate.policy.documentationRequired : []),
  ];

  return {
    status: 'ok',
    classification,
    chain,
    ...(compassionate ? { compassionateResearch: compassionate } : {}),
    caseFile: {
      summary: `${input.travelerName} — ${kind} on ${input.airlineName} ${input.bookingReference} (${input.route}, dep ${input.departureAtIso}). $${input.paidNonRefundableUsd} non-refundable.`,
      documentsRequired: Array.from(new Set(docsRequired)),
      likelyOutcome,
    },
    message: `Recovery chain built: ${chain.length} steps, kind=${kind}, likely=${likelyOutcome}.`,
  };
}

const tripDisruptionRecoveryTool: ToolDef = {
  name: 'trip_disruption_recovery',
  internal: true,
  description:
    "Orchestrate the full recovery workflow when a traveler can't take a booked trip — bereavement, serious illness, legal hold, military orders, natural disaster, visa denied, or voluntary. Composes `classify_disruption_situation` + `display_offer_conditions` + Duffel voluntary refund/change + `research_compassionate_exception_policy` + `build_insurance_claim_packet` + `request_human_handoff` into ONE chain the agent can execute step by step. Returns the chain + classification + likely outcome — does NOT execute the side-effecting steps (cancel/change). Compose this AS THE FIRST move when the traveler messages 'we can't go anymore' / 'mi abuelo no puede viajar'.",
  inputSchema: recoveryInput,
  jsonSchema: {
    type: 'object',
    required: [
      'description',
      'airlineName',
      'travelerName',
      'bookingReference',
      'paidNonRefundableUsd',
      'bookedTotalUsd',
      'route',
      'departureAtIso',
    ],
    properties: {
      description: { type: 'string', minLength: 3, maxLength: 2000 },
      duffelOrderId: { type: 'string', maxLength: 120 },
      duffelOfferId: { type: 'string', maxLength: 120 },
      airlineName: { type: 'string', minLength: 1, maxLength: 120 },
      airlineIata: { type: 'string', minLength: 2, maxLength: 2 },
      travelerName: { type: 'string', minLength: 1, maxLength: 160 },
      bookingReference: { type: 'string', maxLength: 120 },
      paidNonRefundableUsd: { type: 'number', minimum: 0, maximum: 100000 },
      bookedTotalUsd: { type: 'number', minimum: 0, maximum: 100000 },
      route: { type: 'string', maxLength: 120 },
      departureAtIso: { type: 'string' },
      countryOfTravelerCode: { type: 'string', minLength: 2, maxLength: 2 },
      hasInsurance: { type: 'boolean' },
      policyNumber: { type: 'string', maxLength: 80 },
      insurerName: { type: 'string', maxLength: 120 },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: runTripDisruptionRecovery,
};

// ─────────────────────────────────────────────────────────────────────
// 5. recovery_case_file_renderer
// Format the case file as a Slack/email block ready for ops.
// ─────────────────────────────────────────────────────────────────────

const caseFileRendererInput = z.object({
  caseFile: z.object({
    travelerName: z.string().min(1).max(160),
    bookingReference: z.string().max(120),
    airlineName: z.string().min(1).max(120),
    route: z.string().max(120),
    departureAtIso: z.string(),
    paidNonRefundableUsd: z.number().min(0).max(100_000),
    kind: z.enum(DISRUPTION_KINDS),
    description: z.string().max(2000),
    documentsOnFile: z.array(z.string().max(120)).max(15),
    documentsNeeded: z.array(z.string().max(120)).max(15),
    duffelStepsAttempted: z.array(z.string().max(120)).max(8),
    compassionatePolicySummary: z.string().max(800).optional(),
    insurerName: z.string().max(120).optional(),
  }),
  format: z.enum(['slack_blocks', 'email', 'plain']).default('slack_blocks'),
  locale: z.string().min(2).max(10).default('en-US'),
});
type CaseFileRendererInput = z.infer<typeof caseFileRendererInput>;

const recoveryCaseFileRendererTool: ToolDef = {
  name: 'recovery_case_file_renderer',
  internal: true,
  description:
    "Render a structured disruption case file as Slack blocks / email / plain text for ops handoff. Pure formatter. Use as the FINAL step before `request_human_handoff` so the operator inherits a complete picture: traveler, booking, airline, what was attempted, what's missing, what the airline said, what comes next.",
  inputSchema: caseFileRendererInput,
  jsonSchema: {
    type: 'object',
    required: ['caseFile'],
    properties: {
      caseFile: { type: 'object' },
      format: { type: 'string', enum: ['slack_blocks', 'email', 'plain'] },
      locale: { type: 'string', minLength: 2, maxLength: 10 },
    },
  },
  handler: async (rawInput: CaseFileRendererInput, ctx?: ToolContext) => {
    const gate = assertDevOnlyToolAllowed(ctx);
    if (gate.allowed === false)
      return { status: 'production_refused' as const, message: gate.reason };
    const input = caseFileRendererInput.parse(rawInput);
    const cf = input.caseFile;
    const isSpanish = /^es/i.test(input.locale);
    const T = (en: string, es: string) => (isSpanish ? es : en);

    const lines: string[] = [
      `*${T('DISRUPTION RECOVERY CASE', 'CASO DE RECUPERACIÓN POR DISRUPCIÓN')}*`,
      `${T('Kind', 'Tipo')}: \`${cf.kind}\``,
      `${T('Traveler', 'Pasajero')}: ${cf.travelerName}`,
      `${T('Booking', 'Reserva')}: \`${cf.bookingReference}\` · ${cf.airlineName} · ${cf.route} · ${T('dep', 'sale')} ${cf.departureAtIso}`,
      `${T('Non-refundable paid', 'No reembolsable pagado')}: $${cf.paidNonRefundableUsd}`,
      ``,
      `*${T('Situation', 'Situación')}:*`,
      cf.description.slice(0, 600),
      ``,
      `*${T('Already attempted', 'Pasos ya intentados')}:*`,
      cf.duffelStepsAttempted.length > 0
        ? cf.duffelStepsAttempted.map(s => `• ${s}`).join('\n')
        : T('• none', '• ninguno'),
      ``,
      `*${T('Documents on file', 'Documentos disponibles')}:*`,
      cf.documentsOnFile.length > 0
        ? cf.documentsOnFile.map(d => `• ${d}`).join('\n')
        : T('• none', '• ninguno'),
      ``,
      `*${T('Documents still needed', 'Documentos faltantes')}:*`,
      cf.documentsNeeded.length > 0
        ? cf.documentsNeeded.map(d => `• ${d}`).join('\n')
        : T('• none', '• ninguno'),
    ];

    if (cf.compassionatePolicySummary) {
      lines.push(
        '',
        `*${T('Airline compassionate policy (researched)', 'Política compasiva (investigada)')}:*`,
        cf.compassionatePolicySummary
      );
    }
    if (cf.insurerName) {
      lines.push('', `*${T('Insurance', 'Seguro')}:* ${cf.insurerName}`);
    }
    lines.push(
      '',
      `_${T('Owner: assign to a human ops agent. This case is sensitive — empathy first, transactional second.', 'Asignación: agente humano de ops. Caso sensible — empatía primero, lo transaccional después.')}_`
    );

    const text = lines.join('\n');

    if (input.format === 'slack_blocks') {
      const blocks = [{ type: 'section', text: { type: 'mrkdwn', text } }];
      return {
        status: 'ok' as const,
        blocks,
        text,
        message: `Case file rendered as Slack blocks (${text.length} chars).`,
      };
    }
    if (input.format === 'email') {
      return {
        status: 'ok' as const,
        subject: T(
          `Disruption case — ${cf.travelerName} (${cf.bookingReference})`,
          `Caso de disrupción — ${cf.travelerName} (${cf.bookingReference})`
        ),
        body: text,
        message: `Case file rendered as email.`,
      };
    }
    return { status: 'ok' as const, text, message: `Case file rendered as plain text.` };
  },
};

// ─────────────────────────────────────────────────────────────────────

export {
  classifyDisruptionTool,
  researchCompassionateExceptionPolicyTool,
  buildInsuranceClaimPacketTool,
  tripDisruptionRecoveryTool,
  recoveryCaseFileRendererTool,
};
