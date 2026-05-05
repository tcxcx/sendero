/**
 * WhatsApp channel renderer.
 *
 * Translates a `ChannelMessage` into a WhatsApp Cloud API send payload.
 * The traveler-side WhatsApp UI receives whatever this emits, text
 * bubble, button list, list message, or template message depending on
 * the canonical kind.
 *
 * Reference: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages
 *
 * Kapso adapter (used in dev / hosted-WA flows) accepts the same
 * shapes via its REST proxy. See `packages/kapso/src/`.
 *
 * The `to` field on the returned payload is left as an empty string by
 * design; the caller (dispatcher / send helper) must populate the
 * traveler's E.164 number before sending. Keeping this renderer
 * recipient-agnostic lets the same payload be cached and sent to
 * multiple recipients without re-rendering.
 */

import { buildShareImageUrl } from '@/lib/og/share-url';
import { INSTALL_INSTRUCTIONS } from '../install-instructions';
import type {
  ChannelCta,
  ChannelMessage,
  ChannelMessageAncillaryPicker,
  ChannelMessageCard,
  ChannelMessageEsimActivation,
  ChannelMessageSeatPicker,
  ChannelMessageSources,
  ChannelMessageStayBookingConfirmation,
  ChannelMessageStayQuoteReview,
  ChannelMessageStayRatePicker,
  ChannelMessageStaySearchResults,
  ChannelMessageText,
  ChannelMessageToolResult,
  ChannelMessageTripBrief,
  ChannelRenderer,
  ChannelStayBilling,
  ChannelStayBusinessDetails,
  ChannelStayCancellationEntry,
  ChannelStayCondition,
  RenderedForChannel,
} from '../types';

/**
 * Minimal WhatsApp Cloud API send-message envelope. Real impl will
 * narrow this to the discriminated union of text / interactive /
 * template payloads.
 */
export interface WhatsAppPayload {
  messaging_product: 'whatsapp';
  recipient_type: 'individual';
  to: string;
  type: 'text' | 'interactive' | 'image' | 'template';
  text?: { body: string; preview_url?: boolean };
  interactive?: {
    type: 'button' | 'list' | 'cta_url';
    header?: { type: 'text' | 'image'; text?: string; image?: { link: string } };
    body: { text: string };
    footer?: { text: string };
    action: unknown;
  };
  image?: { link: string; caption?: string };
  template?: { name: string; language: { code: string }; components?: unknown[] };
}

const WA_BUTTON_TITLE_MAX = 20;
const WA_BODY_MAX = 1024;
const WA_LIST_BUTTON_MAX = 20;
const WA_LIST_ROWS_MAX = 10;
const MAX_BUTTONS = 3;
const MAX_SOURCES = 5;

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind in renderForWhatsApp');
}

/**
 * Truncate a string to a max length, appending an ellipsis if cut.
 * Used for button titles (hard 20-char cap from Cloud API spec).
 */
function clip(input: string, max: number): string {
  if (input.length <= max) return input;
  if (max <= 3) return input.slice(0, max);
  return `${input.slice(0, max - 3)}...`;
}

/**
 * Truncate a body to a max length, preferring the last sentence
 * boundary inside the window so we cut at a period rather than mid-word.
 */
function clipBody(input: string, max: number): string {
  if (input.length <= max) return input;
  const window = input.slice(0, max - 3);
  const lastStop = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  );
  if (lastStop > max * 0.6) {
    return `${window.slice(0, lastStop + 1)}...`;
  }
  return `${window}...`;
}

/**
 * Convert canonical markdown to WhatsApp's mrkdwn-lite. WhatsApp does
 * not render real markdown. It supports only:
 *   *bold* (asterisks, no double),
 *   _italic_ (underscores),
 *   ~strike~ (tildes),
 *   `mono` (single backticks).
 *
 * We rewrite the common GFM tokens into WA equivalents and drop the
 * rest so the body reads cleanly when WA renders it raw.
 */
function simplifyForWhatsApp(content: string): string {
  let out = content;
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
  out = out.replace(/__(.+?)__/g, '*$1*');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1_$2_');
  out = out.replace(/```[\s\S]*?```/g, match => {
    const inner = match.replace(/^```\w*\n?/, '').replace(/```$/, '');
    return inner;
  });
  out = out.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
  out = out.replace(/^\s*[-*+]\s+/gm, '- ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

function ctaToButtonId(cta: ChannelCta): string {
  return `${cta.kind}:${cta.value ?? ''}`;
}

function envelope(payload: WhatsAppPayload): WhatsAppPayload {
  return payload;
}

function renderText(msg: ChannelMessageText): RenderedForChannel<WhatsAppPayload> {
  const body = clipBody(simplifyForWhatsApp(msg.content), WA_BODY_MAX);
  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: false },
    }),
  };
}

interface CardLike {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

function buildCardBody(card: CardLike): string {
  const parts: string[] = [`*${card.title}*`, simplifyForWhatsApp(card.body)];
  if (card.bullets && card.bullets.length > 0) {
    parts.push(card.bullets.map(b => `- ${b}`).join('\n'));
  }
  return clipBody(parts.filter(Boolean).join('\n\n'), WA_BODY_MAX);
}

function renderCardLike(card: CardLike): RenderedForChannel<WhatsAppPayload> {
  const ctas = card.ctas ?? [];
  const fitsButton = ctas.length > 0 && ctas.length <= MAX_BUTTONS;
  const body = buildCardBody(card);

  // Single `open_link` CTA → WhatsApp's native `cta_url` interactive.
  // Reply buttons can't carry a URL — treating an open_link as a reply
  // would mean the traveler taps and the bot just receives a button
  // event, never opens the page. cta_url is the canonical URL-button
  // type. We only use it for the single-link case because Cloud API
  // restricts cta_url to exactly one URL action.
  const onlyOpenLink =
    ctas.length === 1 && ctas[0].kind === 'open_link' && (ctas[0].href ?? ctas[0].value);
  if (onlyOpenLink) {
    const cta = ctas[0];
    const url = (cta.href ?? cta.value ?? '').trim();
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          header: card.imageUrl ? { type: 'image', image: { link: card.imageUrl } } : undefined,
          body: { text: body },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: clip(cta.label, WA_BUTTON_TITLE_MAX),
              url,
            },
          },
        },
      }),
    };
  }

  // Mixed CTAs (e.g. open_link + reply approve) — Cloud API has no
  // hybrid interactive that mixes URL + reply, so we degrade to a text
  // bubble that includes the URL inline (with preview_url=true so the
  // link card unfurls). Keeps the link tappable; the reply CTAs are
  // expected to surface elsewhere (operator console / Slack) anyway.
  const openLinkCta = ctas.find(c => c.kind === 'open_link' && (c.href ?? c.value));
  if (openLinkCta && ctas.length > 1) {
    const url = (openLinkCta.href ?? openLinkCta.value ?? '').trim();
    const inline = `${body}\n\n${openLinkCta.label}: ${url}`;
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body: clipBody(inline, WA_BODY_MAX), preview_url: true },
      }),
      degraded: true,
    };
  }

  if (fitsButton) {
    const buttons = ctas.slice(0, MAX_BUTTONS).map(cta => ({
      type: 'reply' as const,
      reply: { id: ctaToButtonId(cta), title: clip(cta.label, WA_BUTTON_TITLE_MAX) },
    }));
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'button',
          header: card.imageUrl ? { type: 'image', image: { link: card.imageUrl } } : undefined,
          body: { text: body },
          action: { buttons },
        },
      }),
    };
  }

  if (ctas.length === 0) {
    if (card.imageUrl) {
      return {
        channel: 'whatsapp',
        payload: envelope({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '',
          type: 'image',
          image: { link: card.imageUrl, caption: body },
        }),
      };
    }
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body, preview_url: false },
      }),
    };
  }

  const rows = ctas.slice(0, WA_LIST_ROWS_MAX).map(cta => ({
    id: ctaToButtonId(cta),
    title: clip(cta.label, WA_BUTTON_TITLE_MAX),
    description: cta.value ? clip(cta.value, 72) : undefined,
  }));

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: clip('View options', WA_LIST_BUTTON_MAX),
          sections: [{ title: clip(card.title, 24), rows }],
        },
      },
    }),
    degraded: ctas.length > WA_LIST_ROWS_MAX,
  };
}

async function renderCard(msg: ChannelMessageCard): Promise<RenderedForChannel<WhatsAppPayload>> {
  // Image precedence: explicit imageUrl wins (export_route_map static-map
  // links, restaurant photos), otherwise fall back to the canonical
  // Satori OG card so the WhatsApp interactive header carries the same
  // brand frame the operator/email/web sees.
  const imageUrl =
    msg.imageUrl ??
    (await buildShareImageUrl({
      title: msg.title,
      body: msg.body,
      bullets: msg.bullets,
      primaryCta: msg.ctas?.[0] ? { label: msg.ctas[0].label } : undefined,
    })) ??
    undefined;
  return renderCardLike({
    title: msg.title,
    body: msg.body,
    bullets: msg.bullets,
    imageUrl,
    ctas: msg.ctas,
  });
}

async function renderToolResult(
  msg: ChannelMessageToolResult
): Promise<RenderedForChannel<WhatsAppPayload> | null> {
  if (!msg.share) return null;
  const ctas = [msg.share.primaryCta, ...(msg.share.secondaryCtas ?? [])].filter(
    (c): c is ChannelCta => Boolean(c)
  );
  const imageUrl =
    msg.share.imageUrl ??
    (await buildShareImageUrl({
      title: msg.share.title,
      body: msg.share.body,
      bullets: msg.share.bullets,
      primaryCta: msg.share.primaryCta ? { label: msg.share.primaryCta.label } : undefined,
    })) ??
    undefined;
  return renderCardLike({
    title: msg.share.title,
    body: msg.share.body,
    bullets: msg.share.bullets,
    imageUrl,
    ctas,
  });
}

/**
 * eSIM activation on WhatsApp — `cta_url` interactive with the QR PNG
 * as the image header and the universal install URL as the button.
 *
 * Why not embed the LPA: scheme directly in the button: WhatsApp's
 * Cloud API rejects non-HTTP/HTTPS URLs in `cta_url.action.parameters.url`
 * with `131009 Parameter value is not valid`. The install page on
 * sendero.travel is HTTPS, UA-detects iOS, and `window.location.href =
 * 'LPA:...'` from there — that's the canonical iOS-tap-to-install path.
 *
 * Android / desktop users tapping the button see the QR + per-device
 * tabs on the same install page, so one button serves every device.
 */
/**
 * Seat picker → WhatsApp interactive list (max 10 rows). When the offer
 * has more than 10 seats, we cut the cheapest 10 and tell the traveler
 * to ask for a row range. Description carries the price; tap routes to
 * `select_seat:<serviceId>` which the inbound handler decodes.
 */
function renderSeatPicker(msg: ChannelMessageSeatPicker): RenderedForChannel<WhatsAppPayload> {
  const passenger = msg.passengerName ?? msg.passengerId;
  const truncated = msg.options.length > WA_LIST_ROWS_MAX;
  const options = msg.options.slice(0, WA_LIST_ROWS_MAX);

  if (options.length === 0) {
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body: `No seats available for ${passenger} on this segment.`, preview_url: false },
      }),
    };
  }

  const bodyLines = [`*Seat for ${passenger}*`, 'Pick one — fare adjusts at booking.'];
  if (truncated) {
    bodyLines.push(`(Cheapest ${WA_LIST_ROWS_MAX} of ${msg.options.length} shown.)`);
  }

  const rows = options.map(o => ({
    // ID is opaque to WhatsApp; route via
    // `select_seat:<tripId>:<offerId>:<passengerId>:<svcId>:<designator>`
    // so the inbound handler can stage without a re-lookup. WhatsApp
    // caps row IDs at 200 chars; offer/passenger/svc Duffel ids are
    // ~30 each so this fits comfortably.
    id: clip(
      `select_seat:${msg.tripId}:${msg.offerId}:${msg.passengerId}:${o.serviceId}:${o.designator}`,
      200
    ),
    title: clip(o.designator, WA_BUTTON_TITLE_MAX),
    description: clip(`${o.price} ${o.currency}${o.cabinClass ? ` · ${o.cabinClass}` : ''}`, 72),
  }));

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: clipBody(bodyLines.join('\n'), WA_BODY_MAX) },
        action: {
          button: clip('Pick seat', WA_LIST_BUTTON_MAX),
          sections: [{ title: clip('Seats', 24), rows }],
        },
      },
    }),
  };
}

/**
 * Ancillary picker → WhatsApp interactive list. Bags + CFAR collapsed
 * into one list. Tap routes to `add_bag:<offer>:<svcId>` (cfar surfaces
 * as a non-interactive row with `cfar:<svcId>` id).
 */
function renderAncillaryPicker(
  msg: ChannelMessageAncillaryPicker
): RenderedForChannel<WhatsAppPayload> {
  const passenger = msg.passengerName ?? msg.passengerId;
  const allRows: Array<{ id: string; title: string; description?: string }> = [];

  for (const bag of msg.bags) {
    const meta = [bag.weightKg ? `${bag.weightKg}kg` : null, bag.dimensions]
      .filter(Boolean)
      .join(' · ');
    allRows.push({
      // `add_bag:<tripId>:<offerId>:<passengerId>:<svcId>:<label>` —
      // same encoding pattern as seat picker. Inbound handler stages
      // via add_baggage tool without re-fetching the offer.
      id: clip(
        `add_bag:${msg.tripId}:${msg.offerId}:${msg.passengerId}:${bag.serviceId}:${bag.label}`,
        200
      ),
      title: clip(bag.label, WA_BUTTON_TITLE_MAX),
      description: clip(`${bag.price} ${bag.currency}${meta ? ` · ${meta}` : ''}`, 72),
    });
  }
  for (const cfar of msg.cancelForAnyReason ?? []) {
    allRows.push({
      id: clip(`cfar:${msg.offerId}:${cfar.serviceId}`, 200),
      title: clip('Cancel anytime', WA_BUTTON_TITLE_MAX),
      description: clip(`${cfar.price} ${cfar.currency} · ${cfar.summary}`, 72),
    });
  }

  if (allRows.length === 0) {
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: { body: `No optional extras for this offer.`, preview_url: false },
      }),
    };
  }

  const rows = allRows.slice(0, WA_LIST_ROWS_MAX);
  const bodyText = clipBody(
    [`*Bags + extras for ${passenger}*`, 'Tap to add — fare adjusts at booking.'].join('\n'),
    WA_BODY_MAX
  );

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: clip('View options', WA_LIST_BUTTON_MAX),
          sections: [{ title: clip('Extras', 24), rows }],
        },
      },
    }),
  };
}

/**
 * Trip brief → WhatsApp. When a share URL is present and there's
 * material to summarize, we use a `cta_url` interactive (single tap
 * opens the public /trip/[token] page where the rich layout lives).
 * The body is a markdown-lite recap that fits inside WA's 1024-char
 * cap. Without a share URL, falls back to a text bubble.
 */
function renderTripBrief(msg: ChannelMessageTripBrief): RenderedForChannel<WhatsAppPayload> {
  const tripLabel = [msg.trip.origin, msg.trip.destination].filter(Boolean).join(' → ');
  const dateLabel =
    msg.trip.startDate && msg.trip.endDate
      ? `${msg.trip.startDate} → ${msg.trip.endDate}`
      : (msg.trip.startDate ?? msg.trip.endDate ?? '');

  const lines: string[] = [];
  lines.push(`*${msg.trip.name ?? tripLabel ?? `Trip ${msg.trip.tripId}`}*`);
  if (dateLabel) lines.push(`_${dateLabel}_`);
  if (msg.trip.status) lines.push(`Status: ${msg.trip.status}`);

  // Surface critical/warn alerts inline; WA users can't scroll modals
  // the way Slack threads can.
  const importantAlerts = msg.alerts.filter(a => a.severity !== 'info');
  if (importantAlerts.length > 0) {
    lines.push('');
    for (const a of importantAlerts) {
      const icon = a.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`${icon} ${a.message}`);
    }
  }

  if (msg.flights.length > 0) {
    lines.push('');
    lines.push('*✈️ Flights*');
    for (const f of msg.flights) {
      const route = `${f.origin ?? '?'} → ${f.destination ?? '?'}`;
      const stops = f.segmentCount > 1 ? ` · ${f.segmentCount}-stop` : '';
      const pnr = f.pnr ? ` (${f.pnr})` : '';
      lines.push(`• ${route}${stops}${pnr} · $${f.totalUsd}`);
    }
  }
  if (msg.stays.length > 0) {
    lines.push('');
    lines.push('*🏨 Stays*');
    for (const s of msg.stays) {
      const where = s.city ? `${s.property ?? 'Hotel'} · ${s.city}` : (s.property ?? 'Hotel');
      const nights = s.nights ? ` · ${s.nights}n` : '';
      lines.push(`• ${where}${nights} · $${s.totalUsd}`);
    }
  }
  if (msg.esims.length > 0) {
    lines.push('');
    lines.push('*📱 Connectivity*');
    for (const e of msg.esims) {
      const gb = (e.dataMb / 1024).toFixed(1);
      const where = e.countries.join('/') || '—';
      lines.push(`• ${gb} GB · ${e.validityDays}d · ${where} · ${e.status}`);
    }
  }

  // Fall through case: no bookings + no warnings → just say so.
  if (
    msg.flights.length === 0 &&
    msg.stays.length === 0 &&
    msg.esims.length === 0 &&
    importantAlerts.length === 0
  ) {
    lines.push('');
    lines.push('No bookings yet — what should we plan first?');
  }

  const body = clipBody(lines.join('\n'), WA_BODY_MAX);

  if (msg.shareUrl) {
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: body },
          footer: { text: 'Tap to share or save the full trip view' },
          action: {
            name: 'cta_url',
            parameters: {
              display_text: clip('🔗 Open trip', WA_BUTTON_TITLE_MAX),
              url: msg.shareUrl,
            },
          },
        },
      }),
    };
  }

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: false },
    }),
  };
}

function renderEsimActivation(
  msg: ChannelMessageEsimActivation
): RenderedForChannel<WhatsAppPayload> {
  const ios = INSTALL_INSTRUCTIONS.ios;
  const sizeLine = `${(msg.dataMb / 1024).toFixed(1)} GB · ${msg.validityDays} days · ${msg.countries.join(', ')}`;
  const body = clipBody(
    [
      `*Trip eSIM ready*`,
      `*${msg.planLabel}*`,
      sizeLine,
      msg.priceLine ?? '',
      '',
      `iPhone (${ios.subLabel ?? 'iOS 17.4+'}) — tap below for one-tap install.`,
      `Android — tap below, scan the QR shown on the page.`,
    ]
      .filter(Boolean)
      .join('\n'),
    WA_BODY_MAX
  );

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'cta_url',
        // QR PNG as the visual header — eSIM Go's image is publicly
        // fetchable via the Sendero proxy allowlist (`/api/esim/qr/*`),
        // so WhatsApp's media fetcher can pull it for the preview.
        header: { type: 'image', image: { link: msg.qrUrl } },
        body: { text: body },
        footer: { text: 'Scan QR or tap to install' },
        action: {
          name: 'cta_url',
          parameters: {
            display_text: clip('📱 Install eSIM', WA_BUTTON_TITLE_MAX),
            url: msg.installUrl,
          },
        },
      },
    }),
  };
}

function renderSources(msg: ChannelMessageSources): RenderedForChannel<WhatsAppPayload> | null {
  if (!msg.items || msg.items.length === 0) return null;
  const lines = msg.items
    .slice(0, MAX_SOURCES)
    .map((item, i) => `${i + 1}. ${item.title} - ${item.url}`);
  const body = clipBody(`Sources:\n${lines.join('\n')}`, WA_BODY_MAX);
  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: true },
    }),
  };
}

/**
 * Render a canonical ChannelMessage as a WhatsApp send payload.
 * Returns null when the canonical kind is intentionally not relayed
 * (reasoning, raw tool_invocation, operator approval cards).
 */
export const renderForWhatsApp: ChannelRenderer<WhatsAppPayload> = async (
  msg: ChannelMessage
): Promise<RenderedForChannel<WhatsAppPayload> | null> => {
  switch (msg.kind) {
    case 'text':
      return renderText(msg);
    case 'card':
      return await renderCard(msg);
    case 'tool_invocation':
      return null;
    case 'tool_result':
      return await renderToolResult(msg);
    case 'approval_request':
      return null;
    case 'reasoning':
      return null;
    case 'sources':
      return renderSources(msg);
    case 'esim_activation':
      return renderEsimActivation(msg);
    case 'seat_picker':
      return renderSeatPicker(msg);
    case 'ancillary_picker':
      return renderAncillaryPicker(msg);
    case 'trip_brief':
      return renderTripBrief(msg);
    case 'stay_search_results':
      return renderStaySearchResults(msg);
    case 'stay_rate_picker':
      return renderStayRatePicker(msg);
    case 'stay_quote_review':
      return renderStayQuoteReview(msg);
    case 'stay_booking_confirmation':
      return renderStayBookingConfirmation(msg);
    default:
      return exhaustive(msg);
  }
};

// ── Stays renderers ───────────────────────────────────────────────────
//
// WhatsApp Cloud API doesn't have native rich cards, so the strategy is:
//   • text block carries the verbatim Duffel info (billing rows, timeline,
//     conditions, key collection, business details)
//   • interactive button or list adds the action affordance
//
// Per Duffel Go-Live we surface every required field even when the
// channel is text-heavy — the spec is about information, not pixels.

function fmtMoneyStay(amount: string, currency: string): string {
  if (!amount) return '—';
  const n = Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${amount} ${currency}`;
  }
}

function billingBlock(b: ChannelStayBilling): string {
  return [
    `Room    ${fmtMoneyStay(b.baseAmount ?? b.totalAmount, b.baseCurrency ?? b.totalCurrency)}`,
    `Taxes   ${fmtMoneyStay(b.taxAmount, b.taxCurrency)}`,
    `Fees    ${fmtMoneyStay(b.feeAmount, b.feeCurrency)}`,
    `Total   ${fmtMoneyStay(b.totalAmount, b.totalCurrency)}`,
    `Due at property ${fmtMoneyStay(b.dueAtAccommodationAmount, b.dueAtAccommodationCurrency)}`,
  ].join('\n');
}

function cancellationBlock(entries: ChannelStayCancellationEntry[], totalAmount: string): string {
  if (!entries.length) return 'Non-refundable — no refund after booking.';
  const lines: string[] = [];
  for (const t of entries) {
    const isFull = Number(t.refundAmount) >= Number(totalAmount);
    lines.push(
      `${isFull ? '✓ Full refund' : '⚠ Partial refund'} until ${t.before.slice(0, 10)} — ${fmtMoneyStay(t.refundAmount, t.currency)}`
    );
  }
  lines.push(`✗ No refund after ${entries[entries.length - 1]!.before.slice(0, 10)}`);
  return lines.join('\n');
}

function conditionsBlock(conditions: ChannelStayCondition[]): string {
  if (!conditions.length) return '';
  return conditions
    .map(c => `*${c.title}*${c.description ? `\n${c.description}` : ''}`)
    .join('\n\n');
}

function businessFooterBlock(b: ChannelStayBusinessDetails): string {
  return [
    `_Sold by ${b.name}_`,
    b.address,
    `${b.supportEmail} · ${b.supportPhone}`,
    `Booking conditions & T&C: ${b.termsUrl}`,
    b.bookingComTermsUrl ? `Booking.com terms: ${b.bookingComTermsUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function keyCollectionLine(instructions: string | null): string {
  return `*Key collection*\n${instructions ?? 'Ask at the property on arrival — Duffel returned no key-collection note.'}`;
}

function renderStaySearchResults(
  msg: ChannelMessageStaySearchResults
): RenderedForChannel<WhatsAppPayload> {
  const headerLines = [
    `*🏨 ${msg.hotels.length} hotel${msg.hotels.length === 1 ? '' : 's'}*`,
    `${msg.checkInDate} → ${msg.checkOutDate}`,
    `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'}`,
  ];

  if (msg.hotels.length === 0) {
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'text',
        text: {
          body: clipBody(
            [...headerLines, '', 'No matching hotels for this window.'].join('\n'),
            WA_BODY_MAX
          ),
          preview_url: false,
        },
      }),
    };
  }

  const truncated = msg.hotels.length > WA_LIST_ROWS_MAX;
  const top = msg.hotels.slice(0, WA_LIST_ROWS_MAX);
  const rows = top.map(h => {
    const refundChip =
      h.cancellation === 'free' ? '✓' : h.cancellation === 'non_refundable' ? '✗' : '~';
    const stars = h.stars ? `${'★'.repeat(Math.min(5, Math.round(h.stars)))} ` : '';
    return {
      id: clip(`select_stay_hotel:${h.searchResultId}`, 200),
      title: clip(
        `${stars}${fmtMoneyStay(h.cheapestPrice, h.cheapestCurrency)} ${refundChip}`,
        WA_BUTTON_TITLE_MAX
      ),
      description: clip(
        `${h.name}${h.city ? ` · ${h.city}` : ''}${h.reviewScore !== null ? ` · ${h.reviewScore.toFixed(1)}/10` : ''}`,
        72
      ),
    };
  });

  const trailer = truncated
    ? `\n\n_(Showing top ${WA_LIST_ROWS_MAX} of ${msg.hotels.length} hotels.)_`
    : '';
  const footer = `\n\n${businessFooterBlock(msg.business)}`;
  const body = clipBody(headerLines.join('\n') + trailer + footer, WA_BODY_MAX);

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: clip('Hotels', 60) },
        body: { text: body },
        action: {
          button: clip('Pick a hotel', WA_BUTTON_TITLE_MAX),
          sections: [{ title: clip('Hotels', 24), rows }],
        },
      },
    }),
    degraded: truncated,
  };
}

function renderStayRatePicker(
  msg: ChannelMessageStayRatePicker
): RenderedForChannel<WhatsAppPayload> {
  const headerLines: string[] = [
    `*${msg.accommodation.name}*`,
    msg.accommodation.address ??
      [msg.accommodation.city, msg.accommodation.country].filter(Boolean).join(' · '),
    `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'}${msg.checkInDate && msg.checkOutDate ? ` · ${msg.checkInDate} → ${msg.checkOutDate}` : ''}`,
  ].filter(Boolean);
  const text = headerLines.join('\n');

  const truncated = msg.rates.length > WA_LIST_ROWS_MAX;
  const top = msg.rates.slice(0, WA_LIST_ROWS_MAX);
  const rows = top.map(r => ({
    id: clip(`select_stay_rate:${r.rateId}`, 200),
    title: clip(
      `${fmtMoneyStay(r.billing.totalAmount, r.billing.totalCurrency)} ${r.refundable ? '✓' : '✗'}`,
      WA_BUTTON_TITLE_MAX
    ),
    description: clip(
      `${r.roomName ?? '—'} · ${r.paymentType ?? 'pay_now'} · methods: ${r.availablePaymentMethods.join(',') || 'balance'}`,
      72
    ),
  }));

  const trailer = truncated
    ? `\n\n_(Showing top ${WA_LIST_ROWS_MAX} of ${msg.rates.length} rates.)_`
    : '';
  const footer = `\n\n${businessFooterBlock(msg.business)}`;

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'list',
        header: { type: 'text', text: clip('Hotel rates', 60) },
        body: { text: clipBody(text + trailer + footer, WA_BODY_MAX) },
        action: {
          button: clip('Pick a rate', WA_BUTTON_TITLE_MAX),
          sections: [{ title: clip('Rates', 24), rows }],
        },
      },
    }),
    degraded: truncated,
  };
}

function renderStayQuoteReview(
  msg: ChannelMessageStayQuoteReview
): RenderedForChannel<WhatsAppPayload> {
  const sections: string[] = [
    `*${msg.accommodation.name}*`,
    msg.accommodation.address ?? '',
    `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'} · ${msg.nights} night${msg.nights === 1 ? '' : 's'}`,
    `Check in ${msg.checkInDate}${msg.accommodation.checkInAfter ? ` from ${msg.accommodation.checkInAfter}` : ''}`,
    `Check out ${msg.checkOutDate}${msg.accommodation.checkOutBefore ? ` until ${msg.accommodation.checkOutBefore}` : ''}`,
    '',
    '*Billing*',
    billingBlock(msg.billing),
    '',
    '*Cancellation policy*',
    cancellationBlock(msg.cancellationTimeline, msg.billing.totalAmount),
  ];
  const cond = conditionsBlock(msg.conditions);
  if (cond) {
    sections.push('', '*Hotel policy & rate conditions*', cond);
  }
  sections.push('', keyCollectionLine(msg.accommodation.keyCollection));
  sections.push('', businessFooterBlock(msg.business));
  const body = clipBody(sections.filter(s => s !== undefined).join('\n'), WA_BODY_MAX);

  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: clip(`confirm_stay_booking:${msg.quoteId}`, 200),
                title: clip('Confirm booking', WA_BUTTON_TITLE_MAX),
              },
            },
            {
              type: 'reply',
              reply: {
                id: clip(`cancel_stay_booking:${msg.quoteId}`, 200),
                title: clip('Cancel', WA_BUTTON_TITLE_MAX),
              },
            },
          ],
        },
      },
    }),
  };
}

function renderStayBookingConfirmation(
  msg: ChannelMessageStayBookingConfirmation
): RenderedForChannel<WhatsAppPayload> {
  const sections: string[] = [
    '*Booking confirmed ✓*',
    `Reference: ${msg.reference}`,
    msg.confirmedAt ? `Confirmed at ${msg.confirmedAt.slice(0, 19).replace('T', ' ')}` : '',
    '',
    `*${msg.accommodation.name}*`,
    msg.accommodation.address ?? '',
    `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'} · ${msg.nights} night${msg.nights === 1 ? '' : 's'}${msg.roomName ? ` · ${msg.roomName}` : ''}`,
    `Check in ${msg.checkInDate}${msg.accommodation.checkInAfter ? ` from ${msg.accommodation.checkInAfter}` : ''}`,
    `Check out ${msg.checkOutDate}${msg.accommodation.checkOutBefore ? ` until ${msg.accommodation.checkOutBefore}` : ''}`,
    '',
    '*Billing*',
    billingBlock(msg.billing),
    '',
    '*Cancellation policy*',
    cancellationBlock(msg.cancellationTimeline, msg.billing.totalAmount),
  ];
  const cond = conditionsBlock(msg.conditions);
  if (cond) sections.push('', '*Hotel policy & rate conditions*', cond);
  sections.push('', keyCollectionLine(msg.accommodation.keyCollection));
  sections.push('', businessFooterBlock(msg.business));

  const body = clipBody(
    sections
      .filter(s => s !== undefined && s !== '')
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
    WA_BODY_MAX
  );

  if (msg.tripUrl) {
    return {
      channel: 'whatsapp',
      payload: envelope({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '',
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: body },
          action: {
            name: 'cta_url',
            parameters: { display_text: clip('View trip', WA_BUTTON_TITLE_MAX), url: msg.tripUrl },
          },
        },
      }),
    };
  }
  return {
    channel: 'whatsapp',
    payload: envelope({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '',
      type: 'text',
      text: { body, preview_url: false },
    }),
  };
}
