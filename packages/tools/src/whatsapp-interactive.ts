/**
 * Agent-callable Meta interactive-message + media-send tools.
 *
 * Kapso's `enabled_default_tools` list doesn't include rich interactive
 * messages or location/phone share requests as agent-callable surfaces
 * (those are workflow node types, not agent tools). These six tools
 * wrap our existing `WhatsAppClient` so the agent can drive richer UX
 * directly from a turn:
 *
 *   - `send_interactive_buttons` — quick replies (max 3 buttons, e.g. "Book offer 1" / "Skip" / "Talk to human")
 *   - `send_interactive_list` — scrollable shortlist (offer pickers, restaurants, time-slots)
 *   - `send_image_message` — media URL or hosted image
 *   - `send_document_message` — PDF (invoice, boarding pass, e-ticket)
 *   - `request_location` — Meta's native "share my location" prompt
 *   - `request_phone_number` — fallback prompt + free-text capture (Meta has no first-class phone share)
 *
 * All six resolve the recipient the same way `send_whatsapp_template`
 * does: `ctx.traveler.phone` → `ctx.channelIdentityId.externalUserId` →
 * explicit `toE164` override. Internal-scope only — never exposed to
 * external API keys (they'd let arbitrary inbox spam).
 */

import { prisma } from '@sendero/database';
import { env } from '@sendero/env';
import { WhatsAppClient } from '@sendero/whatsapp';
import { z } from 'zod';

import type { ToolContext, ToolDef } from './types';

const buttonSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(256)
    .describe('Stable id Sendero will read off the inbound `interactive.button_reply` payload.'),
  title: z
    .string()
    .min(1)
    .max(200)
    .describe('Display label. Meta caps at 20 chars; longer titles are auto-truncated server-side.'),
});

const sendInteractiveButtonsInput = z.object({
  body: z.string().min(1).max(1024).describe('Message body shown above the buttons.'),
  buttons: z
    .array(buttonSchema)
    .min(1)
    .max(3)
    .describe('1-3 quick-reply buttons. Meta hard-caps at 3.'),
  /** Optional rich header — image (route map / carrier logo) or text title. */
  headerText: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('Optional bold text title above the body (max 60 chars).'),
  headerImageUrl: z
    .string()
    .url()
    .optional()
    .describe('Optional public HTTPS image URL shown as the header (e.g. route map, carrier logo).'),
  footer: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('Optional small grey text below the buttons (max 60 chars). Use for context like "Hold expires in 30 min" or "Powered by Sendero".'),
  toE164: z.string().optional(),
});

/**
 * Meta caps list-row + section titles at 24 chars. Agents miscount
 * Unicode/emoji width often enough that a strict z.max() fails the
 * whole call. We accept up to 200 chars in the schema and TRUNCATE in
 * the handler (with an ellipsis), so a chatty title degrades to a
 * shortened version instead of dropping the entire offer list.
 */
const listRowSchema = z.object({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  description: z.string().max(200).optional(),
});

const listSectionSchema = z.object({
  title: z.string().min(1).max(200),
  rows: z.array(listRowSchema).min(1).max(10),
});

const META_LIST_TITLE_MAX = 24;
const META_LIST_DESCRIPTION_MAX = 72;
const META_BUTTON_TITLE_MAX = 20;
const META_INTERACTIVE_BODY_MAX = 1024;
const META_HEADER_TEXT_MAX = 60;
const META_FOOTER_TEXT_MAX = 60;
const DEFAULT_BRAND_FOOTER = 'Sendero × Travel Agent';

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  // Leave 1 char for the ellipsis so the rendered string fits.
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Extract a sensible list-header from the body's first non-empty line
 * AND return the body with that line removed so the card doesn't
 * render it twice. Strips markdown asterisks (Meta renders the header
 * bold automatically; literal asterisks would show up).
 *
 * Returns null when the body has no first line worth lifting.
 */
function deriveHeaderFromBody(
  body: string
): { headerText: string; bodyWithoutHeader: string } | null {
  const lines = body.split('\n');
  const firstNonEmptyIdx = lines.findIndex(l => l.trim().length > 0);
  if (firstNonEmptyIdx === -1) return null;
  const headerSource = lines[firstNonEmptyIdx]
    .replace(/\*+/g, '')
    .replace(/:\s*$/, '')
    .trim();
  if (!headerSource) return null;
  // Drop the lifted line plus any blank lines immediately after it,
  // so the body that follows starts at the next meaningful content.
  let nextIdx = firstNonEmptyIdx + 1;
  while (nextIdx < lines.length && lines[nextIdx].trim().length === 0) nextIdx++;
  const bodyWithoutHeader = lines.slice(nextIdx).join('\n').trim();
  return {
    headerText: headerSource,
    bodyWithoutHeader: bodyWithoutHeader || ' ',
  };
}

/**
 * Common carrier-name compaction map. Run as a fallback for over-
 * length list-row titles before truncation: agents often produce
 * "Duffel Airways · USD 69.50" (26 chars) when the persona asked for
 * "Duffel · $69.50" (15 chars). Doing the rewrite in the handler
 * prevents the agent's mistake from manifesting as a "USD 69…" cut
 * that hides the price.
 */
const CARRIER_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bAerolíneas Argentinas\b/g, 'Aerolíneas AR'],
  [/\bAmerican Airlines\b/g, 'AA'],
  [/\bBritish Airways\b/g, 'BA'],
  [/\bDuffel Airways\b/g, 'Duffel'],
  [/\bIberia Líneas Aéreas\b/g, 'Iberia'],
  [/\bLATAM Airlines\b/g, 'LATAM'],
  [/\bLufthansa\b/g, 'LH'],
  [/\bAir Canada\b/g, 'AC'],
  [/\bAir France\b/g, 'AF'],
  [/\bUnited Airlines\b/g, 'UA'],
  [/\bDelta Air Lines\b/g, 'Delta'],
  [/\bJetBlue Airways\b/g, 'JetBlue'],
  [/\bSouthwest Airlines\b/g, 'Southwest'],
  [/\bKLM\b/g, 'KLM'],
  [/\bRyanair\b/g, 'Ryanair'],
  [/\bEasyJet\b/g, 'EasyJet'],
];

/**
 * Compact a list-row title that's too long for Meta's 24-char cap.
 * Order of operations:
 *   1. Replace "USD " currency word with "$" sign (saves 3 chars).
 *   2. Apply carrier abbreviation map (Duffel Airways → Duffel etc.).
 *   3. Tidy double spaces / trailing punctuation.
 *   4. Final fallback: ellipsis truncation.
 */
function compactListTitle(title: string, maxLen: number): string {
  if (title.length <= maxLen) return title;
  let out = title.replace(/\bUSD\s+/g, '$').replace(/\bUS\$\s*/g, '$');
  if (out.length <= maxLen) return out;
  for (const [pattern, short] of CARRIER_ABBREVIATIONS) {
    out = out.replace(pattern, short);
    if (out.length <= maxLen) break;
  }
  out = out.replace(/\s{2,}/g, ' ').trim();
  if (out.length <= maxLen) return out;
  return truncate(out, maxLen);
}

const sendInteractiveListInput = z.object({
  body: z.string().min(1).max(1024).describe('Message body shown above the open-list button.'),
  buttonText: z
    .string()
    .min(1)
    .max(20)
    .describe('Text on the button that opens the list (e.g. "View flights").'),
  sections: z
    .array(listSectionSchema)
    .min(1)
    .max(10)
    .describe('Sections of selectable rows. Meta caps at 10 sections × 10 rows.'),
  /**
   * Strongly recommended. Lists only support text headers (Meta
   * doesn't accept image/video headers on type=list — use buttons
   * for that). Optional in the schema because the handler auto-
   * derives one from the first line of `body` when omitted, which
   * is more graceful than rejecting the whole call.
   */
  headerText: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe(
      'Bold text title at the top of the list (max 60 chars). Lists DO NOT support image/video headers; use plain text describing the list (e.g. "✈️ EZE → LIM · 6 may"). For image headers, use `send_interactive_buttons` instead. If omitted, the first line of `body` is auto-extracted.'
    ),
  footer: z
    .string()
    .min(1)
    .max(60)
    .optional()
    .describe('Optional small grey text below the open-list button (max 60 chars).'),
  toE164: z.string().optional(),
});

const sendImageInput = z.object({
  imageUrl: z.string().url().describe('Public HTTPS URL of the image to send.'),
  caption: z.string().max(1024).optional(),
  toE164: z.string().optional(),
});

const sendDocumentInput = z.object({
  documentUrl: z.string().url().describe('Public HTTPS URL of the PDF / document to send.'),
  filename: z.string().max(120).optional(),
  caption: z.string().max(1024).optional(),
  toE164: z.string().optional(),
});

const requestLocationInput = z.object({
  body: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      'Prompt shown to the traveler. The native "share location" pin is rendered below.'
    ),
  toE164: z.string().optional(),
});

const requestPhoneNumberInput = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      "Prompt asking the traveler to share their phone number (e.g. \"What's the passenger's mobile? We'll send the boarding pass to it.\")."
    ),
  toE164: z.string().optional(),
});

interface OutboundResult {
  ok: true;
  recipient: string;
  wamid?: string;
}

export const sendInteractiveButtonsTool: ToolDef<
  z.infer<typeof sendInteractiveButtonsInput>,
  OutboundResult
> = {
  name: 'send_interactive_buttons',
  internal: true,
  description:
    "Send a WhatsApp message with up to 3 tappable quick-reply buttons. Use for confirmations (Yes/No), short choices (Book / Hold / Skip), and explicit hand-offs to humans. Each button has an `id` Sendero reads off the next inbound to know which choice the traveler made. Hard limit: 3 buttons, title ≤ 20 chars.",
  inputSchema: sendInteractiveButtonsInput,
  jsonSchema: {
    type: 'object',
    required: ['body', 'buttons'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 1024 },
      buttons: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: {
          type: 'object',
          required: ['id', 'title'],
          properties: {
            id: { type: 'string', minLength: 1, maxLength: 256 },
            title: { type: 'string', minLength: 1, maxLength: 20 },
          },
        },
      },
      headerText: { type: 'string', minLength: 1, maxLength: 60 },
      headerImageUrl: { type: 'string', format: 'uri' },
      footer: { type: 'string', minLength: 1, maxLength: 60 },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);

    // Persona guardrail — model keeps generating the forbidden
    // "1) Faucet 2) Card 3) Crypto" top-up menu despite explicit rules.
    // We catch it at the tool layer so a buggy agent turn fails fast
    // instead of leaking the anti-pattern to the traveler. The error
    // message names the right path so the model self-corrects on retry.
    const rawButtons = input.buttons as Array<{ id: string; title: string }>;
    const violatesFaucetMenuRule = rawButtons.some(b => {
      const title = b.title.toLowerCase();
      const id = (b.id ?? '').toLowerCase();
      return (
        title.includes('faucet') ||
        id.includes('faucet') ||
        id === 'topup:crypto' ||
        title.includes('transferencia cripto') ||
        title.includes('crypto transfer')
      );
    });
    if (violatesFaucetMenuRule) {
      throw new Error(
        'persona_violation:topup_menu_forbidden — never offer faucet/crypto-transfer buttons on a top-up flow. ' +
          'For top-up, call `moonpay_topup` directly and relay the returned `checkoutUrl`. ' +
          'For wallet view, use buttons `[Top up $100, Top up $50, Otro monto]` only. ' +
          'Faucet is dev-only and only fires when the user types the literal word "faucet".'
      );
    }

    // Auto-truncate button titles to Meta's 20-char cap. Agents
    // miscount Unicode/emoji frequently — silently shortening keeps
    // the call from failing on a 21-char title.
    const buttons = rawButtons.map(b => ({
      id: b.id,
      title: truncate(b.title, META_BUTTON_TITLE_MAX),
    }));
    // Build optional header + footer. Image header takes precedence
    // when both `headerImageUrl` and `headerText` are provided.
    const header = input.headerImageUrl
      ? ({ type: 'image' as const, imageUrl: input.headerImageUrl })
      : input.headerText
        ? ({ type: 'text' as const, text: truncate(input.headerText, META_HEADER_TEXT_MAX) })
        : undefined;
    // Default footer for brand consistency when agent forgets one.
    const footer = truncate(input.footer ?? DEFAULT_BRAND_FOOTER, META_FOOTER_TEXT_MAX);
    const result = (await client.sendInteractiveButtons(
      recipient,
      truncate(input.body, META_INTERACTIVE_BODY_MAX),
      buttons,
      { ...(header ? { header } : {}), footer }
    )) as { messages?: Array<{ id?: string }> };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

export const sendInteractiveListTool: ToolDef<
  z.infer<typeof sendInteractiveListInput>,
  OutboundResult
> = {
  name: 'send_interactive_list',
  internal: true,
  description:
    "Send a WhatsApp scrollable list of selectable rows — far better UX than typing \"1\" / \"2\" / \"3\" for offer selection. Use for: flight/hotel offer lists, restaurant shortlists, time-slot pickers, multi-passenger picks, group-trip seat lists. Each row has an `id` Sendero reads on the next inbound. REQUIRED: `headerText` (bold title at top, ≤ 60 chars) — lists without a header look naked. Hard limit: 10 sections × 10 rows, title ≤ 24 chars, description ≤ 72 chars. Footer is auto-defaulted to brand text when omitted.",
  inputSchema: sendInteractiveListInput,
  jsonSchema: {
    type: 'object',
    required: ['body', 'buttonText', 'sections'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 1024 },
      buttonText: { type: 'string', minLength: 1, maxLength: 20 },
      headerText: { type: 'string', minLength: 1, maxLength: 60 },
      footer: { type: 'string', minLength: 1, maxLength: 60 },
      sections: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        items: {
          type: 'object',
          required: ['title', 'rows'],
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 24 },
            rows: {
              type: 'array',
              minItems: 1,
              maxItems: 10,
              items: {
                type: 'object',
                required: ['id', 'title'],
                properties: {
                  id: { type: 'string', minLength: 1, maxLength: 200 },
                  title: { type: 'string', minLength: 1, maxLength: 24 },
                  description: { type: 'string', maxLength: 72 },
                },
              },
            },
          },
        },
      },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);
    // Truncate title/description down to Meta's hard limits. Row
    // titles get smart compaction first (USD → $, carrier abbrevs)
    // so prices don't get cut mid-number when the agent uses a long
    // format like "Duffel Airways · USD 69.50" (26 chars > 24 cap).
    const sections = (input.sections as Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>).map(s => ({
      title: truncate(s.title, META_LIST_TITLE_MAX),
      rows: s.rows.map(r => ({
        id: r.id,
        title: compactListTitle(r.title, META_LIST_TITLE_MAX),
        ...(r.description
          ? { description: truncate(r.description, META_LIST_DESCRIPTION_MAX) }
          : {}),
      })),
    }));
    // Auto-derive a header from the first non-empty line of body
    // when the agent omits one, AND strip that line from the body so
    // the rendered card doesn't show the same line twice. Lists
    // without headers look naked; forcing a 400 retry makes the agent
    // panic and fall back to text prose. Strip markdown asterisks.
    const explicitHeader = input.headerText?.trim();
    let bodyText = input.body;
    let headerText: string;
    if (explicitHeader) {
      headerText = truncate(explicitHeader, META_HEADER_TEXT_MAX);
    } else {
      const derived = deriveHeaderFromBody(input.body);
      if (derived) {
        headerText = truncate(derived.headerText, META_HEADER_TEXT_MAX);
        bodyText = derived.bodyWithoutHeader;
      } else {
        headerText = 'Selecciona una opción';
      }
    }
    // Default footer keeps brand presence even when the agent forgets
    // to pass one. The agent can override with anything more specific
    // (hold expiry, traveler name, etc.).
    const footer = truncate(input.footer ?? DEFAULT_BRAND_FOOTER, META_FOOTER_TEXT_MAX);
    const result = (await client.sendListMessage(
      recipient,
      truncate(bodyText, META_INTERACTIVE_BODY_MAX),
      truncate(input.buttonText, META_BUTTON_TITLE_MAX),
      sections,
      { headerText, footer }
    )) as { messages?: Array<{ id?: string }> };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

export const sendImageMessageTool: ToolDef<z.infer<typeof sendImageInput>, OutboundResult> = {
  name: 'send_image_message',
  internal: true,
  description:
    'Send an image to the traveler via WhatsApp. Use for: route map exports, NFT stamp art, hotel photos, boarding-pass renderings, anything visual. Pass a publicly fetchable HTTPS URL — Meta downloads and re-hosts. Optional caption (≤ 1024 chars) shown beneath the image.',
  inputSchema: sendImageInput,
  jsonSchema: {
    type: 'object',
    required: ['imageUrl'],
    properties: {
      imageUrl: { type: 'string', format: 'uri' },
      caption: { type: 'string', maxLength: 1024 },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'image',
      image: { link: input.imageUrl, ...(input.caption ? { caption: input.caption } : {}) },
    };
    const result = (await client.send(payload)) as { messages?: Array<{ id?: string }> };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

export const sendDocumentMessageTool: ToolDef<
  z.infer<typeof sendDocumentInput>,
  OutboundResult
> = {
  name: 'send_document_message',
  internal: true,
  description:
    'Send a PDF or document to the traveler via WhatsApp. Use for: invoices, e-tickets, itinerary PDFs, boarding-pass PDFs, visa attestations. Pass a publicly fetchable HTTPS URL — Meta downloads and re-hosts. Optional `filename` becomes the on-device label; optional `caption` (≤ 1024 chars) shown alongside.',
  inputSchema: sendDocumentInput,
  jsonSchema: {
    type: 'object',
    required: ['documentUrl'],
    properties: {
      documentUrl: { type: 'string', format: 'uri' },
      filename: { type: 'string', maxLength: 120 },
      caption: { type: 'string', maxLength: 1024 },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'document',
      document: {
        link: input.documentUrl,
        ...(input.filename ? { filename: input.filename } : {}),
        ...(input.caption ? { caption: input.caption } : {}),
      },
    };
    const result = (await client.send(payload)) as { messages?: Array<{ id?: string }> };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

export const requestLocationTool: ToolDef<z.infer<typeof requestLocationInput>, OutboundResult> = {
  name: 'request_location',
  internal: true,
  description:
    "Send a WhatsApp message with a native \"Share location\" pin. The traveler taps it and Meta returns a precise lat/lng on the next inbound (`messages[0].location`). Use for: airport transfer pickup, ground-transport coordination, \"where are you?\" disruption recovery, walking-route start point. Body explains why you need it.",
  inputSchema: requestLocationInput,
  jsonSchema: {
    type: 'object',
    required: ['body'],
    properties: {
      body: { type: 'string', minLength: 1, maxLength: 1024 },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);
    // Meta interactive type "location_request_message" — a native
    // request that surfaces the system "share my location" sheet.
    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: input.body },
        action: { name: 'send_location' },
      },
    };
    const result = (await client.send(payload)) as { messages?: Array<{ id?: string }> };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

export const requestPhoneNumberTool: ToolDef<
  z.infer<typeof requestPhoneNumberInput>,
  OutboundResult
> = {
  name: 'request_phone_number',
  internal: true,
  description:
    "Ask the traveler to share a phone number. Meta has no first-class \"share phone\" interactive type, so this sends a single text prompt and the agent reads the answer on the next inbound. Use for: adding passengers to a group trip, capturing emergency-contact numbers, switching the conversation to a different traveler. Provide a clear `prompt` so the traveler knows the format you want (E.164 with leading +).",
  inputSchema: requestPhoneNumberInput,
  jsonSchema: {
    type: 'object',
    required: ['prompt'],
    properties: {
      prompt: { type: 'string', minLength: 1, maxLength: 1024 },
      toE164: { type: 'string' },
    },
  },
  async handler(input, ctx) {
    const { client, recipient } = await resolveOutboundClient(ctx, input.toE164);
    const text = `${input.prompt}\n\n_Reply with the number in international format, e.g. +1 415 555 0123._`;
    const result = (await client.sendText(recipient, text)) as {
      messages?: Array<{ id?: string }>;
    };
    return { ok: true as const, recipient, ...wamidFrom(result) };
  },
};

async function resolveOutboundClient(
  ctx: ToolContext | undefined,
  override: string | undefined
): Promise<{ client: WhatsAppClient; recipient: string }> {
  const tenantId = ctx?.traveler?.tenantId;
  if (!tenantId) throw new Error('whatsapp_outbound_missing_tenant_context');

  const accessToken = env.whatsappAccessToken() ?? env.kapsoApiKey();
  if (!accessToken) throw new Error('whatsapp_outbound_not_configured');

  const install = await prisma.whatsAppInstall.findUnique({
    where: { tenantId },
    select: { phoneNumberId: true, status: true },
  });
  if (!install?.phoneNumberId || install.status === 'disabled') {
    throw new Error('whatsapp_install_unavailable');
  }

  const recipient = await resolveRecipient(tenantId, ctx, override);
  if (!recipient) throw new Error('whatsapp_outbound_missing_recipient');

  const baseUrl =
    env.whatsappApiBaseUrl() ??
    (env.kapsoApiKey() ? `${env.kapsoApiBaseUrl()}/meta/whatsapp/v24.0` : undefined);
  const client = new WhatsAppClient({
    phoneNumberId: install.phoneNumberId,
    accessToken,
    apiBaseUrl: baseUrl,
  });
  return { client, recipient };
}

async function resolveRecipient(
  tenantId: string,
  ctx: ToolContext | undefined,
  override: string | undefined
): Promise<string | null> {
  if (override) return override;
  if (ctx?.traveler?.phone) return ctx.traveler.phone;
  if (ctx?.channelIdentityId) {
    const identity = await prisma.channelIdentity.findUnique({
      where: { id: ctx.channelIdentityId },
      select: { externalUserId: true, tenantId: true },
    });
    if (identity?.tenantId === tenantId && identity.externalUserId) {
      return identity.externalUserId;
    }
  }
  return null;
}

function wamidFrom(result: { messages?: Array<{ id?: string }> }): { wamid?: string } {
  const wamid = result?.messages?.[0]?.id;
  return wamid ? { wamid } : {};
}
