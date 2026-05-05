/**
 * book_esim — provision a travel eSIM for a traveler.
 *
 * Three-leg pricing reuses the existing booking machinery so eSIM
 * inherits the same audit story as flights / stays:
 *
 *   wholesale (provider quote)
 *     + tenant agency markup    ← TenantPricingPolicy.markupConfig.esim
 *                                 (defaults to 0 bps when not configured —
 *                                 eSIM is opt-in for tenants, see
 *                                 CORE_BOOKING_KINDS in @sendero/billing/markup)
 *     + Sendero take            ← senderoTakeMicro (50bps + floor, tier-scaled)
 *     = retail (what the customer pays)
 *
 * Payer attribution follows the canonical resolver: explicit input →
 * `ctx.payer.type` (turn-level resolution from dispatch) → `resolvePayer()`
 * fallback. Pricing is identical regardless of payer.
 *
 * Channel rendering reuses the canonical `share` payload — `imageUrl`
 * points at the signed `/api/esim/qr/<token>` endpoint, `primaryCta`
 * carries the LPA: deep-link for one-tap install on iOS 17.4+,
 * `secondaryCtas` link to per-device install instructions.
 */

import { z } from 'zod';

import { type Prisma, prisma, type MeterPayerType } from '@sendero/database';
import {
  resolveEsimProvider,
  signQrToken,
  EsimProviderError,
  type EsimPlan,
} from '@sendero/esim';
import {
  type BookingPolicySnapshot,
  computeMarkupBreakdown,
  type MarkupConfig,
  type PerKindMarkup,
  senderoTakeMicro,
} from '@sendero/billing/markup';
import type { PlanTier } from '@sendero/billing/plans';

import { resolvePayer, PayerResolutionError } from './lib/resolve-payer';
import { payerCopy } from './lib/payer-copy';
import type { ToolContext, ToolDef } from './types';

// Sentinel used when the tenant hasn't opted into eSIM markup yet — the
// breakdown still goes through `computeMarkupBreakdown` so Sendero take
// applies and the audit shape matches flight/hotel rows.
const DEFAULT_ESIM_MARKUP: PerKindMarkup = { strategy: 'static', bps: 0 };

const inputSchema = z.object({
  /** Optional Trip.id — anchors payer + Trip.events; create one if absent. */
  tripId: z.string().optional(),
  /**
   * Direct order path: when set, `book_esim` skips the catalogue lookup
   * and orders this exact provider bundle. The agent gets `planId` from
   * a prior `search_esim` row tap — `rowId: 'esim:<planId>'`. When
   * absent, falls back to the catalogue-lookup-and-pick-cheapest path.
   */
  planId: z.string().optional(),
  /**
   * ISO-3166-1 alpha-2 destinations the eSIM covers.
   * Required when `planId` is omitted; ignored when `planId` is set
   * (the bundle's countries are inherent to the bundle).
   */
  destinationIso2: z.array(z.string().length(2)).min(1).max(20).optional(),
  /**
   * Trip duration in days. Required when `planId` is omitted (used to
   * pick a bundle with matching validity); ignored when `planId` is set.
   */
  days: z.number().int().min(1).max(365).optional(),
  /** Estimated data need in GB. Defaults to 5 GB. Ignored when `planId` is set. */
  dataGb: z.number().min(0.5).max(50).default(5),
  /** Override the trip-resolved payer. */
  provisionedBy: z.enum(['tenant', 'traveler']).optional(),
  /** Plan tier — set by the dispatch route from Clerk billing. */
  planTier: z.enum(['free', 'basic', 'pro', 'enterprise']).optional(),
});

export type BookEsimInput = z.infer<typeof inputSchema>;

export interface BookEsimResult {
  status: 'ok' | 'no_plan_found' | 'tenant_pay_unsupported' | 'provider_error';
  esimId?: string;
  iccid?: string | null;
  /** LPA: install string — used for iOS Universal Link tap-to-install. */
  lpaCode?: string;
  /** Signed `/api/esim/qr/<token>` URL — channel renderers fetch the QR PNG. */
  qrTokenUrl?: string;
  /**
   * Universal install page URL — `/install/esim/<token>`. The
   * channel-render `esim_activation` kind points CTAs here; the page
   * UA-detects iOS and auto-redirects to `lpaCode` (one-tap install on
   * iOS 17.4+). Android / desktop see the QR + per-device steps.
   */
  installUrl?: string;
  plan?: { label: string; countries: string[]; dataMb: number; validityDays: number };
  pricing?: {
    wholesaleMicroUsdc: string;
    markupMicroUsdc: string;
    senderoTakeMicroUsdc: string;
    retailMicroUsdc: string;
  };
  share?: {
    title: string;
    body: string;
    bullets: string[];
  };
  /**
   * Canonical `esim_activation` `ChannelMessage` payload — built once
   * by `book_esim` so the agent collector / chat-message converter /
   * channel-send orchestrator don't have to re-derive it from
   * `share + lpaCode + qrTokenUrl + installUrl + plan`. Plain JSON,
   * round-trips cleanly through AI SDK output channels and through
   * `JSON.stringify` in `collectShareCards()`.
   *
   * Channel renderers consume this via the
   * `ChannelMessageEsimActivation` shape in
   * `apps/app/lib/channel-render/types.ts` — duplicated structurally
   * here to avoid an apps→tools reverse import.
   */
  activation?: {
    esimId: string;
    planLabel: string;
    countries: string[];
    dataMb: number;
    validityDays: number;
    qrUrl: string;
    lpaCode: string;
    installUrl: string;
    priceLine?: string;
    expiresAt?: string;
  };
  message?: string;
}

export async function bookEsim(input: BookEsimInput, ctx?: ToolContext): Promise<BookEsimResult> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) {
    return {
      status: 'provider_error',
      message:
        'book_esim requires a tenant-bound caller. Pass `travelerPhone` (E.164) on `call_sendero` or run from an authed channel turn.',
    };
  }

  // Payer resolution — explicit → ctx → resolvePayer. The eSIM tool
  // works for both modes; pricing is identical, attribution differs.
  let provisionedBy: MeterPayerType | undefined =
    input.provisionedBy ?? ctx?.payer?.type ?? undefined;
  let payerUserId: string | undefined = ctx?.payer?.travelerUserId;
  if (!provisionedBy) {
    try {
      const resolved = await resolvePayer({
        tenantId,
        tripId: input.tripId,
        travelerUserId: ctx?.traveler?.userId,
      });
      provisionedBy = resolved.type;
      payerUserId = resolved.travelerUserId ?? payerUserId;
    } catch (err) {
      if (err instanceof PayerResolutionError && err.code === 'traveler_required') {
        // No traveler context + no override; surface the same actionable
        // error book_flight uses so the agent prompts for sign-in.
        return {
          status: 'provider_error',
          message:
            'Cannot provision eSIM — no traveler bound to this turn. Pass the traveler so we know whose wallet to charge or whose device to install on.',
        };
      }
      throw err;
    }
  }

  // Self-heal — when the agent calls `book_esim` with only a `tripId`
  // (no destinationIso2 / no days), resolve those from the Trip row
  // server-side. Kapso wipes per-execution `vars` between turns, so
  // we can't rely on the agent's prompt to always re-read
  // `get_active_trip` first. The Sendero Trip is the durable source
  // of truth — read it here as a fallback.
  let resolvedDestinationIso2 = input.destinationIso2;
  let resolvedDays = input.days;
  if ((!resolvedDestinationIso2 || resolvedDestinationIso2.length === 0) && (input.tripId || ctx?.traveler?.userId)) {
    try {
      const trip = await prisma.trip.findFirst({
        where: input.tripId
          ? { id: input.tripId, tenantId }
          : {
              tenantId,
              travelerId: ctx?.traveler?.userId ?? undefined,
              status: { in: ['draft', 'searching', 'awaiting_approval', 'booked', 'in_progress'] },
            },
        orderBy: { createdAt: 'desc' },
        select: { id: true, intent: true },
      });
      if (trip) {
        const intent = (trip.intent ?? {}) as Record<string, unknown>;
        const fromIntent = Array.isArray(intent.destinationIso2)
          ? (intent.destinationIso2 as unknown[]).filter(
              (c): c is string => typeof c === 'string' && /^[A-Za-z]{2}$/.test(c)
            )
          : [];
        if (fromIntent.length > 0 && (!resolvedDestinationIso2 || resolvedDestinationIso2.length === 0)) {
          resolvedDestinationIso2 = fromIntent;
        }
        // Days fallback: derive from intent.startDate / endDate if both set.
        if (!resolvedDays && typeof intent.startDate === 'string' && typeof intent.endDate === 'string') {
          const start = Date.parse(intent.startDate);
          const end = Date.parse(intent.endDate);
          if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
            resolvedDays = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
          }
        }
      }
    } catch (err) {
      console.warn('[book_esim] trip self-heal failed (non-fatal)', {
        tripId: input.tripId,
        userId: ctx?.traveler?.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  // Sensible default for days when still unresolved — most travel eSIMs
  // sell in week-long bundles.
  if (!resolvedDays) resolvedDays = 7;

  // Provider plan resolution — two paths:
  //   1. Direct order: `planId` came from a prior search_esim row tap.
  //      Find the bundle in the catalogue (so we have its dataMb +
  //      validity for persistence + share copy).
  //   2. Quote-then-pick: legacy/one-shot. countries + days required.
  const provider = resolveEsimProvider();
  let plan: EsimPlan | null;
  try {
    if (input.planId) {
      // Look the bundle up via listPlans against the destinations we
      // resolved (input → trip.intent → fallback). The bundle's name
      // encodes its country (e.g. `esim_1GB_7D_JP_V2`), so when no
      // destination context is available at all we infer the ISO from
      // the planId's last underscored segment as a last resort.
      let countries = resolvedDestinationIso2 ?? [];
      countries = countries.map(c => c.toUpperCase());
      if (countries.length === 0) {
        const m = input.planId.match(/_([A-Z]{2})(?:_[A-Z0-9]+)?$/);
        if (m) countries = [m[1]!];
      }
      const days = resolvedDays ?? 7;
      const candidates = countries.length
        ? await provider.listPlans({ countries, days, dataGb: input.dataGb, limit: 50 })
        : [];
      plan = candidates.find(p => p.planId === input.planId) ?? null;
      if (!plan) {
        return {
          status: 'no_plan_found',
          message: `Plan ${input.planId} not found in current catalogue. The list may have aged out — re-run search_esim and tap a fresh option.`,
        };
      }
    } else {
      if (!resolvedDestinationIso2 || !resolvedDays) {
        return {
          status: 'no_plan_found',
          message:
            'book_esim requires either `planId` (from search_esim) or `destinationIso2` + `days` for the quote-and-pick path.',
        };
      }
      plan = await provider.quote({
        countries: resolvedDestinationIso2.map(c => c.toUpperCase()),
        days: resolvedDays,
        dataGb: input.dataGb,
      });
    }
  } catch (err) {
    if (err instanceof EsimProviderError) {
      return { status: 'provider_error', message: `eSIM provider error: ${err.message}` };
    }
    throw err;
  }
  if (!plan) {
    const where = input.destinationIso2?.join(', ') ?? '(unspecified)';
    const days = input.days ?? '?';
    return {
      status: 'no_plan_found',
      message: `No eSIM plan found for ${where} · ${days} days · ${input.dataGb} GB.`,
    };
  }

  // Tenant agency markup — opt-in for eSIM. Read latest activated
  // policy; if it doesn't carry an `esim` config, use 0 bps default.
  const policyRow = await prisma.tenantPricingPolicy.findFirst({
    where: { tenantId, activated: true },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      markupConfig: true,
      floorMicroUsdc: true,
      ceilingMicroUsdc: true,
      senderoTakeBehavior: true,
    },
  });
  const markupConfig = (policyRow?.markupConfig ?? {}) as MarkupConfig;
  const perKind = markupConfig.esim ?? DEFAULT_ESIM_MARKUP;
  const policySnapshot: BookingPolicySnapshot = {
    policyVersion: policyRow?.version ?? 0,
    kind: 'esim',
    markup: perKind,
    floorMicroUsdc: (policyRow?.floorMicroUsdc ?? 0n).toString(),
    ceilingMicroUsdc: policyRow?.ceilingMicroUsdc ? policyRow.ceilingMicroUsdc.toString() : null,
    senderoTakeBehavior: (policyRow?.senderoTakeBehavior ?? 'add_to_customer') as
      | 'add_to_customer'
      | 'deduct_from_markup',
  };

  const planTier: PlanTier = input.planTier ?? 'free';
  const breakdown = computeMarkupBreakdown({
    costMicroUsdc: plan.wholesaleMicroUsdc,
    bookingKind: 'esim',
    policy: policySnapshot,
    plan: planTier,
  });
  // computeMarkupBreakdown handles 'add_to_customer' vs 'deduct_from_markup'
  // semantics; surface the same `customerTotalMicroUsdc` as the retail price.
  const retailMicroUsdc = breakdown.customerTotalMicroUsdc;

  // Idempotency key — caller supplies turnId via metadata; fall back
  // to a stable per-tenant-per-trip-per-day key so retries dedupe at
  // the provider regardless of metadata threading.
  const idempotencyKey = input.planId
    ? `esim:${tenantId}:${input.tripId ?? 'no_trip'}:${input.planId}`
    : `esim:${tenantId}:${input.tripId ?? 'no_trip'}:${(input.destinationIso2 ?? []).join(',')}:${input.days ?? 0}:${input.dataGb}`;

  // Place the order. Provider returns the LPA code we'll persist.
  let order: Awaited<ReturnType<typeof provider.order>>;
  try {
    order = await provider.order({ planId: plan.planId, idempotencyKey });
  } catch (err) {
    if (err instanceof EsimProviderError) {
      return { status: 'provider_error', message: `eSIM order failed: ${err.message}` };
    }
    throw err;
  }

  // Persist Esim row. Write happens AFTER provider order so a Postgres
  // blip doesn't strand a paid-for eSIM with no record. The provider
  // is itself idempotent on `(provider, providerOrderId)` so a repeat
  // call returns the same order; the unique constraint guards against
  // duplicate rows on retry.
  const created = await prisma.esim.upsert({
    where: {
      provider_providerOrderId: {
        provider: provider.slug,
        providerOrderId: order.providerOrderId,
      },
    },
    update: {},
    create: {
      tenantId,
      ...(ctx?.traveler?.userId ? { travelerId: ctx.traveler.userId } : {}),
      ...(input.tripId ? { tripId: input.tripId } : {}),
      provider: provider.slug,
      providerOrderId: order.providerOrderId,
      iccid: order.iccid,
      activationCode: order.activationCode,
      lpaCode: order.lpaCode,
      destinationCountries: plan.countries as Prisma.InputJsonValue,
      dataMb: plan.dataMb,
      validityDays: plan.validityDays,
      wholesaleMicroUsdc: plan.wholesaleMicroUsdc,
      markupMicroUsdc: breakdown.markupMicroUsdc,
      senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc,
      retailMicroUsdc,
      ...(provisionedBy ? { provisionedBy } : {}),
      ...(payerUserId ? { payerUserId } : {}),
      status: 'ordered',
      ...(order.expiresAt ? { expiresAt: order.expiresAt } : {}),
      metadata: {
        planId: plan.planId,
        policyVersion: policySnapshot.policyVersion,
        capping: breakdown.capping,
      } as Prisma.InputJsonValue,
    },
  });

  // Sign QR token so the channel renderers can fetch the image without
  // exposing the activation code in URLs. Secret reuses the invoice
  // signing secret to avoid env sprawl. When unset we skip the URL —
  // renderers fall back to the LPA: deep-link instead of a QR.
  const signingSecret = process.env.INVOICE_SIGNING_SECRET ?? '';
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010').replace(/\/$/, '');
  const token = signingSecret ? signQrToken(created.id, signingSecret) : undefined;
  const qrTokenUrl = token ? `${baseUrl}/api/esim/qr/${token}.png` : undefined;
  const installUrl = token ? `${baseUrl}/install/esim/${token}` : undefined;

  // Persist Sendero take to MeterEvent the same way confirm_booking
  // does. The Esim upsert above is idempotent on (provider, providerOrderId);
  // the MeterEvent unique-constraint on (tenantId, idempotencyKey) is the
  // matching dedup chokepoint. P2002 on retry = "we already metered this
  // exact order", which is the desired no-op behavior — swallow + log
  // rather than 500'ing the tool.
  try {
    await prisma.meterEvent.create({
      data: {
        tenantId,
        toolName: 'book_esim',
        priceMicroUsdc: breakdown.senderoTakeMicroUsdc,
        status: 'paid',
        note: `book_esim · wholesale=${plan.wholesaleMicroUsdc} markup=${breakdown.markupMicroUsdc} take=${breakdown.senderoTakeMicroUsdc}`,
        idempotencyKey,
        ...(provisionedBy ? { payerType: provisionedBy } : {}),
        ...(payerUserId ? { payerUserId } : {}),
        metadata: {
          esimId: created.id,
          planId: plan.planId,
          capping: breakdown.capping,
          idempotencyKey,
        },
      },
    });
  } catch (err) {
    // Prisma P2002 = unique-constraint violation. Anything else escalates.
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') throw err;
    console.info('[book_esim] meter event already recorded for this idempotency key', {
      idempotencyKey,
    });
  }

  // Channel-render share payload. Title + body land on the operator
  // card / Slack block / WhatsApp template; bullets render as quick
  // facts. The renderer adds the QR + tap-to-install button via the
  // existing `share` plumbing once the dedicated `esim_activation`
  // ChannelMessage kind ships.
  const dollars = (Number(retailMicroUsdc) / 1_000_000).toFixed(2);
  const priceLine = `$${dollars}`;
  const payerLine = provisionedBy
    ? payerCopy({
        payer: provisionedBy,
        amount: priceLine,
        tenantName: ctx?.traveler?.tenantId ?? null,
      }).lineItem
    : priceLine;

  // Phase A.4 — email the activation card alongside the WhatsApp
  // delivery. eSIM activation goes stale fast (some plans expire 7d
  // after order, some require activation in-country). Email is the
  // durable surface: the QR + install URL stays in inbox forever, the
  // traveler can pull it up on a desktop to scan with their phone, and
  // the corporate booker on cc can audit. Fire-and-forget — the
  // WhatsApp + share return path doesn't depend on the email landing.
  if (qrTokenUrl && installUrl) {
    void sendEsimEmail({
      tenantId,
      travelerUserId: ctx?.payer?.travelerUserId ?? ctx?.traveler?.userId ?? payerUserId ?? null,
      planLabel: plan.label,
      countries: plan.countries,
      dataMb: plan.dataMb,
      validityDays: plan.validityDays,
      priceLine: payerLine,
      qrUrl: qrTokenUrl,
      installUrl,
      ...(order.expiresAt ? { expiresAt: order.expiresAt.toISOString() } : {}),
    }).catch(err => {
      console.warn('[book_esim] activation email failed (non-fatal)', {
        esimId: created.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // `activation` is the canonical channel-render payload. We populate
  // it only when both signed URLs were minted (i.e. INVOICE_SIGNING_SECRET
  // is set) — without them the renderer can't paint a QR or a
  // tap-to-install button, so falling back to the plain `share` card is
  // the right degraded path.
  const activation =
    qrTokenUrl && installUrl
      ? {
          esimId: created.id,
          planLabel: plan.label,
          countries: plan.countries,
          dataMb: plan.dataMb,
          validityDays: plan.validityDays,
          qrUrl: qrTokenUrl,
          lpaCode: order.lpaCode,
          installUrl,
          priceLine: payerLine,
          ...(order.expiresAt ? { expiresAt: order.expiresAt.toISOString() } : {}),
        }
      : undefined;

  return {
    status: 'ok',
    esimId: created.id,
    iccid: order.iccid,
    lpaCode: order.lpaCode,
    ...(qrTokenUrl ? { qrTokenUrl } : {}),
    ...(installUrl ? { installUrl } : {}),
    plan: {
      label: plan.label,
      countries: plan.countries,
      dataMb: plan.dataMb,
      validityDays: plan.validityDays,
    },
    pricing: {
      wholesaleMicroUsdc: plan.wholesaleMicroUsdc.toString(),
      markupMicroUsdc: breakdown.markupMicroUsdc.toString(),
      senderoTakeMicroUsdc: breakdown.senderoTakeMicroUsdc.toString(),
      retailMicroUsdc: retailMicroUsdc.toString(),
    },
    share: {
      title: 'Trip eSIM ready',
      body: plan.label,
      bullets: [
        `${(plan.dataMb / 1024).toFixed(1)} GB · ${plan.validityDays} days`,
        plan.countries.length === 1 ? plan.countries[0] : `${plan.countries.length} countries`,
        payerLine,
        ...(qrTokenUrl ? ['Scan QR or tap "Install eSIM" on the device you\'ll travel with.'] : []),
      ],
    },
    ...(activation ? { activation } : {}),
  };
}

/**
 * Build a canonical `esim_activation` ChannelMessage payload from a
 * successful `book_esim` result. Lives here so the agent's chat-message
 * converter has one place to call when it sees `book_esim` succeed,
 * instead of mapping fields ad-hoc per channel adapter. The
 * `ChannelMessageEsimActivation` shape lives in
 * `apps/app/lib/channel-render/types.ts`; we duplicate the field list
 * loosely here to avoid a tools→apps reverse import.
 */
export interface EsimActivationPayload {
  esimId: string;
  planLabel: string;
  countries: string[];
  dataMb: number;
  validityDays: number;
  qrUrl: string;
  lpaCode: string;
  installUrl: string;
  priceLine?: string;
  expiresAt?: string;
}

export function toEsimActivationPayload(result: BookEsimResult): EsimActivationPayload | null {
  if (result.status !== 'ok') return null;
  if (!result.esimId || !result.lpaCode || !result.qrTokenUrl || !result.installUrl) return null;
  if (!result.plan) return null;
  return {
    esimId: result.esimId,
    planLabel: result.plan.label,
    countries: result.plan.countries,
    dataMb: result.plan.dataMb,
    validityDays: result.plan.validityDays,
    qrUrl: result.qrTokenUrl,
    lpaCode: result.lpaCode,
    installUrl: result.installUrl,
    ...(result.share?.bullets?.find(b => b.includes('charged') || b.includes('on '))
      ? { priceLine: result.share.bullets.find(b => b.includes('charged') || b.includes('on ')) }
      : {}),
  };
}

// Make `senderoTakeMicro` reachable to consumers that want to preview
// the take without ordering. Re-exporting from the tool avoids a
// circular-dep with @sendero/billing in the public surface.
export { senderoTakeMicro };

export const bookEsimTool: ToolDef<BookEsimInput, BookEsimResult> = {
  name: 'book_esim',
  description:
    'Provision a travel eSIM. Two call paths: (1) DIRECT — pass `planId` from a prior `search_esim` row tap to order that exact bundle (preferred for picker flows). (2) QUICK — pass `destinationIso2` + `days` (+ optional `dataGb`) and book_esim picks the cheapest matching bundle. Either way: applies tenant agency markup + Sendero take, persists the order, returns LPA install string + signed QR URL + universal install URL ready to drop into Slack/WhatsApp/web. Payer follows Trip.paymentMode — pricing identical either way.',
  inputSchema,
  jsonSchema: {
    type: 'object',
    properties: {
      tripId: { type: 'string', description: 'Optional Trip.id for payer + Trip.events anchor.' },
      planId: {
        type: 'string',
        description:
          'DIRECT path: provider bundle id from a prior search_esim row tap (e.g. "esim_5GB_7D_JP_V2"). When set, destinationIso2 / days / dataGb are ignored.',
      },
      destinationIso2: {
        type: 'array',
        items: { type: 'string', minLength: 2, maxLength: 2 },
        description:
          'QUICK path: ISO-3166-1 alpha-2 destination codes (e.g. ["JP","KR"]). Required when planId is omitted.',
      },
      days: {
        type: 'integer',
        minimum: 1,
        maximum: 365,
        description: 'QUICK path: trip duration in days. Required when planId is omitted.',
      },
      dataGb: {
        type: 'number',
        minimum: 0.5,
        maximum: 50,
        default: 5,
        description: 'QUICK path: estimated data need in GB.',
      },
      provisionedBy: {
        type: 'string',
        enum: ['tenant', 'traveler'],
        description: 'Override the trip-resolved payer.',
      },
      planTier: {
        type: 'string',
        enum: ['free', 'basic', 'pro', 'enterprise'],
        description: 'Tenant plan tier — set server-side by the dispatch route.',
      },
    },
  },
  async handler(input, ctx) {
    return bookEsim(input, ctx);
  },
};

/**
 * Email the eSIM activation card to the traveler. Same content the
 * WhatsApp `send_image_message` ships (QR + install URL + plan
 * details), but durable in inbox so the traveler can pull it up on
 * a desktop to scan with their phone, and the corporate booker can
 * audit when on cc.
 *
 * Fail-soft: missing email / unconfigured Resend / send error all
 * just log and return. The WhatsApp path remains the primary
 * delivery surface.
 */
async function sendEsimEmail(args: {
  tenantId: string;
  travelerUserId: string | null;
  planLabel: string;
  countries: string[];
  dataMb: number;
  validityDays: number;
  priceLine: string;
  qrUrl: string;
  installUrl: string;
  expiresAt?: string;
}): Promise<void> {
  if (!args.travelerUserId) return;

  const { createNotifier, notificationsConfigured } = await import('@sendero/notifications');
  if (!notificationsConfigured()) return;

  const profile = await prisma.user.findUnique({
    where: { id: args.travelerUserId },
    select: { email: true, displayName: true },
  });
  if (!profile?.email) return;
  // Skip placeholder emails — same gate book_flight uses.
  const lower = profile.email.toLowerCase();
  if (
    lower.endsWith('@sendero.demo') ||
    lower.endsWith('@whatsapp-provisional.sendero.travel')
  ) {
    return;
  }

  const dataLabel =
    args.dataMb >= 1024
      ? `${(args.dataMb / 1024).toFixed(1)} GB`
      : `${args.dataMb} MB`;
  const region =
    args.countries.length === 1
      ? args.countries[0]
      : `${args.countries.length} countries`;

  const notifier = createNotifier();
  await notifier.sendShareCard(profile.email, {
    title: `📱 Trip eSIM ready · ${region}`,
    body: `${args.planLabel}\n\nScan the QR with the device you'll travel with — or, on iOS 17.4+, tap "Install eSIM" to install in one tap. Keep this email until after your trip; the QR is one-shot per device.`,
    bullets: [
      `${dataLabel} · ${args.validityDays} days`,
      args.priceLine,
      ...(args.expiresAt
        ? [`Activate by ${new Date(args.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`]
        : []),
    ],
    primaryCta: { label: 'Install eSIM', href: args.installUrl },
    imageUrl: args.qrUrl,
    subjectPrefix: 'Sendero ·',
  });
}
