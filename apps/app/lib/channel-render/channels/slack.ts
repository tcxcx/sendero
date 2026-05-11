/**
 * Slack channel renderer.
 *
 * Translates a `ChannelMessage` into a Slack chat.postMessage payload.
 * The operator (DM) and channel-routed (public/private) Slack UIs both
 * consume the same Block Kit blocks, so this renderer's output flows
 * straight into the existing `@sendero/slack` send helpers.
 *
 * Reference: https://api.slack.com/reference/block-kit/blocks
 *
 * Channel + thread_ts are populated by the SENDER, not the renderer.
 * The renderer emits `channel: ''` and `thread_ts: undefined`; the
 * downstream send helper (e.g. `sendApprovalRequest`) fills both from
 * its own context (DM open response, parent message ts, etc.). This
 * keeps the renderer pure: canonical message in, native shape out, no
 * runtime dependency on Slack identifiers.
 *
 * The approval kind reuses `buildApprovalBlocks` from `@sendero/slack`
 * so this canonical renderer and the existing `sendApprovalRequest`
 * path produce byte-identical Block Kit. When folding the legacy path
 * into this renderer in a follow-up, the only change should be the
 * call site, not the rendered blocks.
 *
 * Returns null when the canonical kind is intentionally not relayed
 * to Slack (reasoning, raw tool_result without share, empty sources).
 */

import { buildApprovalBlocks } from '@sendero/slack';

import { buildShareImageUrl } from '@/lib/og/share-url';

import { INSTALL_INSTRUCTIONS } from '../install-instructions';
import type {
  ChannelCta,
  ChannelMessage,
  ChannelMessageAncillaryPicker,
  ChannelMessageCard,
  ChannelMessageEsimActivation,
  ChannelMessageSeatPicker,
  ChannelMessageStayBookingConfirmation,
  ChannelMessageStayQuoteReview,
  ChannelMessageStayRatePicker,
  ChannelMessageStaySearchResults,
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
 * Slack chat.postMessage subset. Use Slack's KnownBlock when narrowing
 * downstream — kept loose here so this renderer doesn't pull
 * `@slack/web-api` types into the channel-render package.
 */
export interface SlackPayload {
  channel: string;
  thread_ts?: string;
  text: string;
  blocks?: unknown[];
  attachments?: unknown[];
}

const MAX_SECTION_TEXT = 2900;
const MAX_BUTTONS_PER_ACTIONS_BLOCK = 5;

export const renderForSlack: ChannelRenderer<SlackPayload> = async (
  msg: ChannelMessage
): Promise<RenderedForChannel<SlackPayload> | null> => {
  switch (msg.kind) {
    case 'text':
      return renderText(msg.content);
    case 'card':
      return await renderCard(msg);
    case 'tool_invocation':
      return renderToolInvocation(msg.toolName);
    case 'tool_result':
      return await renderToolResult(msg);
    case 'approval_request':
      return renderApprovalRequest(msg);
    case 'reasoning':
      // Reasoning is operator-only by design. Slack never sees raw
      // model thinking — surfacing it would leak the agent's
      // intermediate state to travelers and approvers.
      return null;
    case 'sources':
      return renderSources(msg.items);
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

function renderText(content: string): RenderedForChannel<SlackPayload> {
  const mrkdwn = toSlackMrkdwn(content);
  const truncated = truncate(mrkdwn, MAX_SECTION_TEXT);
  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: stripMrkdwn(truncated),
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: truncated },
        },
      ],
    },
  };
}

async function renderCard(msg: ChannelMessageCard): Promise<RenderedForChannel<SlackPayload>> {
  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: truncate(msg.title, 150), emoji: true },
  });

  if (msg.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(toSlackMrkdwn(msg.body), MAX_SECTION_TEXT),
      },
    });
  }

  if (msg.bullets && msg.bullets.length > 0) {
    const bulletText = msg.bullets.map(b => `• ${toSlackMrkdwn(b)}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(bulletText, MAX_SECTION_TEXT) },
    });
  }

  // Image precedence: explicit imageUrl on the card wins (export_route_map
  // returns a static-map URL, restaurant cards return Places photo URLs).
  // Otherwise fall back to the canonical Satori OG card so the operator
  // and the traveler see the same visual across channels.
  const imageUrl =
    msg.imageUrl ??
    (await buildShareImageUrl({
      title: msg.title,
      body: msg.body,
      bullets: msg.bullets,
      primaryCta: msg.ctas?.[0] ? { label: msg.ctas[0].label } : undefined,
    }));

  if (imageUrl) {
    blocks.push({
      type: 'image',
      image_url: imageUrl,
      alt_text: msg.title || 'Sendero card',
    });
  }

  if (msg.ctas && msg.ctas.length > 0) {
    blocks.push(...buildActionsBlocks(msg.ctas));
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: msg.title,
      blocks,
    },
  };
}

function renderToolInvocation(toolName: string): RenderedForChannel<SlackPayload> {
  // In-flight tool calls don't have a clean Slack representation the
  // way the operator console does. Emit a single mrkdwn line so the
  // operator (when this is their DM) sees something rather than a
  // dropped message. Callers gate this kind to operator-DM
  // destinations; the `degraded: true` flag signals the lossy mapping.
  const text = `_Sendero AI invoking \`${toolName}\`..._`;
  return {
    channel: 'slack',
    degraded: true,
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Sendero AI invoking ${toolName}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text },
        },
      ],
    },
  };
}

async function renderToolResult(
  msg: ChannelMessageToolResult
): Promise<RenderedForChannel<SlackPayload> | null> {
  // Raw tool results never reach Slack verbatim. Only the agent-curated
  // `share` block is safe to surface to operator + traveler.
  if (!msg.share) return null;

  const blocks: unknown[] = [];

  blocks.push({
    type: 'header',
    text: { type: 'plain_text', text: truncate(msg.share.title, 150), emoji: true },
  });

  if (msg.share.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(toSlackMrkdwn(msg.share.body), MAX_SECTION_TEXT),
      },
    });
  }

  if (msg.share.bullets && msg.share.bullets.length > 0) {
    const bulletText = msg.share.bullets.map(b => `• ${toSlackMrkdwn(b)}`).join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(bulletText, MAX_SECTION_TEXT) },
    });
  }

  // Image precedence mirrors the card path: tool-supplied imageUrl wins,
  // otherwise the canonical Satori OG fallback fills the visual slot so
  // every channel renders the same card art.
  const imageUrl =
    msg.share.imageUrl ??
    (await buildShareImageUrl({
      title: msg.share.title,
      body: msg.share.body,
      bullets: msg.share.bullets,
      primaryCta: msg.share.primaryCta ? { label: msg.share.primaryCta.label } : undefined,
    }));

  if (imageUrl) {
    blocks.push({
      type: 'image',
      image_url: imageUrl,
      alt_text: msg.share.title || 'Sendero card',
    });
  }

  const ctas: ChannelCta[] = [];
  if (msg.share.primaryCta) ctas.push(msg.share.primaryCta);
  if (msg.share.secondaryCtas) ctas.push(...msg.share.secondaryCtas);
  if (ctas.length > 0) {
    blocks.push(...buildActionsBlocks(ctas));
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: msg.share.title,
      blocks,
    },
  };
}

function renderApprovalRequest(msg: {
  id: string;
  subject: {
    travelerName: string;
    route: string;
    amountUsd: number;
    expiresAt?: string;
    reason?: string;
  };
  reviewUrl?: string;
}): RenderedForChannel<SlackPayload> {
  // Reuse the canonical Slack approval card. tenantId + tripId are
  // populated by the caller — this renderer is a pure mapper and does
  // not touch the DB. The send-helper wraps the blocks with a real
  // tenantId/tripId before chat.postMessage. bookingId doubles as the
  // canonical ChannelMessage id so the interaction round-trip lands
  // on the right record.
  const blocks = buildApprovalBlocks(
    {
      tenantId: '',
      tripId: '',
      bookingId: msg.id,
      travelerName: msg.subject.travelerName,
      route: msg.subject.route,
      departAt: msg.subject.expiresAt ?? '',
      amountUsd: msg.subject.amountUsd,
      fareClass: '',
      policyReasons: msg.subject.reason ? [msg.subject.reason] : undefined,
    },
    msg.reviewUrl
  );

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Approval requested: ${msg.subject.travelerName}`,
      blocks: blocks as unknown[],
    },
  };
}

function renderSources(
  items: Array<{ title: string; url: string; snippet?: string; faviconUrl?: string }>
): RenderedForChannel<SlackPayload> | null {
  if (items.length === 0) return null;

  const linksMrkdwn = items.map(it => `<${it.url}|${escapeMrkdwn(it.title)}>`).join(' · ');
  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Sources: ${items.map(it => it.title).join(', ')}`,
      blocks: [
        {
          type: 'context',
          elements: [{ type: 'mrkdwn', text: truncate(linksMrkdwn, MAX_SECTION_TEXT) }],
        },
      ],
    },
  };
}

function renderEsimActivation(msg: ChannelMessageEsimActivation): RenderedForChannel<SlackPayload> {
  // Slack delivery: header + plan section + QR image + actions block
  // (primary = install URL, secondary = jump to instructions). The
  // image block is the canonical artifact; tapping the button lands on
  // the universal install page which then UA-redirects iOS users to the
  // LPA: scheme. iPhone users in the Slack mobile app open the link in
  // Safari and the redirect kicks in there.
  const ios = INSTALL_INSTRUCTIONS.ios;
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '📱 Trip eSIM ready', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncate(
          [
            `*${escapeMrkdwn(msg.planLabel)}*`,
            `${(msg.dataMb / 1024).toFixed(1)} GB · ${msg.validityDays} days · ${msg.countries.join(', ')}`,
            msg.priceLine ? `_${escapeMrkdwn(msg.priceLine)}_` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          MAX_SECTION_TEXT
        ),
      },
    },
    {
      type: 'image',
      image_url: msg.qrUrl,
      alt_text: `Install QR for ${msg.planLabel}`,
      title: { type: 'plain_text', text: 'Scan to install', emoji: true },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📱 Install on iPhone', emoji: true },
          url: msg.installUrl,
          action_id: 'sendero_open_link',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Other devices', emoji: true },
          url: `${msg.installUrl}#instructions`,
          action_id: 'sendero_open_link.instructions',
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: truncate(
            `iOS one-tap: ${escapeMrkdwn(ios.subLabel ?? '')}. Android scans the QR — tap "Other devices" for steps.`,
            MAX_SECTION_TEXT
          ),
        },
      ],
    },
  ];

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Trip eSIM ready: ${msg.planLabel}`,
      blocks,
    },
  };
}

/**
 * Slack collapses a seat grid to an overflow menu with up to 25 entries
 * (Slack's hard cap on overflow). Beyond that we surface the cheapest
 * 25 + a context note. Tap routes to `select_seat` via `sendero_select_seat`.
 */
const MAX_SLACK_SEAT_OPTIONS = 25;
const MAX_SLACK_BAG_OPTIONS = 5;

function renderSeatPicker(msg: ChannelMessageSeatPicker): RenderedForChannel<SlackPayload> {
  const passenger = msg.passengerName ?? msg.passengerId;
  const truncated = msg.options.length > MAX_SLACK_SEAT_OPTIONS;
  const options = msg.options.slice(0, MAX_SLACK_SEAT_OPTIONS);

  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🪑 Seat for ${passenger}`, emoji: true },
    },
  ];

  if (options.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No seats available for this segment._' },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Pick a seat — fare adjusts at booking.',
      },
      accessory: {
        type: 'overflow',
        action_id: 'sendero_select_seat',
        options: options.map(o => ({
          text: {
            type: 'plain_text',
            text: truncate(`${o.designator} · ${o.price} ${o.currency}`, 75),
            emoji: true,
          },
          value: truncate(
            JSON.stringify({
              tripId: msg.tripId,
              offerId: msg.offerId,
              passengerId: msg.passengerId,
              seatServiceId: o.serviceId,
              designator: o.designator,
              price: o.price,
              currency: o.currency,
            }),
            2000
          ),
        })),
      },
    });

    if (truncated) {
      blocks.push({
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Showing cheapest ${MAX_SLACK_SEAT_OPTIONS} of ${msg.options.length} seats. Ask for a row range to see more.`,
          },
        ],
      });
    }
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Seat picker for ${passenger}`,
      blocks,
    },
  };
}

function renderAncillaryPicker(
  msg: ChannelMessageAncillaryPicker
): RenderedForChannel<SlackPayload> {
  const passenger = msg.passengerName ?? msg.passengerId;
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🧳 Bags + extras for ${passenger}`, emoji: true },
    },
  ];

  if (msg.bags.length === 0 && (msg.cancelForAnyReason?.length ?? 0) === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No optional extras for this offer._' },
    });
  }

  for (const bag of msg.bags.slice(0, MAX_SLACK_BAG_OPTIONS)) {
    const meta = [bag.weightKg ? `${bag.weightKg}kg` : null, bag.dimensions]
      .filter(Boolean)
      .join(' · ');
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(bag.label)}*${meta ? `\n_${escapeMrkdwn(meta)}_` : ''}\n${bag.price} ${bag.currency}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Add', emoji: true },
        action_id: 'sendero_add_bag',
        value: truncate(
          JSON.stringify({
            tripId: msg.tripId,
            offerId: msg.offerId,
            passengerId: msg.passengerId,
            bagServiceId: bag.serviceId,
            quantity: 1,
            label: bag.label,
            price: bag.price,
            currency: bag.currency,
          }),
          2000
        ),
      },
    });
  }

  for (const cfar of msg.cancelForAnyReason ?? []) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Cancel for any reason*\n_${escapeMrkdwn(cfar.summary)}_\n${cfar.price} ${cfar.currency}`,
      },
    });
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Bags + extras for ${passenger}`,
      blocks,
    },
  };
}

/**
 * Trip brief → stacked Block Kit sections, one per kind. Operator
 * approvals + customer-support reads both consume this; the layout
 * deliberately mirrors the operator card so reading the same trip in
 * Slack vs. /dashboard/agent-chat gives the same visual rhythm.
 */
function renderTripBrief(msg: ChannelMessageTripBrief): RenderedForChannel<SlackPayload> {
  const tripLabel = [msg.trip.origin, msg.trip.destination].filter(Boolean).join(' → ');
  const dateLabel =
    msg.trip.startDate && msg.trip.endDate
      ? `${msg.trip.startDate} → ${msg.trip.endDate}`
      : (msg.trip.startDate ?? msg.trip.endDate ?? '');

  const headerText =
    msg.trip.name || tripLabel ? `🧭 ${msg.trip.name ?? tripLabel}` : `🧭 Trip ${msg.trip.tripId}`;
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: truncate(headerText, 150), emoji: true },
    },
  ];

  // Status + date row
  const contextLines: string[] = [`*Status:* ${msg.trip.status}`];
  if (dateLabel) contextLines.push(`*Dates:* ${dateLabel}`);
  if (tripLabel && msg.trip.name) contextLines.push(`*Route:* ${tripLabel}`);
  if (contextLines.length > 0) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: contextLines.join(' · ') }],
    });
  }

  // Critical / warn alerts surface up top so they're not lost below the
  // booking lists. Info-level alerts skip the visual emphasis.
  const importantAlerts = msg.alerts.filter(a => a.severity !== 'info');
  if (importantAlerts.length > 0) {
    const text = importantAlerts
      .map(a => {
        const icon = a.severity === 'critical' ? '🔴' : '🟡';
        return `${icon} ${escapeMrkdwn(a.message)}`;
      })
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) },
    });
  }

  if (msg.flights.length > 0) {
    const text = [
      '*✈️ Flights*',
      ...msg.flights.map(f => {
        const route = `${f.origin ?? '?'} → ${f.destination ?? '?'}`;
        const stops = f.segmentCount > 1 ? ` · ${f.segmentCount}-stop` : '';
        const pnr = f.pnr ? ` · \`${f.pnr}\`` : '';
        return `• ${route}${stops}${pnr} · $${f.totalUsd}`;
      }),
    ].join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) },
    });
  }

  if (msg.stays.length > 0) {
    const text = [
      '*🏨 Stays*',
      ...msg.stays.map(s => {
        const where = s.city ? `${s.property ?? 'Hotel'} · ${s.city}` : (s.property ?? 'Hotel');
        const nights = s.nights ? ` · ${s.nights}n` : '';
        return `• ${where}${nights} · $${s.totalUsd}`;
      }),
    ].join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) },
    });
  }

  if (msg.esims.length > 0) {
    const text = [
      '*📱 Connectivity*',
      ...msg.esims.map(e => {
        const gb = (e.dataMb / 1024).toFixed(1);
        const where = e.countries.join('/') || '—';
        return `• ${gb} GB · ${e.validityDays}d · ${where} · ${e.status}`;
      }),
    ].join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) },
    });
  }

  if (msg.shareUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '🔗 Share trip', emoji: true },
          url: msg.shareUrl,
          action_id: 'sendero_open_link.trip_share',
          style: 'primary',
        },
      ],
    });
  }

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Trip ${msg.trip.tripId}: ${tripLabel || msg.trip.status}`,
      blocks,
    },
  };
}

function buildActionsBlocks(ctas: ChannelCta[]): unknown[] {
  const elements = ctas.map(cta => ctaToButton(cta));
  const blocks: unknown[] = [];
  for (let i = 0; i < elements.length; i += MAX_BUTTONS_PER_ACTIONS_BLOCK) {
    blocks.push({
      type: 'actions',
      elements: elements.slice(i, i + MAX_BUTTONS_PER_ACTIONS_BLOCK),
    });
  }
  return blocks;
}

function ctaToButton(cta: ChannelCta): Record<string, unknown> {
  const text = { type: 'plain_text', text: cta.label, emoji: true } as const;
  const style = cta.emphasis === 'primary' ? 'primary' : undefined;

  if (cta.kind === 'open_link') {
    const btn: Record<string, unknown> = {
      type: 'button',
      text,
      action_id: 'sendero_open_link',
      url: cta.href ?? cta.value ?? '',
    };
    if (cta.value) btn.value = cta.value;
    if (style) btn.style = style;
    return btn;
  }

  // Stable action_id matches the prefix convention enforced by
  // `apps/app/app/api/webhooks/slack/interactions/route.ts`. The
  // dispatcher splits on '.' and routes by the leading segment, so
  // every kind we emit gets `sendero_<kind>.<value>`.
  const btn: Record<string, unknown> = {
    type: 'button',
    text,
    action_id: `sendero_${cta.kind}.${cta.value ?? ''}`,
  };
  if (cta.value !== undefined) btn.value = cta.value;
  if (style) btn.style = style;
  return btn;
}

// markdown-to-mrkdwn conversion. Intentionally minimal: the agent
// emits markdown-lite already, so this only handles the gaps that
// would render visibly broken.
//
// Intentional:
//   `**bold**`       -> `*bold*`        (Slack mrkdwn bold)
//   `[label](url)`   -> `<url|label>`   (Slack link syntax)
//   `- item` / `* item` -> `• item`     (visible bullet)
//
// Lossy / not handled:
//   - headings (`# foo`) pass through as plain text
//   - inline `_italic_` already valid mrkdwn; markdown italic
//     `*italic*` collides with bold and is left alone
//   - tables, footnotes, blockquotes beyond a single `> `
export function toSlackMrkdwn(input: string): string {
  let s = input;
  s = s.replace(/\*\*(.+?)\*\*/g, '*$1*');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
  s = s.replace(/^[\t ]*[-*][\t ]+/gm, '• ');
  return s;
}

// Plain-text fallback for the top-level `text` field. Strips the
// mrkdwn markers added above plus any link syntax so screen readers
// and notification previews get a clean string.
export function stripMrkdwn(input: string): string {
  let s = input;
  s = s.replace(/<([^|>]+)\|([^>]+)>/g, '$2');
  s = s.replace(/\*([^*]+)\*/g, '$1');
  s = s.replace(/_([^_]+)_/g, '$1');
  return s;
}

function escapeMrkdwn(text: string): string {
  // Slack's link syntax breaks if the label contains `|` or `>`. Drop
  // them rather than HTML-escape — the surrounding context block is
  // tiny grey footer text and a missing pipe is invisible in practice.
  return text.replace(/[|>]/g, ' ');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

// ── Stays renderers ──────────────────────────────────────────────────
//
// Slack Block Kit can't replicate the rich card 1:1, but Duffel's review
// criteria are about *information* not pixel parity: every required field
// (billing breakdown separated, cancellation timeline verbatim, conditions
// verbatim, key collection always-visible, business details) ships in
// the rendered blocks below.

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

function billingLines(b: ChannelStayBilling): string[] {
  return [
    `*Room*    \`${fmtMoneyStay(b.baseAmount ?? b.totalAmount, b.baseCurrency ?? b.totalCurrency)}\``,
    `*Taxes*   \`${fmtMoneyStay(b.taxAmount, b.taxCurrency)}\``,
    `*Fees*    \`${fmtMoneyStay(b.feeAmount, b.feeCurrency)}\``,
    `*Total*   \`${fmtMoneyStay(b.totalAmount, b.totalCurrency)}\``,
    `*Due at property*  \`${fmtMoneyStay(b.dueAtAccommodationAmount, b.dueAtAccommodationCurrency)}\``,
  ];
}

function cancellationLines(entries: ChannelStayCancellationEntry[], totalAmount: string): string[] {
  if (!entries.length) return ['_Non-refundable — no refund after booking._'];
  const lines: string[] = [];
  for (const t of entries) {
    const isFull = Number(t.refundAmount) >= Number(totalAmount);
    lines.push(
      `${isFull ? ':white_check_mark: Full refund' : ':warning: Partial refund'} until ${t.before.slice(0, 10)} — \`${fmtMoneyStay(t.refundAmount, t.currency)}\``
    );
  }
  lines.push(`:x: No refund after ${entries[entries.length - 1]!.before.slice(0, 10)}`);
  return lines;
}

function conditionsBlocks(conditions: ChannelStayCondition[]): unknown[] {
  if (!conditions.length) return [];
  const blocks: unknown[] = [{ type: 'divider' }];
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Hotel policy & rate conditions*' },
  });
  for (const c of conditions) {
    const text = `*${escapeMrkdwn(c.title)}*\n${truncate(toSlackMrkdwn(c.description ?? ''), MAX_SECTION_TEXT - 4)}`;
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text } });
  }
  return blocks;
}

function businessFooter(b: ChannelStayBusinessDetails): unknown {
  const links = [
    `<mailto:${b.supportEmail}|${b.supportEmail}>`,
    b.supportPhone,
    `<${b.termsUrl}|Booking conditions & T&C>`,
    b.bookingComTermsUrl ? `<${b.bookingComTermsUrl}|Booking.com terms>` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');
  return {
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `_Sold by *${escapeMrkdwn(b.name)}* · ${escapeMrkdwn(b.address)}_\n${links}`,
      },
    ],
  };
}

function keyCollectionBlock(instructions: string | null): unknown {
  const text =
    instructions ?? 'Ask at the property on arrival — Duffel returned no key-collection note.';
  return {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*:key: Key collection*\n${truncate(toSlackMrkdwn(text), MAX_SECTION_TEXT - 4)}`,
    },
  };
}

function renderStaySearchResults(
  msg: ChannelMessageStaySearchResults
): RenderedForChannel<SlackPayload> {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🏨 ${msg.hotels.length} hotel${msg.hotels.length === 1 ? '' : 's'} · ${msg.checkInDate} → ${msg.checkOutDate}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'}`,
        },
      ],
    },
  ];

  if (msg.hotels.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No matching hotels for this window._' },
    });
  } else {
    blocks.push({ type: 'divider' });
    for (const h of msg.hotels) {
      const stars = h.stars ? ` · ${'★'.repeat(Math.min(5, Math.round(h.stars)))}` : '';
      const review = h.reviewScore !== null ? ` · ${h.reviewScore.toFixed(1)}/10` : '';
      const where = [h.city, h.country].filter(Boolean).join(' · ');
      const refundLabel =
        h.cancellation === 'free'
          ? '✅ free cancellation'
          : h.cancellation === 'partial'
            ? '⚠ partial refund'
            : h.cancellation === 'non_refundable'
              ? '❌ non-refundable'
              : '… refund TBC';
      const text =
        `*${escapeMrkdwn(h.name)}*${stars}${review}\n` +
        (where ? `${escapeMrkdwn(where)}\n` : '') +
        `${fmtMoneyStay(h.cheapestPrice, h.cheapestCurrency)} · ${refundLabel}` +
        (h.amenities.length ? `\n_${escapeMrkdwn(h.amenities.slice(0, 4).join(' · '))}_` : '');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: truncate(text, MAX_SECTION_TEXT) },
        ...(h.photos[0]
          ? { accessory: { type: 'image', image_url: h.photos[0], alt_text: h.name } }
          : {}),
      });
      blocks.push({
        type: 'actions',
        elements: [
          {
            type: 'button',
            style: 'primary',
            text: { type: 'plain_text', text: 'View rates', emoji: true },
            action_id: 'select_stay_hotel',
            value: h.searchResultId,
          },
        ],
      });
    }
  }

  blocks.push(businessFooter(msg.business));
  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `${msg.hotels.length} hotels · ${msg.checkInDate} → ${msg.checkOutDate}`,
      blocks,
    },
  };
}

function renderStayRatePicker(msg: ChannelMessageStayRatePicker): RenderedForChannel<SlackPayload> {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🏨 ${truncate(msg.accommodation.name, 140)}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'}${msg.checkInDate && msg.checkOutDate ? ` · ${msg.checkInDate} → ${msg.checkOutDate}` : ''}${msg.accommodation.address ? `\n${escapeMrkdwn(msg.accommodation.address)}` : ''}`,
        },
      ],
    },
  ];

  const grouped = new Map<string, typeof msg.rates>();
  for (const r of msg.rates) {
    const key = r.roomName ?? '—';
    const list = grouped.get(key);
    if (list) list.push(r);
    else grouped.set(key, [r]);
  }
  for (const [roomName, rates] of grouped) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*${escapeMrkdwn(roomName)}*` },
    });
    for (const r of rates) {
      const refundLabel = r.refundable ? '✅ refundable' : '❌ non-refundable';
      const methods = r.availablePaymentMethods.length ? r.availablePaymentMethods.join(', ') : '—';
      const paymentType = r.paymentType ? r.paymentType.replace(/_/g, ' ') : '—';
      const description =
        `${fmtMoneyStay(r.billing.totalAmount, r.billing.totalCurrency)} total\n` +
        `Tax \`${fmtMoneyStay(r.billing.taxAmount, r.billing.taxCurrency)}\` · ` +
        `Fee \`${fmtMoneyStay(r.billing.feeAmount, r.billing.feeCurrency)}\` · ` +
        `Due at property \`${fmtMoneyStay(r.billing.dueAtAccommodationAmount, r.billing.dueAtAccommodationCurrency)}\`\n` +
        `${refundLabel} · payment ${paymentType} (${methods})`;
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: description },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Pick this rate', emoji: true },
          action_id: 'select_stay_rate',
          value: r.rateId,
        },
      });
    }
  }
  blocks.push(businessFooter(msg.business));

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Hotel rates: ${msg.accommodation.name}`,
      blocks,
    },
  };
}

function renderStayQuoteReview(
  msg: ChannelMessageStayQuoteReview
): RenderedForChannel<SlackPayload> {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `🏨 ${truncate(msg.accommodation.name, 140)}`,
        emoji: true,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text:
            `${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'} · ${msg.nights} night${msg.nights === 1 ? '' : 's'}` +
            (msg.accommodation.address ? `\n${escapeMrkdwn(msg.accommodation.address)}` : ''),
        },
      ],
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Check in*\n${msg.checkInDate}${msg.accommodation.checkInAfter ? `\n_from ${msg.accommodation.checkInAfter}_` : ''}`,
        },
        {
          type: 'mrkdwn',
          text: `*Check out*\n${msg.checkOutDate}${msg.accommodation.checkOutBefore ? `\n_until ${msg.accommodation.checkOutBefore}_` : ''}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ['*Billing summary*', ...billingLines(msg.billing)].join('\n'),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Cancellation policy*',
          ...cancellationLines(msg.cancellationTimeline, msg.billing.totalAmount),
        ].join('\n'),
      },
    },
    ...conditionsBlocks(msg.conditions),
    keyCollectionBlock(msg.accommodation.keyCollection),
    buildStayQuoteActions(msg),
    businessFooter(msg.business),
  ];

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Hotel quote ${fmtMoneyStay(msg.billing.totalAmount, msg.billing.totalCurrency)} — ${msg.accommodation.name}`,
      blocks,
    },
  };
}

/**
 * Build the confirm/cancel actions block. When `travelerContact` is
 * present, the button value carries the minimum JSON needed for the
 * Slack interaction handler to actually run `book_stay` server-side.
 * When absent, we degrade to a "View on web" link so the user goes
 * back to the chat surface where the traveler IS authenticated.
 *
 * Action-id convention mirrors sendero_approval:
 *   confirm_stay_booking  → run book_stay
 *   cancel_stay_booking   → flip card to "Canceled" state, no API call
 *     (Duffel quotes expire on their own; no explicit cancel endpoint)
 */
function buildStayQuoteActions(msg: ChannelMessageStayQuoteReview): unknown {
  if (!msg.travelerContact || !msg.tenantId) {
    return {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in Sendero', emoji: true },
          action_id: 'open_link',
          // The chat surface stays the source of truth when the operator
          // taps from Slack without the traveler context attached.
          value: msg.quoteId,
        },
      ],
    };
  }

  // Pack {q,t,tr,e,g,f} into the button value JSON. Slack's `value`
  // field accepts up to 2000 chars; this payload is ~200 worst case.
  const c = msg.travelerContact;
  const value = JSON.stringify({
    q: msg.quoteId,
    t: msg.tenantId,
    ...(msg.tripId ? { tr: msg.tripId } : {}),
    e: c.email,
    g: c.givenName,
    f: c.familyName,
  });
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        style: 'primary',
        text: { type: 'plain_text', text: 'Confirm booking', emoji: true },
        action_id: 'confirm_stay_booking',
        value,
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Cancel', emoji: true },
        action_id: 'cancel_stay_booking',
        value,
      },
    ],
  };
}

function renderStayBookingConfirmation(
  msg: ChannelMessageStayBookingConfirmation
): RenderedForChannel<SlackPayload> {
  const blocks: unknown[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '✅ Booking confirmed', emoji: true },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Booking reference*\n\`${escapeMrkdwn(msg.reference)}\``,
        },
        {
          type: 'mrkdwn',
          text: msg.confirmedAt
            ? `*Confirmed at*\n${msg.confirmedAt.slice(0, 19).replace('T', ' ')}`
            : `*Status*\n${escapeMrkdwn(msg.status)}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeMrkdwn(msg.accommodation.name)}*${
          msg.accommodation.address ? `\n${escapeMrkdwn(msg.accommodation.address)}` : ''
        }\n${msg.rooms} room${msg.rooms === 1 ? '' : 's'} · ${msg.guests} guest${msg.guests === 1 ? '' : 's'} · ${msg.nights} night${msg.nights === 1 ? '' : 's'}${msg.roomName ? ` · ${escapeMrkdwn(msg.roomName)}` : ''}`,
      },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*Check in*\n${msg.checkInDate}${msg.accommodation.checkInAfter ? `\n_from ${msg.accommodation.checkInAfter}_` : ''}`,
        },
        {
          type: 'mrkdwn',
          text: `*Check out*\n${msg.checkOutDate}${msg.accommodation.checkOutBefore ? `\n_until ${msg.accommodation.checkOutBefore}_` : ''}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ['*Billing summary*', ...billingLines(msg.billing)].join('\n'),
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Cancellation policy*',
          ...cancellationLines(msg.cancellationTimeline, msg.billing.totalAmount),
        ].join('\n'),
      },
    },
    ...conditionsBlocks(msg.conditions),
    keyCollectionBlock(msg.accommodation.keyCollection),
  ];

  if (msg.tripUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'View trip', emoji: true },
          url: msg.tripUrl,
          action_id: 'open_link',
        },
      ],
    });
  }
  blocks.push(businessFooter(msg.business));

  return {
    channel: 'slack',
    payload: {
      channel: '',
      thread_ts: undefined,
      text: `Booking confirmed · ${msg.reference} · ${msg.accommodation.name}`,
      blocks,
    },
  };
}

function exhaustive(_: never): never {
  throw new Error('Unhandled ChannelMessage kind');
}
