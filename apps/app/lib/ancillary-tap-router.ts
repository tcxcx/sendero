/**
 * Pre-booking ancillary tap router.
 *
 * One module that decodes Slack overflow / WhatsApp interactive-list
 * taps from the seat / bag picker and fires the correct Sendero tool
 * over the internal `/api/tools/<name>` surface. Used by:
 *
 *   - apps/app/app/api/webhooks/slack/interactions/route.ts
 *   - apps/app/app/api/webhooks/whatsapp/route.ts
 *
 * Lives outside the route files so the parsing + HTTP plumbing is
 * unit-testable without booting Next handlers. `fetch` is injectable
 * for tests.
 *
 * Both code paths converge on POST /api/tools/select_seat
 * (or /api/tools/add_baggage). The differences are:
 *   - Slack: payload arrives as JSON-stringified value the renderer
 *     stuffed into `selected_option.value` (overflow / seats) or
 *     `action.value` (button / bags). User resolved via
 *     SlackUserBinding → `_slackSenderoUserId`.
 *   - WhatsApp: payload arrives as a colon-delimited row id of shape
 *     `<kind>:<tripId>:<offerId>:<passengerId>:<svcId>:<label>`.
 *     User resolved by phone (`travelerPhone`).
 *
 * The shared HTTP envelope is implemented once here so the body shape
 * stays in lockstep across both surfaces — drift is the failure mode
 * we're optimizing against.
 */

export type AncillaryToolName = 'select_seat' | 'add_baggage';

export interface AncillaryStagingPayload {
  tripId?: string;
  offerId?: string;
  passengerId?: string;
  seatServiceId?: string;
  bagServiceId?: string;
  designator?: string;
  price?: string;
  currency?: string;
  quantity?: number;
  label?: string;
}

export interface AncillaryTapResult {
  ok: boolean;
  /**
   * When `ok=false`, why we couldn't route. Caller falls through to
   * normal agent dispatch on most reasons; logs a warn on `no_secret`
   * (env misconfig) and `parse_failed` (renderer/handler drift).
   */
  reason?: 'parse_failed' | 'missing_fields' | 'no_secret' | 'unknown_kind' | 'unknown_user';
  toolName?: AncillaryToolName;
  /** URL the router posted to (or would have posted to). */
  url?: string;
  /** Body the router sent (or would have sent). Useful for audit + tests. */
  body?: Record<string, unknown>;
  /** HTTP response status when the fetch actually fired. */
  status?: number;
}

export interface AncillaryTapDeps {
  /** Inject for tests. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Overrides `NEXT_PUBLIC_APP_URL`. */
  baseUrl?: string;
  /** Overrides `AGENT_DISPATCH_SECRET ?? CRON_SECRET`. */
  secret?: string;
}

function resolveBaseUrl(d?: AncillaryTapDeps): string {
  return (d?.baseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3010').replace(
    /\/$/,
    ''
  );
}

function resolveSecret(d?: AncillaryTapDeps): string | undefined {
  return d?.secret ?? process.env.AGENT_DISPATCH_SECRET ?? process.env.CRON_SECRET ?? undefined;
}

function resolveFetch(d?: AncillaryTapDeps): typeof fetch {
  return d?.fetch ?? globalThis.fetch;
}

/**
 * Build the canonical /api/tools/<name> POST body for an ancillary
 * staging call. Single source of truth — both Slack + WA paths route
 * through this so the body shape can never drift between surfaces.
 */
function buildToolInput(
  toolName: AncillaryToolName,
  staging: AncillaryStagingPayload
): Record<string, unknown> {
  if (toolName === 'select_seat') {
    return {
      tripId: staging.tripId,
      offerId: staging.offerId,
      passengerId: staging.passengerId,
      seatServiceId: staging.seatServiceId,
      ...(staging.designator ? { designator: staging.designator } : {}),
      ...(staging.price ? { price: staging.price } : {}),
      ...(staging.currency ? { currency: staging.currency } : {}),
    };
  }
  return {
    tripId: staging.tripId,
    offerId: staging.offerId,
    passengerId: staging.passengerId,
    bagServiceId: staging.bagServiceId,
    quantity: staging.quantity ?? 1,
    ...(staging.label ? { label: staging.label } : {}),
    ...(staging.price ? { price: staging.price } : {}),
    ...(staging.currency ? { currency: staging.currency } : {}),
  };
}

interface PostArgs {
  toolName: AncillaryToolName | FanoutCtaToolName;
  body: Record<string, unknown>;
  deps?: AncillaryTapDeps;
}

async function postToTool(args: PostArgs): Promise<{ status: number; url: string }> {
  const baseUrl = resolveBaseUrl(args.deps);
  const url = `${baseUrl}/api/tools/${args.toolName}`;
  const secret = resolveSecret(args.deps);
  // Caller already verified secret presence — guard belt-and-braces.
  if (!secret) throw new Error('ancillary-tap-router: dispatch secret missing');
  const f = resolveFetch(args.deps);
  const res = await f(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-sendero-dispatch-secret': secret,
    },
    body: JSON.stringify(args.body),
  });
  return { status: res.status, url };
}

// ── Slack ────────────────────────────────────────────────────────────

export interface RouteSlackAncillaryTapArgs {
  /** `sendero_select_seat` or `sendero_add_bag`. */
  actionId: string;
  /**
   * Raw JSON value the Slack renderer placed in `selected_option.value`
   * (overflow menu) or `action.value` (button). Caller passes
   * whichever was non-null.
   */
  rawValue: string;
  tenantId: string;
  /**
   * Sendero User.id resolved from SlackUserBinding by the route
   * handler. The router itself doesn't touch the binding table — that
   * keeps the unit testable and the route file in charge of who can
   * tap on whose behalf.
   */
  senderoUserId: string;
}

export async function routeSlackAncillaryTap(
  args: RouteSlackAncillaryTapArgs,
  deps?: AncillaryTapDeps
): Promise<AncillaryTapResult> {
  if (!resolveSecret(deps)) return { ok: false, reason: 'no_secret' };

  const toolName: AncillaryToolName | null =
    args.actionId === 'sendero_select_seat'
      ? 'select_seat'
      : args.actionId === 'sendero_add_bag'
        ? 'add_baggage'
        : null;
  if (!toolName) return { ok: false, reason: 'unknown_kind' };

  let staging: AncillaryStagingPayload;
  try {
    staging = JSON.parse(args.rawValue) as AncillaryStagingPayload;
  } catch {
    return { ok: false, reason: 'parse_failed' };
  }
  if (!staging.tripId || !staging.offerId || !staging.passengerId) {
    return { ok: false, reason: 'missing_fields' };
  }

  const body = {
    tenantId: args.tenantId,
    _slackSenderoUserId: args.senderoUserId,
    input: buildToolInput(toolName, staging),
  };

  const { status, url } = await postToTool({ toolName, body, deps });
  return { ok: true, toolName, url, body, status };
}

// ── WhatsApp ─────────────────────────────────────────────────────────

export interface RouteWhatsAppAncillaryTapArgs {
  /**
   * The interactive-list row id, encoded by
   * `apps/app/lib/channel-render/channels/whatsapp.ts` as
   *   `<kind>:<tripId>:<offerId>:<passengerId>:<serviceId>:<label>`
   * where `<kind>` is `select_seat` or `add_bag`. Trailing label may
   * itself contain colons (e.g. cabin class with a colon-prefix);
   * `:` past the 5th split is rejoined as the label.
   */
  rowId: string;
  tenantId: string;
  /**
   * E.164 phone for the inbound message. Threaded into the tools
   * route which resolves the Sendero User by `(tenantId, phoneE164)`.
   * Allowed null only because some inbound paths can't surface a phone
   * (e.g. status-only events) — caller decides when to call.
   */
  travelerPhone: string | null;
}

export async function routeWhatsAppAncillaryTap(
  args: RouteWhatsAppAncillaryTapArgs,
  deps?: AncillaryTapDeps
): Promise<AncillaryTapResult> {
  if (!resolveSecret(deps)) return { ok: false, reason: 'no_secret' };

  const parts = args.rowId.split(':');
  if (parts.length < 5) return { ok: false, reason: 'parse_failed' };
  const [kind, tripId, offerId, passengerId, serviceId, ...rest] = parts;
  if (!tripId || !offerId || !passengerId || !serviceId) {
    return { ok: false, reason: 'missing_fields' };
  }
  const label = rest.join(':'); // restore any colons inside the label

  const toolName: AncillaryToolName | null =
    kind === 'select_seat' ? 'select_seat' : kind === 'add_bag' ? 'add_baggage' : null;
  if (!toolName) return { ok: false, reason: 'unknown_kind' };

  const staging: AncillaryStagingPayload =
    toolName === 'select_seat'
      ? {
          tripId,
          offerId,
          passengerId,
          seatServiceId: serviceId,
          ...(label ? { designator: label } : {}),
        }
      : {
          tripId,
          offerId,
          passengerId,
          bagServiceId: serviceId,
          quantity: 1,
          ...(label ? { label } : {}),
        };

  const body: Record<string, unknown> = {
    tenantId: args.tenantId,
    ...(args.travelerPhone ? { travelerPhone: args.travelerPhone } : {}),
    input: buildToolInput(toolName, staging),
  };

  const { status, url } = await postToTool({ toolName, body, deps });
  return { ok: true, toolName, url, body, status };
}

// ── Fanout CTA tap routing ────────────────────────────────────────────
//
// Phase G fanout cards (eSIM offer, wrap-up prompt, etc.) render as
// `interactive.button_reply` on WhatsApp + as
// `sendero_tool_invoke.<value>` action ids on Slack. The CTA values
// are short slugs like `trip_wrap:<tripId>` / `esim_offer:<iso>:<days>`
// — different shape from the per-leg ancillary pickers. Routing them
// server-side closes the loop without burning agent tokens on
// classification.

export type FanoutCtaToolName = 'complete_trip' | 'set_trip_kind' | 'search_esim';

export interface FanoutCtaResult {
  ok: boolean;
  toolName?: FanoutCtaToolName;
  reason?: 'parse_failed' | 'unknown_kind' | 'no_secret';
  url?: string;
  status?: number;
}

export async function routeFanoutCtaTap(args: {
  /** The CTA value, e.g. `trip_wrap:trp_abc`. */
  value: string;
  tenantId: string;
  /** E.164 traveler phone — Sendero User resolution. */
  travelerPhone?: string | null;
  /**
   * Slack-binding shortcut — pass the resolved senderoUserId so the
   * tool route stamps `ctx.traveler.userId` without phone resolution.
   */
  slackSenderoUserId?: string | null;
  deps?: AncillaryTapDeps;
}): Promise<FanoutCtaResult> {
  if (!resolveSecret(args.deps)) return { ok: false, reason: 'no_secret' };
  const value = args.value.trim();
  if (!value) return { ok: false, reason: 'parse_failed' };

  let toolName: FanoutCtaToolName;
  let input: Record<string, unknown>;

  if (value.startsWith('trip_wrap:')) {
    const tripId = value.slice('trip_wrap:'.length);
    if (!tripId) return { ok: false, reason: 'parse_failed' };
    toolName = 'complete_trip';
    input = { tripId };
  } else if (value.startsWith('trip_extend:')) {
    const tripId = value.slice('trip_extend:'.length);
    if (!tripId) return { ok: false, reason: 'parse_failed' };
    toolName = 'set_trip_kind';
    input = { tripId, kind: 'open_journey' };
  } else if (value.startsWith('esim_offer:')) {
    const [, iso, daysRaw] = value.split(':');
    if (!iso) return { ok: false, reason: 'parse_failed' };
    const days = Number.parseInt(daysRaw ?? '7', 10) || 7;
    toolName = 'search_esim';
    input = { destinationIso2: [iso], days };
  } else {
    return { ok: false, reason: 'unknown_kind' };
  }

  const body: Record<string, unknown> = {
    tenantId: args.tenantId,
    ...(args.travelerPhone ? { travelerPhone: args.travelerPhone } : {}),
    ...(args.slackSenderoUserId ? { _slackSenderoUserId: args.slackSenderoUserId } : {}),
    input,
  };

  const { status, url } = await postToTool({ toolName, body, deps: args.deps });
  return { ok: true, toolName, url, status };
}
