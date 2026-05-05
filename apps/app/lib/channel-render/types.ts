/**
 * Canonical cross-channel message shape.
 *
 * Every message the Sendero agent emits flows through this type before
 * any UI renderer sees it. Operator console (web), traveler-side
 * WhatsApp/Slack/web/email all consume the SAME ChannelMessage and
 * each emits its native rendering. A single source of truth means the
 * operator preview in /dashboard/agent-chat looks like what the
 * traveler will actually receive on their channel.
 *
 * Discriminated by `kind`. New kinds = new union members; renderers
 * exhaustively switch and the compiler enforces parity.
 *
 * Renderers live alongside in this directory:
 *   operator.tsx           - AI Elements composition for the web operator
 *   channels/whatsapp.ts   - WhatsApp Business template / interactive payload
 *   channels/slack.ts      - Slack Block Kit blocks
 *   channels/web.ts        - Web traveler bubble JSON
 *
 * The canonical type carries enough context that no renderer needs to
 * re-derive content from another. If a tool result needs to surface on
 * Slack as a button + on WhatsApp as a list, both renderers read the
 * same `tool_result.share` block and emit their native equivalent.
 */

export type ChannelKind = 'web' | 'whatsapp' | 'slack' | 'email';

export type ChannelRole = 'agent' | 'operator' | 'traveler' | 'system';

/**
 * Author of the message in the canonical sense. Independent of which
 * rendering channel the message ultimately reaches — a single agent
 * message may render to operator (web) AND traveler (whatsapp).
 */
export interface ChannelAuthor {
  role: ChannelRole;
  /** Display name shown in chat headers. */
  name?: string;
  /** Avatar URL when available. */
  avatarUrl?: string;
}

/**
 * Action surface shared across cards, tool_results, and approval_requests.
 * Each renderer maps these to its native CTA primitive (Slack action_id,
 * WhatsApp interactive button, web button + onClick).
 */
export interface ChannelCta {
  /** Operator-facing label. Channels may localize. */
  label: string;
  /**
   * Stable kind so each renderer can route to the right native handler:
   *   - approve / reject / cancel: existing approval card semantics
   *   - confirm_change / select_offer: Duffel order_change flow
   *   - confirm_cancel: Duffel cancel-order flow
   *   - open_link: simple href
   *   - tool_invoke: ask the agent to run a follow-up tool
   *   - reply: quick-reply free text the user can edit before sending
   */
  kind:
    | 'approve'
    | 'reject'
    | 'cancel'
    | 'confirm_change'
    | 'select_offer'
    | 'confirm_cancel'
    | 'open_link'
    | 'tool_invoke'
    | 'reply'
    | 'select_seat'
    | 'add_bag'
    // Stays funnel: search → list_stay_rates (rate picker) → quote_stay (review) → book_stay
    | 'select_stay_hotel'
    | 'select_stay_rate'
    | 'confirm_stay_booking'
    | 'cancel_stay_booking';
  /** Free-form value the receiving handler reads (offer id, url, etc.). */
  value?: string;
  /** When the CTA is a link, the destination. */
  href?: string;
  /**
   * Some channels expose only one primary CTA (Slack DM cards) while
   * others can stack many (web inline buttons). Renderers may fall back
   * to text representation when the primary slot is full.
   */
  emphasis?: 'primary' | 'secondary';
}

/**
 * Plain text from any role. Channel renderers Slack-mrkdwn / WhatsApp
 * markdown-lite the body as appropriate; canonical content is markdown.
 */
export interface ChannelMessageText {
  kind: 'text';
  id: string;
  author: ChannelAuthor;
  content: string;
  /** ISO timestamp. */
  createdAt: string;
}

/**
 * Card with an optional title, body, bullets, and CTAs. Used for
 * settle prompts, confirmations, route summaries, etc.
 */
export interface ChannelMessageCard {
  kind: 'card';
  id: string;
  author: ChannelAuthor;
  title: string;
  body: string;
  bullets?: string[];
  /** Primary then secondary. Most channels render the first inline. */
  ctas?: ChannelCta[];
  /**
   * Image URL surfaced at the top of the card. Static-map URLs from
   * `export_route_map`, restaurant photos, etc.
   */
  imageUrl?: string;
  createdAt: string;
}

/**
 * The agent invokes a tool. Operator sees the in-flight call; this
 * never reaches the traveler unless explicitly relayed.
 */
export interface ChannelMessageToolInvocation {
  kind: 'tool_invocation';
  id: string;
  author: ChannelAuthor;
  toolName: string;
  /** Sanitized input — secrets MUST be elided before reaching this shape. */
  input: Record<string, unknown>;
  status: 'pending' | 'streaming' | 'done' | 'error';
  /** When status === 'error'. */
  errorMessage?: string;
  /**
   * When status === 'done', the tool's output. Rendered inline by the
   * operator as the same Tool block's ToolOutput so the operator sees
   * one Tool per call, not a separate invocation + result pair.
   * tool_result is still used by share-card-emitting tools.
   */
  result?: unknown;
  /** Latency in ms once status flips to done/error. */
  latencyMs?: number;
  /**
   * When true, the operator preview collapses this invocation into a
   * one-line debug-drawer entry instead of a full `<Tool>` block.
   * Traveler-facing channels (Slack/WhatsApp/web/email) already drop
   * `tool_invocation` by design; this flag governs the OPERATOR
   * surface only.
   *
   * Set by the agent runtime when the tool returns `_meta: { silent: true }`,
   * OR when the tool descriptor itself was tagged silent. Used by
   * context-loading tools (get_active_trip, get_whatsapp_context,
   * traveler-profile reads) so the operator chat shows clean
   * user-facing turns and the silent ops live in a debug drawer.
   *
   * Spec: docs/architecture/concierge-magic.md §3.4.
   */
  silent?: boolean;
  createdAt: string;
}

/**
 * Tool finished, result is the agent-facing payload. The optional
 * `share` block is the cross-channel canonical shape the renderer
 * emits to operator + (when relayed) traveler.
 */
export interface ChannelMessageToolResult {
  kind: 'tool_result';
  id: string;
  author: ChannelAuthor;
  toolName: string;
  /** Raw tool output — operator-only, never goes to traveler verbatim. */
  result: unknown;
  /**
   * Operator-and-traveler-safe summary derived from the tool. Mirrors
   * the `share` field already present on cancel-order-quote /
   * order-change-quote / restaurant-route-card / etc.
   */
  share?: {
    title: string;
    body: string;
    bullets?: string[];
    primaryCta?: ChannelCta;
    secondaryCtas?: ChannelCta[];
    /** Static-map / preview image attached to the share. */
    imageUrl?: string;
  };
  createdAt: string;
}

/**
 * Operator approval card. Routed via Slack DM today; should also reach
 * email (sendHoldApproval) and the operator-side console preview.
 */
export interface ChannelMessageApprovalRequest {
  kind: 'approval_request';
  id: string;
  author: ChannelAuthor;
  subject: {
    travelerName: string;
    route: string;
    amountUsd: number;
    /** ISO timestamp; channels render as relative time. */
    expiresAt?: string;
    /** "over_policy_cap", "first_intl", etc. */
    reason?: string;
  };
  /** Direct link into /dashboard/console?tripId=… for the operator. */
  reviewUrl?: string;
  createdAt: string;
}

/**
 * Multi-step model reasoning surfaced to the operator. Hidden from
 * traveler renderers by default — adding to a non-operator channel
 * is a deliberate choice the renderer caller must make.
 */
export interface ChannelMessageReasoning {
  kind: 'reasoning';
  id: string;
  author: ChannelAuthor;
  /** Markdown reasoning. */
  content: string;
  /** Whether the operator UI should default to collapsed. */
  collapsedByDefault?: boolean;
  /** Total wall-clock duration for the reasoning chain. */
  durationMs?: number;
  createdAt: string;
}

/**
 * eSIM activation card — emitted by `book_esim` when an order
 * succeeds. Carries the QR image URL, full LPA: install string, plan
 * label + payer line, and a Sendero-hosted install page URL that the
 * channel renderers point CTAs at. The install page handles the
 * device-specific dispatch (iOS auto-redirect to LPA: scheme; Android
 * shows QR + per-device steps).
 *
 * Operator-only fields (raw activation code etc.) intentionally stay
 * server-side — the renderers serialize only what travelers should
 * see / can act on.
 */
export interface ChannelMessageEsimActivation {
  kind: 'esim_activation';
  id: string;
  author: ChannelAuthor;
  /** Sendero `Esim.id` — round-trips to webhook + admin lookups. */
  esimId: string;
  /** "5 GB · 30 days · Japan + Korea". */
  planLabel: string;
  /** ISO-3166-1 alpha-2 codes. Surfaced as flags / labels in renderers. */
  countries: string[];
  /** Total data quota in MB. */
  dataMb: number;
  /** Validity in days from activation. */
  validityDays: number;
  /** Signed `/api/esim/qr/<token>.png` URL. Public-fetchable for unfurl bots. */
  qrUrl: string;
  /** Full SM-DP+ install string (`LPA:1$smdp.example.com$AC`). */
  lpaCode: string;
  /** Universal install page — UA-detects, auto-redirects on iOS. */
  installUrl: string;
  /** Optional payer-aware price line ("$3.00 · charged to your wallet"). */
  priceLine?: string;
  /** ISO timestamp the plan expires (clock starts at install for some providers). */
  expiresAt?: string;
  createdAt: string;
}

/**
 * Seat picker for an unconfirmed flight offer. Lists the cheapest /
 * most-relevant seats for one passenger; tap = stage via `select_seat`.
 *
 * Operator + web render as a richer grid component when present;
 * Slack collapses to an overflow menu; WhatsApp uses an interactive
 * list message (max 10 rows; renderer truncates with overflow note).
 */
export interface ChannelMessageSeatPicker {
  kind: 'seat_picker';
  id: string;
  author: ChannelAuthor;
  /** Sendero `Trip.id` — staging requires this. */
  tripId: string;
  /** Duffel offer id the seats belong to. */
  offerId: string;
  /** Duffel passenger id the picker is offering seats for. */
  passengerId: string;
  passengerName?: string;
  options: Array<{
    serviceId: string;
    designator: string;
    price: string;
    currency: string;
    cabinClass?: string;
    disclosures?: string[];
  }>;
  /** Currently staged seat for this passenger, if any. */
  selectedDesignator?: string;
  createdAt: string;
}

/**
 * Generic ancillary picker (bags + cancel-for-any-reason). Each option
 * has its own CTA; tap = stage via `add_baggage` (or, for cfar, attach
 * via `book_flight`'s services arg).
 */
export interface ChannelMessageAncillaryPicker {
  kind: 'ancillary_picker';
  id: string;
  author: ChannelAuthor;
  tripId: string;
  offerId: string;
  passengerId: string;
  passengerName?: string;
  bags: Array<{
    serviceId: string;
    label: string;
    price: string;
    currency: string;
    weightKg?: number | null;
    dimensions?: string;
    quantitySelected?: number;
  }>;
  cancelForAnyReason?: Array<{
    serviceId: string;
    price: string;
    currency: string;
    summary: string;
    termsUrl?: string;
  }>;
  createdAt: string;
}

/**
 * Shared accommodation block that every Stays-side ChannelMessage echoes.
 * Mirrors the fields Duffel's Go-Live review demands. Every renderer is
 * required to surface name + address + check-in/out times + key_collection
 * (the last shown even when null — fall back to `Ask at the property` per
 * Duffel guidance).
 */
export interface ChannelStayAccommodation {
  name: string;
  /** ISO-2 country, used for flag chips on web/operator. */
  country: string | null;
  city: string | null;
  /** Free-form one-line address (line_one + region + postal_code joined). */
  address: string | null;
  /** "14:30" / "11:30". Renderers display verbatim. */
  checkInAfter: string | null;
  checkOutBefore: string | null;
  /** Always rendered. When null, renderers print a "ask at property" fallback. */
  keyCollection: string | null;
}

/**
 * Per-rate billing summary. Duffel mandates that taxes and fees are
 * surfaced separately (even when zero) and that the total renders as
 * returned by the API — never re-summed by us.
 */
export interface ChannelStayBilling {
  baseAmount: string | null;
  baseCurrency: string | null;
  taxAmount: string;
  taxCurrency: string;
  feeAmount: string;
  feeCurrency: string;
  totalAmount: string;
  totalCurrency: string;
  dueAtAccommodationAmount: string;
  dueAtAccommodationCurrency: string;
}

/**
 * Verbatim cancellation policy entry. Renderers MUST NOT paraphrase the
 * `description` field — Duffel reviews the rendered output against the
 * raw API string. Pass it through unchanged.
 */
export interface ChannelStayCancellationEntry {
  before: string;
  refundAmount: string;
  currency: string;
}

/**
 * Verbatim rate condition. Renderers MUST display `description` in full
 * (no truncation, no expand-to-read action). `title` is the heading.
 */
export interface ChannelStayCondition {
  title: string;
  description: string;
}

/**
 * Sendero business details (your-business-info per Duffel Go-Live).
 * Required pre- AND post-booking. Tenant-resolved so a Sendero-on-Sendero
 * white-label tenant can override. Falls back to Sendero defaults.
 */
export interface ChannelStayBusinessDetails {
  name: string;
  address: string;
  supportEmail: string;
  supportPhone: string;
  termsUrl: string;
  /** Booking.com terms URL when Duffel attributes inventory there. */
  bookingComTermsUrl?: string;
}

/**
 * Hotel search results — emitted by `search_hotels`. Each hotel is a
 * tap target that invokes `list_stay_rates` with the search-result id.
 *
 * The first card the traveler sees in the stays funnel. Slack / WhatsApp
 * surface this as an interactive list (one row per hotel); web + operator
 * render a richer grid with photo + rating + cheapest-rate + cancellation
 * badge per hotel. Skipping straight to `quote_stay` would not work —
 * `search_hotels` does not return rate ids.
 */
export interface ChannelMessageStaySearchResults {
  kind: 'stay_search_results';
  id: string;
  author: ChannelAuthor;
  /** Search context — used to compute nights + render the booking window. */
  checkInDate: string;
  checkOutDate: string;
  rooms: number;
  guests: number;
  hotels: Array<{
    /** Duffel `StaysSearchResult.id` (`ssr_…`) — pass to `list_stay_rates`. */
    searchResultId: string;
    name: string;
    /** ISO-2 country, used for flag chips. */
    country: string | null;
    city: string | null;
    /** AAA / star rating (1-5) when supplied. */
    stars: number | null;
    /** 0-10 user review score from Duffel. */
    reviewScore: number | null;
    /** Up to 3 photo URLs; the first is the primary image on rich surfaces. */
    photos: string[];
    /** Cheapest rate total + currency from the search response. */
    cheapestPrice: string;
    cheapestCurrency: string;
    /** 'free' = at least one rate fully refundable; 'partial' = timeline
     *  exists but never reaches full; 'non_refundable' = empty timeline;
     *  'unknown' = list-search response (rates not fetched). */
    cancellation: 'free' | 'partial' | 'non_refundable' | 'unknown';
    /** Distance from the search anchor in meters, when supplied. */
    distanceMeters: number | null;
    /** Top 5 amenity tags ('wifi', 'parking', etc.). */
    amenities: string[];
  }>;
  business: ChannelStayBusinessDetails;
  createdAt: string;
}

/**
 * Rate picker — emitted by `list_stay_rates`. Each rate is a tap target
 * that invokes `quote_stay`. Grouped by `roomName` on the operator side
 * for readability; channels collapse to flat list + interactive primitive.
 */
export interface ChannelMessageStayRatePicker {
  kind: 'stay_rate_picker';
  id: string;
  author: ChannelAuthor;
  /** Duffel search-result id this rate set belongs to. */
  searchResultId: string;
  accommodation: ChannelStayAccommodation;
  /** Stay window — used to compute nights. */
  checkInDate: string;
  checkOutDate: string;
  /** Rooms count + guests count from the original search. Required pre-booking display. */
  rooms: number;
  guests: number;
  rates: Array<{
    rateId: string;
    roomName: string | null;
    /** "pay_now" | "deposit" | "guarantee" — Duffel may omit. */
    paymentType: string | null;
    /** "balance" / "card" — informs the agent which top-up flow the traveler needs. */
    availablePaymentMethods: string[];
    refundable: boolean;
    billing: ChannelStayBilling;
    cancellationTimeline: ChannelStayCancellationEntry[];
    boardType?: string | null;
  }>;
  business: ChannelStayBusinessDetails;
  createdAt: string;
}

/**
 * Pre-booking review card — emitted by `quote_stay`. This is the canonical
 * "before you book" screen Duffel mandates: every billing field separated,
 * cancellation policy verbatim, conditions verbatim and visible by default,
 * key collection always shown, business details visible.
 */
export interface ChannelMessageStayQuoteReview {
  kind: 'stay_quote_review';
  id: string;
  author: ChannelAuthor;
  quoteId: string;
  /** Sendero Trip.id — confirm CTA needs this. */
  tripId?: string;
  /** Sendero Tenant.id — confirm CTA needs this for tenant-bind. */
  tenantId?: string;
  /**
   * Optional traveler contact that the Slack `confirm_stay_booking`
   * button needs to actually run `book_stay` from a Slack tap. Populated
   * by the agent layer when the quote is destined for a Slack thread
   * where the operator (not the traveler) is hitting the confirm button.
   * Web/WhatsApp don't need this — the traveler is already authenticated.
   */
  travelerContact?: {
    email: string;
    givenName: string;
    familyName: string;
  };
  accommodation: ChannelStayAccommodation;
  checkInDate: string;
  checkOutDate: string;
  /** Computed nights = (checkOut - checkIn). Renderers may also compute. */
  nights: number;
  rooms: number;
  guests: number;
  /** Selected room from the list_stay_rates picker. */
  roomName: string | null;
  paymentType: string | null;
  /** Resolved payer for the booking; informs the "Paid by" footer. */
  payer?: 'tenant' | 'traveler' | null;
  billing: ChannelStayBilling;
  cancellationTimeline: ChannelStayCancellationEntry[];
  conditions: ChannelStayCondition[];
  supportedLoyaltyProgrammeName?: string | null;
  business: ChannelStayBusinessDetails;
  createdAt: string;
}

/**
 * Post-booking confirmation — emitted by `book_stay` after Duffel returns
 * a confirmed booking. Carries `reference` (the API-returned booking ref,
 * not Sendero's id) + `confirmedAt` + every pre-booking field.
 */
export interface ChannelMessageStayBookingConfirmation {
  kind: 'stay_booking_confirmation';
  id: string;
  author: ChannelAuthor;
  bookingId: string;
  /** Duffel-returned booking reference (e.g. "AFE33SE2"). Renderers MUST
   *  surface this verbatim — it's the field guests show at reception. */
  reference: string;
  status: string;
  /** ISO timestamp from Duffel (`confirmed_at`). Renderers format per locale. */
  confirmedAt: string | null;
  accommodation: ChannelStayAccommodation;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  rooms: number;
  guests: number;
  roomName: string | null;
  payer?: 'tenant' | 'traveler' | null;
  billing: ChannelStayBilling;
  cancellationTimeline: ChannelStayCancellationEntry[];
  conditions: ChannelStayCondition[];
  supportedLoyaltyProgrammeName?: string | null;
  /** Public Sendero trip-brief share URL when available. */
  tripUrl?: string | null;
  business: ChannelStayBusinessDetails;
  createdAt: string;
}

/**
 * Trip brief — single-call recap of an entire trip. Surfaces the trip
 * header, flights, stays, eSIM connectivity, alerts, and a public
 * share URL the traveler can forward. Each channel renders its own
 * native shape; the canonical payload below is what the `get_trip_brief`
 * tool emits.
 */
export interface ChannelMessageTripBrief {
  kind: 'trip_brief';
  id: string;
  author: ChannelAuthor;
  trip: {
    tripId: string;
    name: string | null;
    status: string;
    kind: string;
    origin: string | null;
    destination: string | null;
    destinationCountriesIso2: string[];
    startDate: string | null;
    endDate: string | null;
  };
  flights: Array<{
    bookingId: string;
    pnr: string | null;
    status: string;
    origin: string | null;
    destination: string | null;
    departureAt: string | null;
    arrivalAt: string | null;
    totalUsd: string;
    segmentCount: number;
  }>;
  stays: Array<{
    bookingId: string;
    status: string;
    property: string | null;
    city: string | null;
    checkInDate: string | null;
    checkOutDate: string | null;
    nights: number | null;
    totalUsd: string;
  }>;
  esims: Array<{
    esimId: string;
    status: string;
    countries: string[];
    dataMb: number;
    validityDays: number;
    expiresAt: string | null;
    installUrl: string | null;
  }>;
  alerts: Array<{
    kind: string;
    severity: 'info' | 'warn' | 'critical';
    message: string;
  }>;
  shareUrl: string | null;
  createdAt: string;
}

/**
 * Citation list — Places, search results, doc references. Each source
 * has at minimum a title + url; snippet + favicon are optional.
 */
export interface ChannelMessageSources {
  kind: 'sources';
  id: string;
  author: ChannelAuthor;
  items: Array<{
    title: string;
    url: string;
    snippet?: string;
    faviconUrl?: string;
  }>;
  createdAt: string;
}

/** The canonical discriminated union. */
export type ChannelMessage =
  | ChannelMessageText
  | ChannelMessageCard
  | ChannelMessageToolInvocation
  | ChannelMessageToolResult
  | ChannelMessageApprovalRequest
  | ChannelMessageReasoning
  | ChannelMessageSources
  | ChannelMessageEsimActivation
  | ChannelMessageSeatPicker
  | ChannelMessageAncillaryPicker
  | ChannelMessageStaySearchResults
  | ChannelMessageStayRatePicker
  | ChannelMessageStayQuoteReview
  | ChannelMessageStayBookingConfirmation
  | ChannelMessageTripBrief;

/**
 * Native payload type each channel renderer emits. Every concrete
 * channel renderer implementation declares its own narrower type and
 * narrows this union at the call site.
 */
export interface RenderedForChannel<TPayload = unknown> {
  channel: ChannelKind;
  /** The native payload — Slack blocks / WhatsApp interactive / web JSON. */
  payload: TPayload;
  /**
   * True when the renderer fell back to a degraded representation
   * because the channel doesn't support the canonical message kind
   * (e.g. WhatsApp can't show inline reasoning — falls back to a
   * shortened summary or skips entirely).
   */
  degraded?: boolean;
}

/**
 * Contract every channel renderer implements. Implementations live in
 * channels/{whatsapp,slack,web,email}.ts and may return null when the
 * canonical kind is intentionally not relayed to that channel
 * (reasoning never ships to whatsapp, for example).
 *
 * Returns a promise so renderers can lazily sign + build a fallback OG
 * image URL via `buildShareImageUrl` when the source share has no
 * explicit imageUrl. Synchronous callers can `await` at the call site.
 */
export type ChannelRenderer<TPayload = unknown> = (
  msg: ChannelMessage
) => Promise<RenderedForChannel<TPayload> | null>;
