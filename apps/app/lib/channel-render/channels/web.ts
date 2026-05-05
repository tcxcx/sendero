/**
 * Web traveler channel renderer.
 *
 * Translates a `ChannelMessage` into the JSON shape the traveler-facing
 * web bubble UI consumes. The Sendero web traveler view (when one
 * exists at /trip/[id] or similar) reads this payload and mounts the
 * corresponding bubble component.
 *
 * Distinct from the operator renderer: the operator console uses AI
 * Elements and renders TSX directly; the web traveler view is a
 * separate surface that mounts plain bubbles (text, image, card,
 * action-button-row) without the operator-only primitives like
 * Reasoning or raw ToolInvocation.
 */

import { buildShareImageUrl } from '@/lib/og/share-url';
import { DEVICE_ORDER, INSTALL_INSTRUCTIONS } from '../install-instructions';
import type {
  ChannelAuthor,
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
  ChannelMessageText,
  ChannelMessageToolResult,
  ChannelMessageTripBrief,
  ChannelRenderer,
  RenderedForChannel,
} from '../types';

/**
 * Plain JSON the web traveler bubble layer mounts. Keep this loose,
 * it is the contract the traveler view expects, not the wire format
 * of any external API.
 */
export interface WebTravelerPayload {
  bubble:
    | 'text'
    | 'card'
    | 'image'
    | 'actions'
    | 'sources'
    | 'esim_activation'
    | 'seat_picker'
    | 'ancillary_picker'
    | 'stay_rate_picker'
    | 'stay_quote_review'
    | 'stay_booking_confirmation'
    | 'trip_brief';
  /** Author metadata for the bubble header. */
  author: {
    role: 'agent' | 'operator' | 'system';
    name?: string;
    avatarUrl?: string;
  };
  /** Bubble content; shape narrows by `bubble` discriminant downstream. */
  content: unknown;
  /** ISO timestamp for traveler's local-tz formatting. */
  createdAt: string;
}

function exhaustive(_: never): never {
  throw new Error('non-exhaustive ChannelMessage kind in renderForWeb');
}

/**
 * Map canonical author to web-traveler-side author. Returns null for
 * `traveler` since the traveler view does not echo the user's own
 * messages back as bubbles, the operator-side renderer handles that.
 */
function mapAuthor(author: ChannelAuthor): WebTravelerPayload['author'] | null {
  if (author.role === 'traveler') return null;
  return {
    role: author.role,
    name: author.name,
    avatarUrl: author.avatarUrl,
  };
}

interface WebCardContent {
  title: string;
  body: string;
  bullets?: string[];
  imageUrl?: string;
  ctas?: ChannelCta[];
}

interface WebSourcesContent {
  items: Array<{
    title: string;
    url: string;
    snippet?: string;
    faviconUrl?: string;
  }>;
}

interface WebTextContent {
  markdown: string;
}

function renderText(
  msg: ChannelMessageText,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebTextContent = { markdown: msg.content };
  return {
    channel: 'web',
    payload: { bubble: 'text', author, content, createdAt: msg.createdAt },
  };
}

async function renderCard(
  msg: ChannelMessageCard,
  author: WebTravelerPayload['author']
): Promise<RenderedForChannel<WebTravelerPayload>> {
  // Web bubble fall-back chain mirrors Slack/WhatsApp: tool-supplied image
  // wins, otherwise the canonical Satori OG card fills the visual slot.
  const imageUrl =
    msg.imageUrl ??
    (await buildShareImageUrl({
      title: msg.title,
      body: msg.body,
      bullets: msg.bullets,
      primaryCta: msg.ctas?.[0] ? { label: msg.ctas[0].label } : undefined,
    })) ??
    undefined;
  const content: WebCardContent = {
    title: msg.title,
    body: msg.body,
    bullets: msg.bullets,
    imageUrl,
    ctas: msg.ctas,
  };
  return {
    channel: 'web',
    payload: { bubble: 'card', author, content, createdAt: msg.createdAt },
  };
}

async function renderToolResult(
  msg: ChannelMessageToolResult,
  author: WebTravelerPayload['author']
): Promise<RenderedForChannel<WebTravelerPayload> | null> {
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
  const content: WebCardContent = {
    title: msg.share.title,
    body: msg.share.body,
    bullets: msg.share.bullets,
    imageUrl,
    ctas: ctas.length > 0 ? ctas : undefined,
  };
  return {
    channel: 'web',
    payload: { bubble: 'card', author, content, createdAt: msg.createdAt },
  };
}

interface WebEsimActivationContent {
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
  /// Resolved per-device steps so the bubble UI can render tabs without
  /// re-importing the install-instructions module on the client.
  instructions: Array<{
    device: (typeof DEVICE_ORDER)[number];
    label: string;
    subLabel?: string;
    oneTap: boolean;
    steps: string[];
    showLpaCode?: boolean;
  }>;
}

function renderEsimActivation(
  msg: ChannelMessageEsimActivation,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebEsimActivationContent = {
    esimId: msg.esimId,
    planLabel: msg.planLabel,
    countries: msg.countries,
    dataMb: msg.dataMb,
    validityDays: msg.validityDays,
    qrUrl: msg.qrUrl,
    lpaCode: msg.lpaCode,
    installUrl: msg.installUrl,
    ...(msg.priceLine ? { priceLine: msg.priceLine } : {}),
    ...(msg.expiresAt ? { expiresAt: msg.expiresAt } : {}),
    instructions: DEVICE_ORDER.map(device => {
      const i = INSTALL_INSTRUCTIONS[device];
      return {
        device,
        label: i.label,
        ...(i.subLabel ? { subLabel: i.subLabel } : {}),
        oneTap: i.oneTap,
        steps: i.steps,
        ...(i.showLpaCode ? { showLpaCode: i.showLpaCode } : {}),
      };
    }),
  };
  return {
    channel: 'web',
    payload: { bubble: 'esim_activation', author, content, createdAt: msg.createdAt },
  };
}

interface WebSeatPickerContent {
  tripId: string;
  offerId: string;
  passengerId: string;
  passengerName?: string;
  selectedDesignator?: string;
  options: ChannelMessageSeatPicker['options'];
}

interface WebAncillaryPickerContent {
  tripId: string;
  offerId: string;
  passengerId: string;
  passengerName?: string;
  bags: ChannelMessageAncillaryPicker['bags'];
  cancelForAnyReason?: ChannelMessageAncillaryPicker['cancelForAnyReason'];
}

function renderSeatPicker(
  msg: ChannelMessageSeatPicker,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebSeatPickerContent = {
    tripId: msg.tripId,
    offerId: msg.offerId,
    passengerId: msg.passengerId,
    ...(msg.passengerName ? { passengerName: msg.passengerName } : {}),
    ...(msg.selectedDesignator ? { selectedDesignator: msg.selectedDesignator } : {}),
    options: msg.options,
  };
  return {
    channel: 'web',
    payload: { bubble: 'seat_picker', author, content, createdAt: msg.createdAt },
  };
}

function renderAncillaryPicker(
  msg: ChannelMessageAncillaryPicker,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebAncillaryPickerContent = {
    tripId: msg.tripId,
    offerId: msg.offerId,
    passengerId: msg.passengerId,
    ...(msg.passengerName ? { passengerName: msg.passengerName } : {}),
    bags: msg.bags,
    ...(msg.cancelForAnyReason && msg.cancelForAnyReason.length > 0
      ? { cancelForAnyReason: msg.cancelForAnyReason }
      : {}),
  };
  return {
    channel: 'web',
    payload: { bubble: 'ancillary_picker', author, content, createdAt: msg.createdAt },
  };
}

interface WebTripBriefContent {
  trip: ChannelMessageTripBrief['trip'];
  flights: ChannelMessageTripBrief['flights'];
  stays: ChannelMessageTripBrief['stays'];
  esims: ChannelMessageTripBrief['esims'];
  alerts: ChannelMessageTripBrief['alerts'];
  shareUrl: string | null;
}

function renderTripBrief(
  msg: ChannelMessageTripBrief,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> {
  const content: WebTripBriefContent = {
    trip: msg.trip,
    flights: msg.flights,
    stays: msg.stays,
    esims: msg.esims,
    alerts: msg.alerts,
    shareUrl: msg.shareUrl,
  };
  return {
    channel: 'web',
    payload: { bubble: 'trip_brief', author, content, createdAt: msg.createdAt },
  };
}

function renderSources(
  msg: ChannelMessageSources,
  author: WebTravelerPayload['author']
): RenderedForChannel<WebTravelerPayload> | null {
  if (!msg.items || msg.items.length === 0) return null;
  const content: WebSourcesContent = { items: msg.items };
  return {
    channel: 'web',
    payload: { bubble: 'sources', author, content, createdAt: msg.createdAt },
  };
}

export const renderForWeb: ChannelRenderer<WebTravelerPayload> = async (
  msg: ChannelMessage
): Promise<RenderedForChannel<WebTravelerPayload> | null> => {
  const author = mapAuthor(msg.author);
  if (!author) return null;

  switch (msg.kind) {
    case 'text':
      return renderText(msg, author);
    case 'card':
      return await renderCard(msg, author);
    case 'tool_invocation':
      return null;
    case 'tool_result':
      return await renderToolResult(msg, author);
    case 'approval_request':
      return null;
    case 'reasoning':
      return null;
    case 'sources':
      return renderSources(msg, author);
    case 'esim_activation':
      return renderEsimActivation(msg, author);
    case 'seat_picker':
      return renderSeatPicker(msg, author);
    case 'ancillary_picker':
      return renderAncillaryPicker(msg, author);
    case 'trip_brief':
      return renderTripBrief(msg, author);
    case 'stay_rate_picker':
      return renderStayRatePicker(msg, author);
    case 'stay_quote_review':
      return renderStayQuoteReview(msg, author);
    case 'stay_booking_confirmation':
      return renderStayBookingConfirmation(msg, author);
    default:
      return exhaustive(msg);
  }
};

function renderStayRatePicker(
  msg: ChannelMessageStayRatePicker,
  author: WebTravelerPayload['author'] | null
): RenderedForChannel<WebTravelerPayload> | null {
  if (!author) return null;
  return {
    channel: 'web',
    payload: {
      bubble: 'stay_rate_picker',
      author,
      content: {
        searchResultId: msg.searchResultId,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        rooms: msg.rooms,
        guests: msg.guests,
        rates: msg.rates,
        business: msg.business,
      },
      createdAt: msg.createdAt,
    },
  };
}

function renderStayQuoteReview(
  msg: ChannelMessageStayQuoteReview,
  author: WebTravelerPayload['author'] | null
): RenderedForChannel<WebTravelerPayload> | null {
  if (!author) return null;
  return {
    channel: 'web',
    payload: {
      bubble: 'stay_quote_review',
      author,
      content: {
        quoteId: msg.quoteId,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        nights: msg.nights,
        rooms: msg.rooms,
        guests: msg.guests,
        roomName: msg.roomName,
        paymentType: msg.paymentType,
        billing: msg.billing,
        cancellationTimeline: msg.cancellationTimeline,
        conditions: msg.conditions,
        supportedLoyaltyProgrammeName: msg.supportedLoyaltyProgrammeName,
        business: msg.business,
        primaryCta: { kind: 'confirm_stay_booking', label: 'Confirm booking', value: msg.quoteId },
        secondaryCta: { kind: 'cancel_stay_booking', label: 'Cancel', value: msg.quoteId },
      },
      createdAt: msg.createdAt,
    },
  };
}

function renderStayBookingConfirmation(
  msg: ChannelMessageStayBookingConfirmation,
  author: WebTravelerPayload['author'] | null
): RenderedForChannel<WebTravelerPayload> | null {
  if (!author) return null;
  return {
    channel: 'web',
    payload: {
      bubble: 'stay_booking_confirmation',
      author,
      content: {
        bookingId: msg.bookingId,
        reference: msg.reference,
        status: msg.status,
        confirmedAt: msg.confirmedAt,
        accommodation: msg.accommodation,
        checkInDate: msg.checkInDate,
        checkOutDate: msg.checkOutDate,
        nights: msg.nights,
        rooms: msg.rooms,
        guests: msg.guests,
        roomName: msg.roomName,
        billing: msg.billing,
        cancellationTimeline: msg.cancellationTimeline,
        conditions: msg.conditions,
        supportedLoyaltyProgrammeName: msg.supportedLoyaltyProgrammeName,
        tripUrl: msg.tripUrl ?? null,
        business: msg.business,
      },
      createdAt: msg.createdAt,
    },
  };
}
