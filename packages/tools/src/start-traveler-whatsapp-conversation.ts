/**
 * `start_traveler_whatsapp_conversation` — operator-side high-level
 * wedge for "DM a traveler over WhatsApp to start a trip".
 *
 * The dogfooded gap (2026-05-06): the agent went `send_whatsapp_template`
 * → human-in-the-loop nag for travelerName → tripSummary → intakeLink,
 * one variable per turn, before giving up and falling through to
 * free-form. This single tool replaces that loop:
 *
 *   - Idempotent on `(tenant, phone)` — re-running rebinds the existing
 *     trip + channel identity.
 *   - Auto-generates `intakeLink` from the resolved tripId.
 *   - Sensible locale defaults for travelerName + tripSummary so the
 *     template send always has the vars it needs.
 *   - Tries the registered template first; on rejection falls back to
 *     a free-form welcome (works inside the 24h customer-service window
 *     and on the dev sandbox).
 *   - Returns the tripId + ChannelIdentity so the operator UI can
 *     navigate to `?tripId=…` and pick up the live thread.
 *
 * Internal-scope: never exposed to traveler-facing channels.
 */

import { prisma } from '@sendero/database';
import type { Prisma } from '@sendero/database';
import { env } from '@sendero/env';
import {
  buildTemplateComponents,
  isOutsideSessionWindowError,
  resolveTemplateLocale,
  SENDERO_TEMPLATES,
  WhatsAppClient,
} from '@sendero/whatsapp';
import { z } from 'zod';

import type { ToolDef } from './types';

const inputSchema = z.object({
  toE164: z
    .string()
    .min(6)
    .max(32)
    .describe(
      "Traveler's WhatsApp phone in E.164 (e.g. '+593980668984'). The only required field — every other arg has a sensible default so the agent never has to nag the operator for boilerplate."
    ),
  travelerName: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      'Display name for the traveler (used in the template greeting and stamped on the User row when creating fresh). Defaults to a locale-appropriate "friend" if omitted.'
    ),
  tripSummary: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe(
      'Short trip pitch used in the template body ("a Caribbean trip"). Defaults to a locale-appropriate "your next trip" when omitted.'
    ),
  locale: z
    .enum(['es', 'en', 'pt'])
    .optional()
    .describe('BCP-47 short tag. Defaults to es when the phone is +5x (Latin America), else en.'),
});

export type StartConversationInput = z.infer<typeof inputSchema>;

export interface StartConversationResult {
  ok: true;
  tripId: string;
  travelerUserId: string;
  channelIdentityId: string;
  recipient: string;
  intakeLink: string;
  consoleHref: string;
  messageMode: 'template' | 'freeform';
  wamid?: string;
  reused: { trip: boolean; user: boolean; channelIdentity: boolean };
}

const FRIEND_BY_LOCALE: Record<'es' | 'en' | 'pt', string> = {
  es: 'amigo',
  en: 'friend',
  pt: 'amigo',
};
const SUMMARY_BY_LOCALE: Record<'es' | 'en' | 'pt', string> = {
  es: 'tu próximo viaje',
  en: 'your next trip',
  pt: 'sua próxima viagem',
};
const TEMPLATE_BODY_BY_LOCALE: Record<
  'es' | 'en' | 'pt',
  (name: string, summary: string, link: string) => string
> = {
  es: (n, s, l) =>
    `¡Hola ${n}! ${s}\n\nEstoy aquí para ayudarte a planificar tu viaje. Para empezar, ¿me podrías indicar las ciudades de origen y destino, así como las fechas de salida y regreso?\n\n${l}`,
  en: (n, s, l) =>
    `Hi ${n}! ${s}\n\nI'm here to help plan your trip. To get started, could you share your origin and destination cities, plus your departure and return dates?\n\n${l}`,
  pt: (n, s, l) =>
    `Olá ${n}! ${s}\n\nEstou aqui para ajudar a planejar sua viagem. Para começar, você pode me dizer as cidades de origem e destino, e as datas de ida e volta?\n\n${l}`,
};
function renderTripIntakeStartBody(
  locale: 'es' | 'en' | 'pt',
  travelerName: string,
  tripSummary: string,
  intakeLink: string
): string {
  return TEMPLATE_BODY_BY_LOCALE[locale](travelerName, tripSummary, intakeLink);
}

const FREEFORM_BY_LOCALE: Record<'es' | 'en' | 'pt', (name: string, summary: string) => string> = {
  es: (n, s) =>
    `¡Hola ${n}! Soy Sendero, tu agente de viajes. Estoy aquí para ayudarte con ${s}. Cuéntame el origen, destino y fechas que tienes en mente.`,
  en: (n, s) =>
    `Hi ${n}! I'm Sendero, your travel agent. I'm here to help with ${s}. Tell me the origin, destination, and dates you have in mind.`,
  pt: (n, s) =>
    `Olá ${n}! Sou o Sendero, seu agente de viagens. Estou aqui para ajudar com ${s}. Me conta a origem, o destino e as datas que você tem em mente.`,
};

function inferLocale(phone: string): 'es' | 'en' | 'pt' {
  const digits = phone.replace(/\D/g, '');
  // Coarse — any +5x is Latin America by Meta's allocation.
  if (digits.startsWith('5')) return digits.startsWith('55') ? 'pt' : 'es';
  return 'en';
}

function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('++')) return `+${trimmed.replace(/^\++/, '')}`;
  if (!trimmed.startsWith('+')) {
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 6 ? `+${digits}` : trimmed;
  }
  return trimmed;
}

function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.APP_URL ??
    process.env.AGENT_INTERNAL_BASE_URL ??
    'http://localhost:3010'
  );
}

export const startTravelerWhatsappConversationTool: ToolDef<
  StartConversationInput,
  StartConversationResult
> = {
  name: 'start_traveler_whatsapp_conversation',
  internal: true,
  description:
    "Start a WhatsApp trip-intake conversation with a traveler. Single call: provisions the User by phone, opens or rebinds a Trip, creates the ChannelIdentity, and sends the localized intake template (falls back to free-form on template rejection). Returns tripId + a console deep-link so the UI can route to `/dashboard/console?tripId=…`. Use this whenever the operator says \"text the traveler\", \"DM them on whatsapp\", or \"start a trip via whatsapp\". Never ask the operator for travelerName / tripSummary / intakeLink — sensible defaults exist; the only required input is the phone in E.164.",
  inputSchema,
  jsonSchema: {
    type: 'object',
    required: ['toE164'],
    properties: {
      toE164: {
        type: 'string',
        minLength: 6,
        maxLength: 32,
        description: "E.164 phone, e.g. '+593980668984'.",
      },
      travelerName: { type: 'string', minLength: 1, maxLength: 120 },
      tripSummary: { type: 'string', minLength: 1, maxLength: 200 },
      locale: { type: 'string', enum: ['es', 'en', 'pt'] },
    },
  },
  async handler(input, ctx) {
    const tenantId = ctx?.traveler?.tenantId;
    if (!tenantId) {
      throw new Error(
        'start_traveler_whatsapp_conversation requires tenant context. Sign in to the operator dashboard.'
      );
    }

    const phone = normalizePhone(input.toE164);
    const locale = input.locale ?? inferLocale(phone);
    const travelerName = input.travelerName ?? FRIEND_BY_LOCALE[locale];
    const tripSummary = input.tripSummary ?? SUMMARY_BY_LOCALE[locale];

    // 1) Resolve install for THIS tenant. Schema-level @unique on
    //    phoneNumberId means we must trust the row keyed on tenantId.
    const install = await prisma.whatsAppInstall.findUnique({
      where: { tenantId },
      select: { phoneNumberId: true, status: true },
    });
    if (!install?.phoneNumberId || install.status === 'disabled') {
      throw new Error(
        'whatsapp_install_unavailable: this tenant has no active WhatsAppInstall. Connect via /dashboard/channels/whatsapp first.'
      );
    }

    // 2) Find or create the traveler User. Phone match wins (dual-
    //    identity unification — same User across web admin + WhatsApp).
    let travelerUser = await prisma.user.findFirst({
      where: { phone },
      select: { id: true, displayName: true, phone: true },
    });
    let userReused = Boolean(travelerUser);
    if (!travelerUser) {
      const handle = phone.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const placeholderEmail = `wa-${handle}@whatsapp-provisional.sendero.travel`;
      try {
        travelerUser = await prisma.user.create({
          data: {
            email: placeholderEmail,
            phone,
            displayName: input.travelerName ?? null,
            source: 'whatsapp',
          },
          select: { id: true, displayName: true, phone: true },
        });
      } catch {
        // Race: same phone provisioned concurrently by inbound webhook.
        travelerUser = await prisma.user.findFirst({
          where: { phone },
          select: { id: true, displayName: true, phone: true },
        });
        if (!travelerUser) {
          throw new Error('whatsapp_user_provision_failed');
        }
        userReused = true;
      }
    }

    // 3) Find an active trip or open a new one. Trip per (tenant,
    //    travelerId) for the active conversation thread.
    let trip = await prisma.trip.findFirst({
      where: {
        tenantId,
        travelerId: travelerUser.id,
        status: { notIn: ['completed', 'canceled', 'failed'] },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    const tripReused = Boolean(trip);
    if (!trip) {
      const created = await prisma.trip.create({
        data: {
          tenantId,
          travelerId: travelerUser.id,
          status: 'draft',
          intent: { purpose: tripSummary } as Prisma.InputJsonValue,
          channelBindings: { primary: 'whatsapp' } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      trip = created;
    }

    // 4) Find or create the WhatsApp ChannelIdentity for this phone.
    let channelIdentity = await prisma.channelIdentity.findFirst({
      where: { tenantId, kind: 'whatsapp', externalUserId: phone },
      select: { id: true, userId: true },
    });
    const ciReused = Boolean(channelIdentity);
    if (!channelIdentity) {
      channelIdentity = await prisma.channelIdentity.create({
        data: {
          tenantId,
          kind: 'whatsapp',
          externalUserId: phone,
          userId: travelerUser.id,
          metadata: {
            locale: locale === 'es' ? 'es-EC' : locale === 'pt' ? 'pt-BR' : 'en-US',
            localeSource: 'operator_initiated',
            phoneRaw: phone,
          } as Prisma.InputJsonValue,
        },
        select: { id: true, userId: true },
      });
    } else if (!channelIdentity.userId) {
      await prisma.channelIdentity.update({
        where: { id: channelIdentity.id },
        data: { userId: travelerUser.id },
      });
    }

    // 5) Build the intake link (deep-link the traveler's WhatsApp
    //    button can open back to the operator console for the trip).
    const intakeLink = `${appBaseUrl()}/dashboard/console?tripId=${trip.id}`;
    const consoleHref = intakeLink;

    // 6) Send. Try template first (works outside the 24h session
    //    window for new contacts); fall back to free-form when the
    //    template path errors (e.g., on the dev sandbox).
    const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
    if (!accessToken) throw new Error('whatsapp_outbound_not_configured');
    const baseUrl =
      env.whatsappApiBaseUrl() ??
      (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
    const client = new WhatsAppClient({
      phoneNumberId: install.phoneNumberId,
      accessToken,
      apiBaseUrl: baseUrl,
    });

    const def = SENDERO_TEMPLATES.TRIP_INTAKE_START;
    const components = buildTemplateComponents(def, {
      travelerName,
      tripSummary,
      intakeLink,
    });
    const templateLocale = resolveTemplateLocale(def, locale);

    let messageMode: 'template' | 'freeform' = 'template';
    let wamid: string | undefined;
    try {
      const result = (await client.sendTemplate({
        to: phone,
        templateName: def.name,
        languageCode: templateLocale,
        components,
      })) as { messages?: Array<{ id?: string }> };
      wamid = result?.messages?.[0]?.id;
    } catch (err) {
      // Template not approved / not deployed on this WABA / sandbox
      // doesn't carry it — fall back to free-form. Inside the 24h
      // window or on the sandbox this usually works.
      const isSession = isOutsideSessionWindowError(err);
      if (isSession) {
        // Truly outside the window AND template failed — surface the
        // error so the operator knows to re-register the template.
        throw err;
      }
      try {
        const text = FREEFORM_BY_LOCALE[locale](travelerName, tripSummary);
        const result = (await client.sendText(phone, text)) as {
          messages?: Array<{ id?: string }>;
        };
        wamid = result?.messages?.[0]?.id;
        messageMode = 'freeform';
      } catch (innerErr) {
        const reason = innerErr instanceof Error ? innerErr.message : String(innerErr);
        throw new Error(`whatsapp_send_failed: ${reason}`);
      }
    }

    // 7) Append the outbound to Trip.events so the operator console
    //    renders the message. Atomic JSONB || append (TOCTOU-safe;
    //    tenant double-bound). pg_notify lights up the SSE stream so
    //    `/api/inbox/[tripId]/events/stream` listeners pick it up
    //    without router.refresh.
    // Render a human-readable preview of what the traveler actually
    // saw so the operator console mirrors the WhatsApp thread (no
    // debug dumps). Templates have a fixed body shape — render it
    // locally with the same vars we sent.
    const renderedBody =
      messageMode === 'template'
        ? renderTripIntakeStartBody(locale, travelerName, tripSummary, intakeLink)
        : FREEFORM_BY_LOCALE[locale](travelerName, tripSummary);

    const eventBody = {
      id: `outbound_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      kind: 'inbox_reply',
      direction: 'outbound',
      channel: 'whatsapp',
      createdAt: new Date().toISOString(),
      text: renderedBody,
      author: { kind: 'agent', displayName: 'Sendero' },
      status: 'sent',
      ...(wamid ? { wamid } : {}),
      messageMode,
    };
    await prisma.$executeRaw`
      UPDATE "trips"
      SET events = COALESCE(events, '[]'::jsonb) || ${JSON.stringify([eventBody])}::jsonb
      WHERE id = ${trip.id} AND "tenantId" = ${tenantId}
    `;
    const notifyPayload = JSON.stringify({
      tenantId,
      tripId: trip.id,
      entry: {
        id: eventBody.id,
        kind: 'inbox_reply',
        direction: 'outbound',
        channel: 'whatsapp',
        createdAt: eventBody.createdAt,
      },
      at: new Date().toISOString(),
    });
    await prisma.$executeRaw`SELECT pg_notify('trip_events', ${notifyPayload})`.catch(() => {
      /* fail-soft */
    });

    return {
      ok: true as const,
      tripId: trip.id,
      travelerUserId: travelerUser.id,
      channelIdentityId: channelIdentity.id,
      recipient: phone,
      intakeLink,
      consoleHref,
      messageMode,
      ...(wamid ? { wamid } : {}),
      reused: { trip: tripReused, user: userReused, channelIdentity: ciReused },
    };
  },
};
